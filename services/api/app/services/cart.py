"""Cart operations. Every unit added is represented by a ScanEvent row so that
physical observations can be matched one-to-one against cart units."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, ValidationFailed
from app.core.time import utcnow
from app.models import CartItem, Discrepancy, Product, ScanEvent, ShoppingSession, VisionEvent
from app.models.enums import (
    OPEN_DISCREPANCY_STATES,
    DiscrepancyKind,
    ScanStatus,
    SessionStatus,
    VisionEventState,
)
from app.services import audit
from app.services.audit import Actor
from app.services.policy_access import current_policy
from app.websocket.hub import enqueue


@dataclass(frozen=True)
class CartLine:
    product: Product
    quantity: int

    @property
    def unit_price_paise(self) -> int:
        return self.product.price_paise

    @property
    def line_total_paise(self) -> int:
        return self.product.price_paise * self.quantity


def cart_lines(db: Session, session_id: str) -> list[CartLine]:
    rows = db.execute(
        select(CartItem, Product)
        .join(Product, Product.id == CartItem.product_id)
        .where(CartItem.session_id == session_id, CartItem.quantity > 0)
        .order_by(Product.name)
    ).all()
    return [CartLine(product=p, quantity=ci.quantity) for ci, p in rows]


def totals(lines: list[CartLine]) -> tuple[int, int]:
    """(item_count, subtotal_paise) computed from authoritative catalogue prices."""
    return sum(line.quantity for line in lines), sum(line.line_total_paise for line in lines)


def ensure_active(session: ShoppingSession) -> None:
    if session.status != SessionStatus.ACTIVE:
        raise ConflictError(
            f"Session {session.id} is {session.status.lower().replace('_', ' ')}; the cart is locked.",
            code="session_locked",
        )


def _cart_item(db: Session, session_id: str, product_id: str) -> CartItem:
    item = db.scalar(select(CartItem).where(CartItem.session_id == session_id, CartItem.product_id == product_id))
    if item is None:
        item = CartItem(session_id=session_id, product_id=product_id, quantity=0)
        db.add(item)
        db.flush()
    return item


def add_unit(
    db: Session,
    session: ShoppingSession,
    product: Product,
    *,
    method: str,
    source: str,
    is_simulated: bool,
    occurred_at: datetime | None = None,
    client_scan_id: str | None = None,
    barcode: str | None = None,
) -> ScanEvent:
    ensure_active(session)
    if not product.active:
        raise ValidationFailed(f"{product.name} is not currently sold.", code="product_inactive")
    now = utcnow()
    scan = ScanEvent(
        session_id=session.id,
        product_id=product.id,
        barcode=barcode or product.barcode,
        method=method,
        source=source,
        is_simulated=is_simulated,
        status=ScanStatus.ACCEPTED,
        client_scan_id=client_scan_id,
        occurred_at=occurred_at or now,
        received_at=now,
    )
    db.add(scan)
    item = _cart_item(db, session.id, product.id)
    item.quantity += 1
    session.last_activity_at = now
    db.flush()
    return scan


def _void_priority(db: Session, session_id: str, product_id: str) -> list[ScanEvent]:
    scans = list(
        db.scalars(
            select(ScanEvent)
            .where(
                ScanEvent.session_id == session_id,
                ScanEvent.product_id == product_id,
                ScanEvent.status == ScanStatus.ACCEPTED,
            )
            .order_by(ScanEvent.occurred_at.desc())
        )
    )
    flagged_ids = set(
        db.scalars(
            select(Discrepancy.scan_event_id).where(
                Discrepancy.session_id == session_id,
                Discrepancy.kind.in_([DiscrepancyKind.DUPLICATE_SCAN, DiscrepancyKind.PICKUP_RETURN]),
                Discrepancy.state.in_(OPEN_DISCREPANCY_STATES),
            )
        )
    )

    def rank(s: ScanEvent) -> int:
        if s.id in flagged_ids:
            return 0
        if s.matched_vision_event_id is None:
            return 1
        return 2

    return sorted(scans, key=rank)  # stable: newest first within each rank


def void_unit(
    db: Session,
    session: ShoppingSession,
    product_id: str,
    *,
    reason: str,
    preferred_scan_id: str | None = None,
) -> ScanEvent:
    """Remove one unit. The scan row is kept (status VOIDED) for the audit trail."""
    ensure_active(session)
    candidates = _void_priority(db, session.id, product_id)
    if preferred_scan_id:
        candidates.sort(key=lambda s: 0 if s.id == preferred_scan_id else 1)
    if not candidates:
        raise ValidationFailed("That product is not in the cart.", code="not_in_cart")
    scan = candidates[0]
    now = utcnow()
    scan.status = ScanStatus.VOIDED
    scan.voided_at = now
    scan.void_reason = reason
    item = _cart_item(db, session.id, product_id)
    item.quantity = max(0, item.quantity - 1)
    session.last_activity_at = now

    # If the voided unit had been matched to a still-standing pickup, that
    # pickup is unverified again and goes back to the pending queue.
    if scan.matched_vision_event_id:
        ve = db.get(VisionEvent, scan.matched_vision_event_id)
        if ve is not None and ve.state == VisionEventState.MATCHED:
            policy = current_policy(db)
            ve.state = VisionEventState.OBSERVED
            ve.matched_scan_id = None
            ve.finalize_after = now + timedelta(seconds=policy.scan_grace_s)
            scan.matched_vision_event_id = None
            audit.record(
                db,
                actor=audit.SYSTEM,
                event_type="RECONCILIATION_REOPENED",
                summary=f"Unit removed from cart; pickup {ve.id} is unverified again.",
                session_id=session.id,
                entity_type="vision_event",
                entity_id=ve.id,
            )
    db.flush()
    return scan


def notify_cart(db: Session, session_id: str) -> None:
    lines = cart_lines(db, session_id)
    count, subtotal = totals(lines)
    enqueue(db, "cart.updated", session_id=session_id, data={"item_count": count, "subtotal_paise": subtotal})


def set_quantity(db: Session, session: ShoppingSession, product: Product, quantity: int, *, actor: Actor) -> None:
    """Customer quantity edit via +/- controls."""
    if quantity < 0 or quantity > 50:
        raise ValidationFailed("Quantity must be between 0 and 50.", code="invalid_quantity")
    ensure_active(session)
    item = _cart_item(db, session.id, product.id)
    current = item.quantity
    if quantity == current:
        return
    if quantity > current:
        for _ in range(quantity - current):
            add_unit(
                db,
                session,
                product,
                method="QUANTITY_INCREMENT",
                source="CUSTOMER_APP",
                is_simulated=False,
            )
    else:
        for _ in range(current - quantity):
            void_unit(db, session, product.id, reason="Customer reduced quantity")
    audit.record(
        db,
        actor=actor,
        event_type="CART_ADJUSTED",
        summary=f"Quantity of {product.name} changed from {current} to {quantity} by the customer.",
        session_id=session.id,
        entity_type="product",
        entity_id=product.id,
        source="CUSTOMER_APP",
        details={"from": current, "to": quantity},
    )
    notify_cart(db, session.id)
