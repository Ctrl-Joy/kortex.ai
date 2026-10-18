from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select

from app.api import serializers as ser
from app.api.deps import DB, CustomerAuth, SessionAuth, Staff, staff_actor
from app.core.errors import ConflictError, NotFoundError
from app.models import (
    Discrepancy,
    Product,
    ReconciliationResult,
    ScanEvent,
    SensorEvent,
    ShoppingSession,
    VisionEvent,
)
from app.models.enums import OPEN_DISCREPANCY_STATES, ActorType, SessionStatus
from app.schemas import api as s
from app.services import audit, cart, checkout, pipeline, sessions
from app.services.audit import Actor
from app.websocket.hub import enqueue

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("", response_model=s.SessionCreated, status_code=201)
def start_session(db: DB, body: s.SessionCreate | None = None) -> s.SessionCreated:
    """Start a shopping session (customer app). Returns a one-time customer token."""
    body = body or s.SessionCreate()
    session, token = sessions.create_session(db, actor=Actor(ActorType.CUSTOMER, None), monitor_zone=body.monitor_zone)
    db.commit()
    return s.SessionCreated(session=s.SessionOut.model_validate(session), customer_token=token)


@router.get("", response_model=s.Page[s.SessionSummaryOut])
def list_sessions(
    db: DB,
    _staff: Staff,
    q: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=32),
    attention: bool = False,
    demo: bool | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> s.Page[s.SessionSummaryOut]:
    stmt = select(ShoppingSession)
    if q:
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped}%"
        stmt = stmt.where(
            or_(
                ShoppingSession.id.ilike(like, escape="\\"),
                ShoppingSession.customer_label.ilike(like, escape="\\"),
            )
        )
    if status:
        stmt = stmt.where(ShoppingSession.status == status)
    if demo is not None:
        stmt = stmt.where(ShoppingSession.is_demo.is_(demo))
    if attention:
        stmt = stmt.where(
            ShoppingSession.id.in_(
                select(Discrepancy.session_id).where(
                    Discrepancy.state.in_(OPEN_DISCREPANCY_STATES), Discrepancy.blocking.is_(True)
                )
            )
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = list(db.scalars(stmt.order_by(ShoppingSession.started_at.desc()).limit(limit).offset(offset)))
    return s.Page(items=ser.session_summaries(db, rows), total=total, limit=limit, offset=offset)


@router.get("/{session_id}", response_model=s.SessionDetailOut)
def session_detail(session_id: str, db: DB, _staff: Staff) -> s.SessionDetailOut:
    session = sessions.get_session(db, session_id)
    lines = cart.cart_lines(db, session.id)
    count, subtotal = cart.totals(lines)
    p = checkout.preview(db, session, finalize=False)
    return s.SessionDetailOut(
        session=s.SessionOut.model_validate(session),
        lines=[ser.line(x) for x in lines],
        item_count=count,
        subtotal_paise=subtotal,
        verification=s.VerificationOut(**sessions.verification_summary(db, session)),
        scanned_cart=ser.scanned_cart(db, session.id),
        corrections=ser.corrections(db, session.id),
        checkout=ser.checkout_record(checkout.existing_record(db, session.id)),
        eligibility=ser.preview(p),
    )


@router.get("/{session_id}/state", response_model=s.CustomerSessionState)
def customer_state(session_id: str, db: DB, access: SessionAuth) -> s.CustomerSessionState:
    """Single-round-trip state for the customer app (customer token or staff)."""
    return ser.customer_state(db, access.session)


@router.get("/{session_id}/scans", response_model=list[s.ScanEventOut])
def session_scans(session_id: str, db: DB, _staff: Staff, limit: int = Query(default=100, ge=1, le=500)):
    rows = db.scalars(
        select(ScanEvent).where(ScanEvent.session_id == session_id).order_by(ScanEvent.occurred_at.desc()).limit(limit)
    )
    return [s.ScanEventOut.model_validate(r) for r in rows]


@router.get("/{session_id}/vision-events", response_model=list[s.VisionEventOut])
def session_vision(session_id: str, db: DB, _staff: Staff, limit: int = Query(default=100, ge=1, le=500)):
    rows = db.scalars(
        select(VisionEvent)
        .where(VisionEvent.session_id == session_id)
        .order_by(VisionEvent.occurred_at.desc())
        .limit(limit)
    )
    return [s.VisionEventOut.model_validate(r) for r in rows]


@router.get("/{session_id}/sensor-events", response_model=list[s.SensorEventOut])
def session_sensors(session_id: str, db: DB, _staff: Staff, limit: int = Query(default=100, ge=1, le=500)):
    rows = db.scalars(
        select(SensorEvent)
        .where(SensorEvent.session_id == session_id)
        .order_by(SensorEvent.occurred_at.desc())
        .limit(limit)
    )
    return [s.SensorEventOut.model_validate(r) for r in rows]


@router.get("/{session_id}/reconciliations", response_model=list[s.ReconciliationOut])
def session_reconciliations(session_id: str, db: DB, _staff: Staff, limit: int = Query(default=100, ge=1, le=500)):
    rows = db.scalars(
        select(ReconciliationResult)
        .where(ReconciliationResult.session_id == session_id)
        .order_by(ReconciliationResult.created_at.desc())
        .limit(limit)
    )
    return [s.ReconciliationOut.model_validate(r) for r in rows]


@router.post("/{session_id}/scans", response_model=s.ScanResponse)
def scan(session_id: str, body: s.ScanRequest, db: DB, access: CustomerAuth):
    """Process a barcode scan from the customer's phone."""
    outcome = pipeline.process_scan(
        db,
        access.session,
        code=body.barcode,
        method=body.method,
        actor=access.actor,
        client_scan_id=body.client_scan_id,
    )
    db.commit()
    payload = s.ScanResponse(
        status=outcome.status,
        message=outcome.message,
        scan=s.ScanEventOut.model_validate(outcome.scan) if outcome.scan else None,
        product=ser.product(outcome.product) if outcome.product else None,
        discrepancy_id=outcome.discrepancy.id if outcome.discrepancy else None,
    )
    if not outcome.accepted:
        status = 404 if outcome.status == "REJECTED_UNKNOWN" else 422
        return JSONResponse(
            status_code=status,
            content={
                "error": {
                    "code": outcome.status.lower(),
                    "message": outcome.message,
                    "details": payload.model_dump(mode="json"),
                }
            },
        )
    return payload


@router.put("/{session_id}/items/{product_id}", response_model=s.CustomerSessionState)
def set_quantity(session_id: str, product_id: str, body: s.QuantityRequest, db: DB, access: CustomerAuth):
    product = db.get(Product, product_id)
    if product is None:
        raise NotFoundError("Product not found")
    cart.set_quantity(db, access.session, product, body.quantity, actor=access.actor)
    db.commit()
    return ser.customer_state(db, access.session)


@router.post("/{session_id}/reconcile", response_model=dict)
def force_reconcile(session_id: str, db: DB, staff: Staff) -> dict:
    """Staff/demo: finalise pending observations now instead of waiting for the grace window."""
    session = sessions.get_session(db, session_id)
    n = pipeline.finalize_pending(db, session_id=session.id, force=True)
    audit.record(
        db,
        actor=staff_actor(staff),
        event_type="RECONCILIATION_FORCED",
        summary=f"Staff finalised {n} pending observation(s) without waiting for the grace window.",
        session_id=session.id,
    )
    db.commit()
    return {"finalized": n}


@router.post("/{session_id}/cancel", response_model=s.SessionOut)
def cancel_session(session_id: str, db: DB, access: SessionAuth) -> s.SessionOut:
    session = access.session
    if session.status != SessionStatus.ACTIVE:
        raise ConflictError("Only active sessions can be cancelled")
    session.status = SessionStatus.CANCELLED
    from app.core.time import utcnow

    session.ended_at = utcnow()
    if session.zone_id:
        from app.models import ZoneBinding

        b = db.get(ZoneBinding, session.zone_id)
        if b is not None and b.session_id == session.id:
            sessions.bind_zone(db, b.zone_id, None, actor=access.actor)
    audit.record(
        db,
        actor=access.actor,
        event_type="SESSION_CANCELLED",
        summary="Shopping session cancelled.",
        session_id=session.id,
        entity_type="session",
        entity_id=session.id,
    )
    enqueue(db, "session.updated", session_id=session.id, data={"status": session.status})
    db.commit()
    return s.SessionOut.model_validate(session)
