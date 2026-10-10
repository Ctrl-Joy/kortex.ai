"""Customer and staff actions on discrepancies (the self-correcting cart)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationFailed
from app.models import Discrepancy, Product, ScanEvent, ShoppingSession, VisionEvent
from app.models.enums import (
    OPEN_DISCREPANCY_STATES,
    DiscrepancyKind,
    DiscrepancyState,
    ResolutionActionType,
    ScanStatus,
    VisionEventState,
)
from app.services import cart, discrepancies
from app.services.audit import Actor
from app.services.discrepancies import DEFAULT_CUSTOMER_OPTIONS
from app.services.policy_access import current_policy

CUSTOMER_OPTIONS = {
    "ADD_TO_CART",
    "PUT_BACK",
    "REPLACE_ITEM",
    "KEEP_SCANNED",
    "KEEP_BOTH",
    "REMOVE_EXTRA",
    "CONFIRM_NOTHING_EXTRA",
    "REMOVE_RETURNED",
    "KEEP_ITEM",
    "REQUEST_STAFF",
}

STAFF_ACTIONS = {"RESOLVE", "DISMISS", "REQUEST_CUSTOMER", "ESCALATE"}
STAFF_CORRECTIONS = {"NONE", "ADD_OBSERVED", "REPLACE_WITH_OBSERVED", "REMOVE_SCANNED"}


def _observed_product(db: Session, d: Discrepancy) -> Product:
    if not d.observed_product_id:
        raise ValidationFailed("This alert has no single identified product to add.", code="no_observed_product")
    product = db.get(Product, d.observed_product_id)
    if product is None:
        raise ValidationFailed("Observed product not found in catalogue.")
    return product


def _add_observed(db: Session, session: ShoppingSession, d: Discrepancy) -> list[dict]:
    product = _observed_product(db, d)
    scan = cart.add_unit(db, session, product, method="CORRECTION", source="CUSTOMER_APP", is_simulated=d.is_simulated)
    if d.vision_event_id:
        ve = db.get(VisionEvent, d.vision_event_id)
        if ve is not None and ve.matched_scan_id is None:
            scan.matched_vision_event_id = ve.id
            ve.matched_scan_id = scan.id
            ve.state = VisionEventState.RESOLVED
    return [{"product_id": product.id, "name": product.name, "qty_delta": 1, "unit_price_paise": product.price_paise}]


def _remove_scanned(db: Session, session: ShoppingSession, d: Discrepancy, reason: str) -> list[dict]:
    if not d.scan_event_id:
        raise ValidationFailed("This alert has no associated scan to remove.", code="no_scan")
    scan = db.get(ScanEvent, d.scan_event_id)
    if scan is None or scan.product_id is None:
        raise ValidationFailed("Associated scan not found.")
    if scan.status != ScanStatus.ACCEPTED:
        return []
    product = db.get(Product, scan.product_id)
    cart.void_unit(db, session, scan.product_id, reason=reason, preferred_scan_id=scan.id)
    return [
        {
            "product_id": scan.product_id,
            "name": product.name if product else scan.product_id,
            "qty_delta": -1,
            "unit_price_paise": product.price_paise if product else None,
        }
    ]


def _close_vision(db: Session, d: Discrepancy) -> None:
    if d.vision_event_id:
        ve = db.get(VisionEvent, d.vision_event_id)
        if ve is not None and ve.state == VisionEventState.CANDIDATE_DISCREPANCY:
            ve.state = VisionEventState.RESOLVED


def customer_action(db: Session, session: ShoppingSession, d: Discrepancy, option: str, *, actor: Actor) -> Discrepancy:
    if d.session_id != session.id:
        raise ConflictError("This alert belongs to a different session.")
    if option not in CUSTOMER_OPTIONS:
        raise ValidationFailed(f"Unknown option {option!r}.")
    if d.state != DiscrepancyState.AWAITING_CUSTOMER:
        raise ConflictError("This alert is not waiting for your response.", code="not_awaiting_customer")
    if option not in (d.customer_options or []):
        raise ValidationFailed(f"Option {option!r} is not available for this alert.")
    cart.ensure_active(session)

    T = ResolutionActionType
    R = DiscrepancyState.RESOLVED

    if option == "REQUEST_STAFF":
        discrepancies.transition(
            db,
            d,
            new_state=DiscrepancyState.AWAITING_STAFF,
            actor=actor,
            action=T.CUSTOMER_REQUESTED_STAFF,
            reason="Customer requested staff assistance.",
        )
    elif option == "ADD_TO_CART":
        delta = _add_observed(db, session, d)
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_CONFIRMED_CORRECTION,
            cart_delta=delta,
            reason="Customer confirmed the item and added it to the cart.",
            resolution_code="CUSTOMER_CORRECTION",
        )
    elif option in ("PUT_BACK", "KEEP_SCANNED"):
        reason = (
            "Customer reports the item was put back."
            if option == "PUT_BACK"
            else "Customer reports the scanned item is correct."
        )
        discrepancies.transition(
            db, d, new_state=DiscrepancyState.AWAITING_STAFF, actor=actor, action=T.CUSTOMER_DISPUTED, reason=reason
        )
    elif option == "REPLACE_ITEM":
        removed = _remove_scanned(db, session, d, reason=f"Replaced after confirmation of {d.id}")
        added = _add_observed(db, session, d)
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_CONFIRMED_CORRECTION,
            cart_delta=removed + added,
            reason="Customer confirmed the observed product; scanned item replaced.",
            resolution_code="CUSTOMER_CORRECTION",
        )
    elif option == "KEEP_BOTH":
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_KEPT_DUPLICATE,
            reason="Customer confirmed both units.",
            resolution_code="CUSTOMER_CONFIRMED",
        )
    elif option == "REMOVE_EXTRA":
        delta = _remove_scanned(db, session, d, reason=f"Duplicate scan removed ({d.id})")
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_REMOVED_DUPLICATE,
            cart_delta=delta,
            reason="Customer removed the accidental duplicate.",
            resolution_code="CUSTOMER_CORRECTION",
        )
    elif option == "CONFIRM_NOTHING_EXTRA":
        if not current_policy(db).allow_customer_attestation_for_uncertain:
            raise ConflictError("Self-confirmation is disabled; please request staff assistance.")
        _close_vision(db, d)
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_ATTESTED,
            reason="Customer confirmed every item in their basket is scanned.",
            resolution_code="CUSTOMER_ATTESTED",
        )
    elif option == "REMOVE_RETURNED":
        delta = _remove_scanned(db, session, d, reason=f"Returned to shelf ({d.id})")
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_CONFIRMED_CORRECTION,
            cart_delta=delta,
            reason="Customer removed the returned item.",
            resolution_code="CUSTOMER_CORRECTION",
        )
    elif option == "KEEP_ITEM":
        discrepancies.transition(
            db,
            d,
            new_state=R,
            actor=actor,
            action=T.CUSTOMER_KEPT_DUPLICATE,
            reason="Customer kept the item in the cart.",
            resolution_code="CUSTOMER_CONFIRMED",
        )
    cart.notify_cart(db, session.id)
    return d


def staff_action(
    db: Session,
    session: ShoppingSession,
    d: Discrepancy,
    *,
    action: str,
    reason: str | None,
    correction: str = "NONE",
    actor: Actor,
) -> Discrepancy:
    if action not in STAFF_ACTIONS:
        raise ValidationFailed(f"Unknown staff action {action!r}.")
    if correction not in STAFF_CORRECTIONS:
        raise ValidationFailed(f"Unknown correction {correction!r}.")
    if d.state not in OPEN_DISCREPANCY_STATES:
        raise ConflictError(f"Discrepancy {d.id} is already {d.state.lower()}.", code="discrepancy_closed")
    reason = (reason or "").strip()
    if action in ("RESOLVE", "DISMISS", "ESCALATE") and len(reason) < 5:
        raise ValidationFailed("Please provide a reason (at least 5 characters).", code="reason_required")

    T = ResolutionActionType
    if action == "DISMISS":
        _close_vision(db, d)
        discrepancies.transition(
            db,
            d,
            new_state=DiscrepancyState.DISMISSED,
            actor=actor,
            action=T.STAFF_DISMISSED,
            reason=reason,
            resolution_code="FALSE_POSITIVE",
        )
    elif action == "ESCALATE":
        discrepancies.transition(
            db, d, new_state=DiscrepancyState.ESCALATED, actor=actor, action=T.STAFF_ESCALATED, reason=reason
        )
    elif action == "REQUEST_CUSTOMER":
        options = list(DEFAULT_CUSTOMER_OPTIONS[DiscrepancyKind(d.kind)])
        if d.kind == DiscrepancyKind.CONFLICTING_EVIDENCE and d.observed_product_id:
            options = ["ADD_TO_CART", "PUT_BACK", "REQUEST_STAFF"]
        d.customer_options = options
        discrepancies.transition(
            db,
            d,
            new_state=DiscrepancyState.AWAITING_CUSTOMER,
            actor=actor,
            action=T.STAFF_REQUESTED_CUSTOMER,
            reason=reason or "Staff requested customer confirmation.",
        )
    else:  # RESOLVE
        delta: list[dict] = []
        if correction != "NONE":
            cart.ensure_active(session)
        if correction == "ADD_OBSERVED":
            delta = _add_observed(db, session, d)
        elif correction == "REPLACE_WITH_OBSERVED":
            delta = _remove_scanned(db, session, d, reason=f"Staff correction ({d.id})") + _add_observed(db, session, d)
        elif correction == "REMOVE_SCANNED":
            delta = _remove_scanned(db, session, d, reason=f"Staff correction ({d.id})")
        _close_vision(db, d)
        discrepancies.transition(
            db,
            d,
            new_state=DiscrepancyState.RESOLVED,
            actor=actor,
            action=T.STAFF_RESOLVED,
            reason=reason,
            cart_delta=delta,
            resolution_code="STAFF_CORRECTION" if delta else "STAFF_VERIFIED",
        )
    cart.notify_cart(db, session.id)
    return d
