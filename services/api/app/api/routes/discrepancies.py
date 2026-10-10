from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Query
from sqlalchemy import func, select

from app.api import serializers as ser
from app.api.deps import DB, Staff, staff_actor
from app.core.errors import NotFoundError
from app.models import Discrepancy
from app.models.enums import OPEN_DISCREPANCY_STATES, ActorType
from app.schemas import api as s
from app.services import resolutions, sessions
from app.services.audit import Actor

router = APIRouter(prefix="/api/discrepancies", tags=["discrepancies"])


def _get(db, discrepancy_id: str) -> Discrepancy:
    d = db.get(Discrepancy, discrepancy_id)
    if d is None:
        raise NotFoundError(f"Discrepancy {discrepancy_id} not found")
    return d


@router.get("", response_model=s.Page[s.DiscrepancyOut])
def list_discrepancies(
    db: DB,
    _staff: Staff,
    state: str | None = Query(default=None, description="State, or 'OPEN' / 'CLOSED'"),
    kind: str | None = None,
    session_id: str | None = None,
    simulated: bool | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> s.Page[s.DiscrepancyOut]:
    stmt = select(Discrepancy)
    if state == "OPEN":
        stmt = stmt.where(Discrepancy.state.in_(OPEN_DISCREPANCY_STATES))
    elif state == "CLOSED":
        stmt = stmt.where(Discrepancy.state.not_in(OPEN_DISCREPANCY_STATES))
    elif state:
        stmt = stmt.where(Discrepancy.state == state)
    if kind:
        stmt = stmt.where(Discrepancy.kind == kind)
    if session_id:
        stmt = stmt.where(Discrepancy.session_id == session_id)
    if simulated is not None:
        stmt = stmt.where(Discrepancy.is_simulated.is_(simulated))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Discrepancy.created_at.desc()).limit(limit).offset(offset))
    return s.Page(items=[ser.discrepancy(d) for d in rows], total=total, limit=limit, offset=offset)


@router.get("/{discrepancy_id}", response_model=s.DiscrepancyDetailOut)
def get_discrepancy(discrepancy_id: str, db: DB, _staff: Staff) -> s.DiscrepancyDetailOut:
    return ser.discrepancy_detail(db, _get(db, discrepancy_id))


@router.post("/{discrepancy_id}/customer-resolution", response_model=s.DiscrepancyOut)
def customer_resolution(
    discrepancy_id: str,
    body: s.CustomerResolutionIn,
    db: DB,
    x_session_token: Annotated[str | None, Header()] = None,
) -> s.DiscrepancyOut:
    """Customer responds to an alert in their own session (requires X-Session-Token)."""
    d = _get(db, discrepancy_id)
    session = sessions.get_session(db, d.session_id)
    sessions.verify_customer(session, x_session_token)
    resolutions.customer_action(db, session, d, body.option, actor=Actor(ActorType.CUSTOMER, session.customer_label))
    db.commit()
    return ser.discrepancy(d)


@router.post("/{discrepancy_id}/staff-resolution", response_model=s.DiscrepancyDetailOut)
def staff_resolution(discrepancy_id: str, body: s.StaffResolutionIn, db: DB, staff: Staff) -> s.DiscrepancyDetailOut:
    d = _get(db, discrepancy_id)
    session = sessions.get_session(db, d.session_id)
    resolutions.staff_action(
        db, session, d, action=body.action, reason=body.reason, correction=body.correction, actor=staff_actor(staff)
    )
    db.commit()
    db.refresh(d)
    return ser.discrepancy_detail(db, d)
