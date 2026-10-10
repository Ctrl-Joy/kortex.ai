from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.api.deps import DB, Staff
from app.models import AuditEvent
from app.schemas import api as s

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=s.Page[s.AuditEventOut])
def list_audit(
    db: DB,
    _staff: Staff,
    session_id: str | None = None,
    event_type: str | None = None,
    actor_type: str | None = None,
    simulated: bool | None = None,
    q: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> s.Page[s.AuditEventOut]:
    stmt = select(AuditEvent)
    if session_id:
        stmt = stmt.where(AuditEvent.session_id == session_id)
    if event_type:
        stmt = stmt.where(AuditEvent.event_type == event_type)
    if actor_type:
        stmt = stmt.where(AuditEvent.actor_type == actor_type)
    if simulated is not None:
        stmt = stmt.where(AuditEvent.is_simulated.is_(simulated))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(AuditEvent.summary.ilike(like), AuditEvent.entity_id.ilike(like), AuditEvent.id.ilike(like))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditEvent.seq.desc()).limit(limit).offset(offset))
    return s.Page(items=[s.AuditEventOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/event-types", response_model=list[str])
def event_types(db: DB, _staff: Staff) -> list[str]:
    return list(db.scalars(select(AuditEvent.event_type).distinct().order_by(AuditEvent.event_type)))
