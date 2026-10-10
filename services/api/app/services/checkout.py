"""The single authoritative checkout-eligibility and authorization service."""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ConflictError
from app.core.time import utcnow
from app.models import CheckoutRecord, ShoppingSession, ZoneBinding
from app.models.enums import SessionStatus
from app.services import audit, cart, discrepancies, pipeline, sessions
from app.services.audit import Actor
from app.services.reconciliation import CheckoutBlocker, CheckoutInput, evaluate_checkout
from app.websocket.hub import enqueue


@dataclass
class Preview:
    session: ShoppingSession
    lines: list[cart.CartLine]
    item_count: int
    subtotal_paise: int
    total_paise: int
    eligible: bool
    blockers: list[CheckoutBlocker]
    warnings: list[str] = field(default_factory=list)
    verification: dict = field(default_factory=dict)
    record: CheckoutRecord | None = None


def existing_record(db: Session, session_id: str) -> CheckoutRecord | None:
    return db.scalar(select(CheckoutRecord).where(CheckoutRecord.session_id == session_id))


def preview(db: Session, session: ShoppingSession, *, finalize: bool = True) -> Preview:
    """Compute eligibility. A checkout request means shopping has finished, so
    pending observations are finalised immediately instead of waiting out the
    remaining grace window."""
    record = existing_record(db, session.id)
    if finalize and record is None and session.status == SessionStatus.ACTIVE:
        pipeline.finalize_pending(db, session_id=session.id, force=True)
    lines = cart.cart_lines(db, session.id)
    count, subtotal = cart.totals(lines)
    open_items = discrepancies.open_for_session(db, session.id)
    blocking = [(d.id, d.kind, d.state) for d in open_items if d.blocking]
    warnings = [d.customer_message for d in open_items if not d.blocking]
    result = evaluate_checkout(
        CheckoutInput(
            session_status=session.status,
            already_checked_out=record is not None,
            cart_lines=[(line.product.id, line.quantity, line.product.active) for line in lines],
            blocking_discrepancies=blocking,
            pending_observations=pipeline.pending_count(db, session.id),
        )
    )
    return Preview(
        session=session,
        lines=lines,
        item_count=count,
        subtotal_paise=subtotal,
        total_paise=subtotal,  # prices are GST-inclusive MRP; no extra tax line in the prototype
        eligible=result.eligible,
        blockers=result.blockers,
        warnings=warnings,
        verification=sessions.verification_summary(db, session),
        record=record,
    )


class CheckoutDenied(ConflictError):
    code = "checkout_blocked"


def authorize(db: Session, session: ShoppingSession, *, actor: Actor) -> tuple[CheckoutRecord, bool]:
    """Authorize checkout. Idempotent: repeated calls return the same record.

    Returns (record, created).
    """
    record = existing_record(db, session.id)
    if record is not None:
        return record, False

    p = preview(db, session)
    if not p.eligible:
        audit.record(
            db,
            actor=actor,
            event_type="CHECKOUT_DENIED",
            summary=f"Checkout denied: {'; '.join(b.message for b in p.blockers)}",
            session_id=session.id,
            entity_type="session",
            entity_id=session.id,
            details={"blockers": [b.__dict__ for b in p.blockers]},
        )
        enqueue(db, "checkout.updated", session_id=session.id, data={"status": "BLOCKED"})
        db.commit()
        raise CheckoutDenied(
            "Checkout is blocked until the listed checks are completed.",
            details={"blockers": [b.__dict__ for b in p.blockers]},
        )

    lines = [
        {
            "product_id": line.product.id,
            "sku": line.product.sku,
            "barcode": line.product.barcode,
            "name": line.product.name,
            "quantity": line.quantity,
            "unit_price_paise": line.unit_price_paise,
            "line_total_paise": line.line_total_paise,
        }
        for line in p.lines
    ]
    record = CheckoutRecord(
        session_id=session.id,
        status="AUTHORIZED",
        item_count=p.item_count,
        subtotal_paise=p.subtotal_paise,
        total_paise=p.total_paise,
        lines=lines,
        payment_mode="SIMULATED",
        exit_code="".join(secrets.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(6)),
        verification_summary=p.verification,
    )
    db.add(record)
    session.status = SessionStatus.CHECKOUT_AUTHORIZED
    session.last_activity_at = utcnow()
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = existing_record(db, session.id)
        if existing is None:
            raise
        return existing, False
    audit.record(
        db,
        actor=actor,
        event_type="CHECKOUT_AUTHORIZED",
        summary=f"Checkout authorized (SIMULATED payment) — {p.item_count} item(s), total ₹{p.total_paise / 100:.2f}.",
        session_id=session.id,
        entity_type="checkout",
        entity_id=record.id,
        details={"total_paise": p.total_paise, "lines": lines, "payment_mode": "SIMULATED"},
    )
    enqueue(db, "checkout.updated", session_id=session.id, data={"status": "AUTHORIZED", "record_id": record.id})
    return record, True


def confirm_exit(db: Session, session: ShoppingSession, *, actor: Actor) -> CheckoutRecord:
    record = existing_record(db, session.id)
    if record is None:
        raise ConflictError("Checkout has not been authorized for this session.", code="not_authorized")
    if record.exited_at is not None:
        return record
    record.exited_at = utcnow()
    record.status = "EXITED"
    session.status = SessionStatus.EXITED
    session.ended_at = utcnow()
    audit.record(
        db,
        actor=actor,
        event_type="EXIT_CONFIRMED",
        summary=f"[SIMULATED] Exit gate confirmed with code {record.exit_code}.",
        session_id=session.id,
        entity_type="checkout",
        entity_id=record.id,
        is_simulated=True,
    )
    # Release any camera zone still bound to this session.
    binding = db.get(ZoneBinding, session.zone_id) if session.zone_id else None
    if binding is not None and binding.session_id == session.id:
        sessions.bind_zone(db, binding.zone_id, None, actor=actor)
    enqueue(db, "checkout.updated", session_id=session.id, data={"status": "EXITED"})
    return record
