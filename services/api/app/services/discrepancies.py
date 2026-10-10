"""Discrepancy lifecycle: creation (idempotent) and audited state transitions."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.core.time import utcnow
from app.models import Discrepancy, ResolutionAction, ShoppingSession
from app.models.enums import OPEN_DISCREPANCY_STATES, DiscrepancyKind, DiscrepancyState
from app.services import audit
from app.services.audit import Actor
from app.services.reconciliation import describe_confidence
from app.websocket.hub import enqueue

CUSTOMER_MESSAGES: dict[str, str] = {
    DiscrepancyKind.MISSED_SCAN: (
        "Our shelf camera noticed {observed} may have been picked up, but we couldn't find a matching scan. "
        "If it's in your basket, add it to your cart. If you put it back, just let us know."
    ),
    DiscrepancyKind.WRONG_PRODUCT: (
        "You scanned {scanned}, but the shelf camera saw what looks like {observed}. Which one do you have?"
    ),
    DiscrepancyKind.DUPLICATE_SCAN: "{scanned} was scanned twice within a few seconds. Do you have two?",
    DiscrepancyKind.UNCERTAIN_OBSERVATION: (
        "The shelf camera noticed a possible pick-up but couldn't identify the item clearly. "
        "Please check your basket and scan anything you haven't scanned yet."
    ),
    DiscrepancyKind.PICKUP_RETURN: "It looks like you put {observed} back on the shelf. Remove it from your cart?",
    DiscrepancyKind.CONFLICTING_EVIDENCE: (
        "We received mixed signals about an item on the shelf. A store team member will confirm quickly — "
        "this is routine and no action is needed from you."
    ),
}

KIND_LABELS: dict[str, str] = {
    DiscrepancyKind.MISSED_SCAN: "Potential missed scan",
    DiscrepancyKind.WRONG_PRODUCT: "Possible wrong-product scan",
    DiscrepancyKind.DUPLICATE_SCAN: "Duplicate scan",
    DiscrepancyKind.UNCERTAIN_OBSERVATION: "Uncertain visual observation",
    DiscrepancyKind.PICKUP_RETURN: "Pickup followed by return",
    DiscrepancyKind.CONFLICTING_EVIDENCE: "Conflicting or incomplete evidence",
}

DEFAULT_CUSTOMER_OPTIONS: dict[str, tuple[str, ...]] = {
    DiscrepancyKind.MISSED_SCAN: ("ADD_TO_CART", "PUT_BACK", "REQUEST_STAFF"),
    DiscrepancyKind.WRONG_PRODUCT: ("REPLACE_ITEM", "KEEP_SCANNED", "REQUEST_STAFF"),
    DiscrepancyKind.DUPLICATE_SCAN: ("KEEP_BOTH", "REMOVE_EXTRA", "REQUEST_STAFF"),
    DiscrepancyKind.UNCERTAIN_OBSERVATION: ("SCAN_NOW", "CONFIRM_NOTHING_EXTRA", "REQUEST_STAFF"),
    DiscrepancyKind.PICKUP_RETURN: ("REMOVE_RETURNED", "KEEP_ITEM"),
    DiscrepancyKind.CONFLICTING_EVIDENCE: ("REQUEST_STAFF",),
}


def summary(d: Discrepancy) -> dict[str, Any]:
    return {
        "id": d.id,
        "kind": d.kind,
        "state": d.state,
        "blocking": d.blocking,
        "is_simulated": d.is_simulated,
        "source": d.source,
    }


def create(
    db: Session,
    *,
    session: ShoppingSession,
    kind: DiscrepancyKind,
    state: DiscrepancyState,
    dedupe_key: str,
    blocking: bool,
    explanation: str,
    recommended_action: str,
    source: str,
    is_simulated: bool,
    customer_options: tuple[str, ...] | None = None,
    vision_event_id: str | None = None,
    scan_event_id: str | None = None,
    observed_product_id: str | None = None,
    scanned_product_id: str | None = None,
    observed_name: str | None = None,
    scanned_name: str | None = None,
    reconciliation_result_id: str | None = None,
    model_confidence: float | None = None,
    reconciliation_confidence: float | None = None,
    customer_message: str | None = None,
) -> tuple[Discrepancy, bool]:
    """Create a discrepancy unless one already exists for the same dedupe key."""
    existing = db.scalar(select(Discrepancy).where(Discrepancy.dedupe_key == dedupe_key))
    if existing is not None:
        return existing, False
    message = customer_message or CUSTOMER_MESSAGES[kind].format(
        observed=observed_name or "an item", scanned=scanned_name or "an item"
    )
    note = describe_confidence(reconciliation_confidence)
    if model_confidence is not None and reconciliation_confidence is not None:
        note = (
            f"Model confidence {model_confidence:.2f} (detector output) · reconciliation confidence "
            f"{reconciliation_confidence:.2f} (all evidence combined). {note}"
        )
    d = Discrepancy(
        session_id=session.id,
        kind=kind,
        state=state,
        blocking=blocking,
        dedupe_key=dedupe_key,
        vision_event_id=vision_event_id,
        scan_event_id=scan_event_id,
        observed_product_id=observed_product_id,
        scanned_product_id=scanned_product_id,
        reconciliation_result_id=reconciliation_result_id,
        source=source,
        is_simulated=is_simulated,
        model_confidence=model_confidence,
        reconciliation_confidence=reconciliation_confidence,
        confidence_note=note,
        explanation=explanation,
        customer_message=message,
        recommended_action=recommended_action,
        customer_options=list(customer_options or DEFAULT_CUSTOMER_OPTIONS[kind]),
    )
    if state in (DiscrepancyState.RESOLVED, DiscrepancyState.DISMISSED):
        d.resolved_at = utcnow()
    db.add(d)
    db.flush()
    audit.record(
        db,
        actor=audit.SYSTEM,
        event_type="DISCREPANCY_CREATED",
        summary=f"{KIND_LABELS[kind]} raised ({d.id}) — {state.replace('_', ' ').lower()}.",
        session_id=session.id,
        entity_type="discrepancy",
        entity_id=d.id,
        source=source,
        is_simulated=is_simulated,
        details={
            "kind": kind,
            "state": state,
            "blocking": blocking,
            "vision_event_id": vision_event_id,
            "scan_event_id": scan_event_id,
            "reconciliation_confidence": reconciliation_confidence,
        },
    )
    enqueue(db, "discrepancy.created", session_id=session.id, data=summary(d))
    return d, True


def transition(
    db: Session,
    d: Discrepancy,
    *,
    new_state: DiscrepancyState,
    actor: Actor,
    action: str,
    reason: str | None = None,
    cart_delta: list[dict[str, Any]] | None = None,
    resolution_code: str | None = None,
) -> ResolutionAction:
    if d.state not in OPEN_DISCREPANCY_STATES:
        raise ConflictError(f"Discrepancy {d.id} is already {d.state.lower()}.", code="discrepancy_closed")
    before = d.state
    d.state = new_state
    d.updated_at = utcnow()
    if new_state in (DiscrepancyState.RESOLVED, DiscrepancyState.DISMISSED):
        d.resolved_at = utcnow()
        d.resolution_code = resolution_code or action
        d.resolution_reason = reason
        d.resolved_by = actor.label
    act = ResolutionAction(
        discrepancy_id=d.id,
        session_id=d.session_id,
        actor_type=actor.type.value,
        actor_id=actor.id,
        action=action,
        reason=reason,
        cart_delta=cart_delta or [],
        state_before=before,
        state_after=new_state,
    )
    db.add(act)
    db.flush()
    event_type = {
        "STAFF_RESOLVED": "STAFF_INTERVENTION",
        "STAFF_DISMISSED": "STAFF_INTERVENTION",
        "STAFF_ESCALATED": "STAFF_INTERVENTION",
        "STAFF_REQUESTED_CUSTOMER": "STAFF_INTERVENTION",
        "AUTO_RESOLVED": "RECONCILIATION_DECISION",
    }.get(action, "CUSTOMER_CONFIRMATION")
    audit.record(
        db,
        actor=actor,
        event_type=event_type,
        summary=(
            f"{KIND_LABELS.get(d.kind, d.kind)} {d.id}: {before.replace('_', ' ').lower()} → "
            f"{new_state.replace('_', ' ').lower()} ({action.replace('_', ' ').lower()})."
        ),
        session_id=d.session_id,
        entity_type="discrepancy",
        entity_id=d.id,
        details={
            "action": action,
            "reason": reason,
            "cart_delta": cart_delta or [],
            "before": before,
            "after": new_state,
        },
    )
    if cart_delta:
        audit.record(
            db,
            actor=actor,
            event_type="CART_CORRECTED",
            summary=f"Cart corrected while resolving {d.id}.",
            session_id=d.session_id,
            entity_type="discrepancy",
            entity_id=d.id,
            details={"cart_delta": cart_delta, "reason": reason},
        )
    enqueue(db, "discrepancy.updated", session_id=d.session_id, data=summary(d))
    return act


def auto_resolve(db: Session, d: Discrepancy, reason: str, code: str) -> None:
    if d.state in OPEN_DISCREPANCY_STATES:
        transition(
            db,
            d,
            new_state=DiscrepancyState.RESOLVED,
            actor=audit.SYSTEM,
            action="AUTO_RESOLVED",
            reason=reason,
            resolution_code=code,
        )


def open_for_session(db: Session, session_id: str) -> list[Discrepancy]:
    return list(
        db.scalars(
            select(Discrepancy)
            .where(Discrepancy.session_id == session_id, Discrepancy.state.in_(OPEN_DISCREPANCY_STATES))
            .order_by(Discrepancy.created_at)
        )
    )
