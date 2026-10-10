"""Helpers that turn ORM objects into response schemas."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    CheckoutRecord,
    Discrepancy,
    Product,
    ReconciliationResult,
    ResolutionAction,
    ScanEvent,
    ShoppingSession,
    VisionEvent,
)
from app.models.enums import OPEN_DISCREPANCY_STATES, ScanStatus
from app.schemas import api as s
from app.services import cart, checkout, sessions
from app.services.discrepancies import KIND_LABELS


def product(p: Product) -> s.ProductOut:
    return s.ProductOut.model_validate(p)


def line(line_: cart.CartLine) -> s.CartLineOut:
    return s.CartLineOut(
        product=product(line_.product),
        quantity=line_.quantity,
        unit_price_paise=line_.unit_price_paise,
        line_total_paise=line_.line_total_paise,
    )


def discrepancy(d: Discrepancy) -> s.DiscrepancyOut:
    out = s.DiscrepancyOut.model_validate(d)
    out.kind_label = KIND_LABELS.get(d.kind, d.kind)
    return out


def discrepancy_detail(db: Session, d: Discrepancy) -> s.DiscrepancyDetailOut:
    base = discrepancy(d).model_dump()
    ve = db.get(VisionEvent, d.vision_event_id) if d.vision_event_id else None
    scan = db.get(ScanEvent, d.scan_event_id) if d.scan_event_id else None
    rr = db.get(ReconciliationResult, d.reconciliation_result_id) if d.reconciliation_result_id else None
    return s.DiscrepancyDetailOut(
        **base,
        actions=[s.ResolutionActionOut.model_validate(a) for a in d.actions],
        vision_event=s.VisionEventOut.model_validate(ve) if ve else None,
        scan_event=s.ScanEventOut.model_validate(scan) if scan else None,
        reconciliation=s.ReconciliationOut.model_validate(rr) if rr else None,
    )


def checkout_record(r: CheckoutRecord | None) -> s.CheckoutRecordOut | None:
    return s.CheckoutRecordOut.model_validate(r) if r else None


def preview(p: checkout.Preview) -> s.CheckoutPreviewOut:
    return s.CheckoutPreviewOut(
        session_id=p.session.id,
        eligible=p.eligible,
        blockers=[s.BlockerOut(**b.__dict__) for b in p.blockers],
        warnings=p.warnings,
        lines=[line(x) for x in p.lines],
        item_count=p.item_count,
        subtotal_paise=p.subtotal_paise,
        total_paise=p.total_paise,
        verification=s.VerificationOut(**p.verification),
        already_checked_out=p.record is not None,
    )


def customer_state(db: Session, session: ShoppingSession) -> s.CustomerSessionState:
    lines = cart.cart_lines(db, session.id)
    count, subtotal = cart.totals(lines)
    discs = db.scalars(
        select(Discrepancy)
        .where(Discrepancy.session_id == session.id)
        .order_by(Discrepancy.created_at.desc())
        .limit(30)
    ).all()
    scans = db.scalars(
        select(ScanEvent).where(ScanEvent.session_id == session.id).order_by(ScanEvent.received_at.desc()).limit(15)
    ).all()
    return s.CustomerSessionState(
        session=s.SessionOut.model_validate(session),
        lines=[line(x) for x in lines],
        item_count=count,
        subtotal_paise=subtotal,
        verification=s.VerificationOut(**sessions.verification_summary(db, session)),
        discrepancies=[discrepancy(d) for d in discs],
        recent_scans=[s.ScanEventOut.model_validate(x) for x in scans],
        checkout=checkout_record(checkout.existing_record(db, session.id)),
    )


def session_summaries(db: Session, rows: list[ShoppingSession]) -> list[s.SessionSummaryOut]:
    ids = [r.id for r in rows]
    if not ids:
        return []
    totals: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))
    from app.models import CartItem

    for sid, qty, amount in db.execute(
        select(CartItem.session_id, func.sum(CartItem.quantity), func.sum(CartItem.quantity * Product.price_paise))
        .join(Product, Product.id == CartItem.product_id)
        .where(CartItem.session_id.in_(ids))
        .group_by(CartItem.session_id)
    ):
        totals[sid] = (int(qty or 0), int(amount or 0))
    scan_counts = dict(
        db.execute(
            select(ScanEvent.session_id, func.count())
            .where(ScanEvent.session_id.in_(ids), ScanEvent.status == ScanStatus.ACCEPTED)
            .group_by(ScanEvent.session_id)
        ).all()
    )
    open_counts: dict[str, int] = defaultdict(int)
    blocking_counts: dict[str, int] = defaultdict(int)
    for sid, blocking, n in db.execute(
        select(Discrepancy.session_id, Discrepancy.blocking, func.count())
        .where(Discrepancy.session_id.in_(ids), Discrepancy.state.in_(OPEN_DISCREPANCY_STATES))
        .group_by(Discrepancy.session_id, Discrepancy.blocking)
    ):
        open_counts[sid] += n
        if blocking:
            blocking_counts[sid] += n
    checkouts = {r.session_id: r for r in db.scalars(select(CheckoutRecord).where(CheckoutRecord.session_id.in_(ids)))}
    out: list[s.SessionSummaryOut] = []
    for r in rows:
        count, subtotal = totals[r.id]
        rec = checkouts.get(r.id)
        if rec is not None:
            verification = "CHECKED_OUT"
            checkout_status = rec.status
        elif r.status != "ACTIVE":
            verification = r.status
            checkout_status = "NOT_STARTED"
        else:
            verification = "NEEDS_ATTENTION" if blocking_counts[r.id] else "VERIFIED"
            checkout_status = "BLOCKED" if blocking_counts[r.id] else "ELIGIBLE" if count else "EMPTY_CART"
        out.append(
            s.SessionSummaryOut(
                **s.SessionOut.model_validate(r).model_dump(),
                item_count=count,
                subtotal_paise=subtotal,
                scan_count=scan_counts.get(r.id, 0),
                open_discrepancies=open_counts[r.id],
                verification_status=verification,
                checkout_status=checkout_status,
            )
        )
    return out


def corrections(db: Session, session_id: str) -> list[s.ResolutionActionOut]:
    acts = db.scalars(
        select(ResolutionAction).where(ResolutionAction.session_id == session_id).order_by(ResolutionAction.created_at)
    ).all()
    return [s.ResolutionActionOut.model_validate(a) for a in acts]


def scanned_cart(db: Session, session_id: str) -> s.CartStateOut:
    """Cart as originally built from scan-like events only (before corrections/voids)."""
    rows = db.execute(
        select(Product, func.count(ScanEvent.id))
        .join(Product, Product.id == ScanEvent.product_id)
        .where(
            ScanEvent.session_id == session_id,
            ScanEvent.method.in_(["CAMERA_BARCODE", "MANUAL_ENTRY", "CATALOGUE_SELECT", "QUANTITY_INCREMENT"]),
            ScanEvent.status.in_([ScanStatus.ACCEPTED, ScanStatus.VOIDED]),
        )
        .group_by(Product.id)
        .order_by(Product.name)
    ).all()
    lines = [
        {
            "product_id": p.id,
            "name": p.name,
            "quantity": int(n),
            "unit_price_paise": p.price_paise,
            "line_total_paise": p.price_paise * int(n),
        }
        for p, n in rows
    ]
    return s.CartStateOut(
        label="As scanned (before corrections)",
        lines=lines,
        item_count=sum(x["quantity"] for x in lines),
        subtotal_paise=sum(x["line_total_paise"] for x in lines),
    )
