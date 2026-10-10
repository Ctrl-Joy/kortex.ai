"""Health, settings (policy), camera zones and dashboard statistics."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy import func, select, text

from app.api import serializers as ser
from app.api.deps import DB, Manager, Staff, staff_actor
from app.api.routes.vision import vision_status
from app.core.config import get_settings
from app.core.time import utcnow
from app.models import (
    AuditEvent,
    CheckoutRecord,
    Discrepancy,
    ScanEvent,
    ShoppingSession,
    VisionEvent,
    ZoneBinding,
)
from app.models.enums import OPEN_DISCREPANCY_STATES, DiscrepancyState, SessionStatus
from app.schemas import api as s
from app.services import audit, sessions, settings_store
from app.services.discrepancies import KIND_LABELS
from app.services.policy import POLICY_BOUNDS, POLICY_DESCRIPTIONS, Policy
from app.services.policy_access import invalidate
from app.websocket.hub import hub

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health(db: DB) -> dict:
    db_ok = True
    db_error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - reported to the client
        db_ok = False
        db_error = type(exc).__name__
    settings = get_settings()
    return {
        "api": {"ok": True, "version": "1.0.0", "environment": settings.environment},
        "database": {
            "ok": db_ok,
            "engine": "sqlite" if "sqlite" in settings.resolved_database_url else "other",
            "error": db_error,
        },
        "websocket": {"ok": True, "clients": hub.client_count},
        "vision": vision_status(db),
        "simulation": {"enabled": True, "note": "Simulated events are always labelled SIMULATED."},
        "security": {"insecure_dev_secret": settings.uses_insecure_defaults},
        "time": utcnow().isoformat(),
    }


# ---------------------------------------------------------------- policy ---


def _policy_out(policy: Policy) -> s.PolicyOut:
    return s.PolicyOut(
        values=policy.to_dict(),
        defaults=Policy().to_dict(),
        descriptions=POLICY_DESCRIPTIONS,
        bounds={k: [float(a), float(b)] for k, (a, b) in POLICY_BOUNDS.items()},
        note="Prototype settings tuned for the controlled demo. Not scientifically validated.",
    )


@router.get("/settings/policy", response_model=s.PolicyOut)
def get_policy(db: DB, _staff: Staff) -> s.PolicyOut:
    return _policy_out(settings_store.load_policy(db))


@router.put("/settings/policy", response_model=s.PolicyOut)
def put_policy(body: s.PolicyUpdateIn, db: DB, manager: Manager) -> s.PolicyOut:
    policy = settings_store.update_policy(db, body.values, updated_by=manager.username)
    invalidate(db)
    audit.record(
        db,
        actor=staff_actor(manager),
        event_type="SETTINGS_CHANGED",
        summary=f"Reconciliation policy updated: {', '.join(sorted(body.values))}.",
        details=body.values,
    )
    db.commit()
    return _policy_out(policy)


@router.post("/settings/policy/reset", response_model=s.PolicyOut)
def reset_policy(db: DB, manager: Manager) -> s.PolicyOut:
    policy = settings_store.reset_policy(db, updated_by=manager.username)
    invalidate(db)
    audit.record(
        db,
        actor=staff_actor(manager),
        event_type="SETTINGS_CHANGED",
        summary="Reconciliation policy reset to defaults.",
    )
    db.commit()
    return _policy_out(policy)


# ----------------------------------------------------------------- zones ---


@router.get("/zones", response_model=list[s.ZoneOut])
def list_zones(db: DB) -> list[s.ZoneOut]:
    return [s.ZoneOut.model_validate(z) for z in db.scalars(select(ZoneBinding).order_by(ZoneBinding.zone_id))]


@router.put("/zones/{zone_id}", response_model=s.ZoneOut)
def bind_zone(zone_id: str, body: s.ZoneBindIn, db: DB, staff: Staff) -> s.ZoneOut:
    if body.session_id:
        session = sessions.get_session(db, body.session_id)
        if session.status != SessionStatus.ACTIVE:
            from app.core.errors import ConflictError

            raise ConflictError("Only active sessions can be monitored")
    z = sessions.bind_zone(db, zone_id, body.session_id, actor=staff_actor(staff))
    db.commit()
    return s.ZoneOut.model_validate(z)


# ----------------------------------------------------------------- stats ---


@router.get("/stats/overview")
def overview(db: DB, _staff: Staff) -> dict:
    now = utcnow()
    active = db.scalar(select(func.count()).where(ShoppingSession.status == SessionStatus.ACTIVE)) or 0
    awaiting_review_sessions = (
        db.scalar(
            select(func.count(func.distinct(Discrepancy.session_id))).where(
                Discrepancy.state.in_([DiscrepancyState.AWAITING_STAFF, DiscrepancyState.ESCALATED])
            )
        )
        or 0
    )
    open_discrepancies = db.scalar(select(func.count()).where(Discrepancy.state.in_(OPEN_DISCREPANCY_STATES))) or 0
    awaiting_customer = (
        db.scalar(select(func.count()).where(Discrepancy.state == DiscrepancyState.AWAITING_CUSTOMER)) or 0
    )
    resolved = db.scalar(select(func.count()).where(Discrepancy.state == DiscrepancyState.RESOLVED)) or 0
    dismissed = db.scalar(select(func.count()).where(Discrepancy.state == DiscrepancyState.DISMISSED)) or 0
    authorized = db.scalar(select(func.count()).select_from(CheckoutRecord)) or 0
    denied = db.scalar(select(func.count()).where(AuditEvent.event_type == "CHECKOUT_DENIED")) or 0
    blocked_now = (
        db.scalar(
            select(func.count(func.distinct(Discrepancy.session_id)))
            .join(ShoppingSession, ShoppingSession.id == Discrepancy.session_id)
            .where(
                Discrepancy.state.in_(OPEN_DISCREPANCY_STATES),
                Discrepancy.blocking.is_(True),
                ShoppingSession.status == SessionStatus.ACTIVE,
            )
        )
        or 0
    )
    revenue = db.scalar(select(func.coalesce(func.sum(CheckoutRecord.total_paise), 0))) or 0

    distribution = [
        {"kind": kind, "label": KIND_LABELS.get(kind, kind), "count": n}
        for kind, n in db.execute(select(Discrepancy.kind, func.count()).group_by(Discrepancy.kind)).all()
    ]
    distribution.sort(key=lambda r: -r["count"])

    # Last 7 days of activity (UTC day buckets; the client renders local labels).
    since = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
    days = [(since + timedelta(days=i)).date() for i in range(7)]
    sess_c = Counter(
        r.date() for r in db.scalars(select(ShoppingSession.started_at).where(ShoppingSession.started_at >= since))
    )
    chk_c = Counter(
        r.date() for r in db.scalars(select(CheckoutRecord.authorized_at).where(CheckoutRecord.authorized_at >= since))
    )
    disc_c = Counter(
        r.date() for r in db.scalars(select(Discrepancy.created_at).where(Discrepancy.created_at >= since))
    )
    activity = [
        {
            "date": d.isoformat(),
            "sessions": sess_c.get(d, 0),
            "checkouts": chk_c.get(d, 0),
            "discrepancies": disc_c.get(d, 0),
        }
        for d in days
    ]

    source_counts = {
        src: n for src, n in db.execute(select(VisionEvent.source, func.count()).group_by(VisionEvent.source)).all()
    }
    scan_sources = {
        src: n for src, n in db.execute(select(ScanEvent.source, func.count()).group_by(ScanEvent.source)).all()
    }
    recent = list(db.scalars(select(ShoppingSession).order_by(ShoppingSession.started_at.desc()).limit(6)))

    return {
        "generated_at": now.isoformat(),
        "kpis": {
            "active_sessions": active,
            "sessions_awaiting_review": awaiting_review_sessions,
            "open_discrepancies": open_discrepancies,
            "awaiting_customer": awaiting_customer,
            "resolved_discrepancies": resolved,
            "dismissed_discrepancies": dismissed,
            "checkouts_authorized": authorized,
            "checkouts_denied": denied,
            "sessions_blocked_now": blocked_now,
            "revenue_paise": int(revenue),
        },
        "discrepancy_distribution": distribution,
        "activity": activity,
        "event_sources": {"vision": source_counts, "scans": scan_sources},
        "recent_sessions": [r.model_dump(mode="json") for r in ser.session_summaries(db, recent)],
        "vision": vision_status(db),
        "data_note": "All figures are computed from the local database. Sessions flagged is_demo were created by the seed script or demo scenarios.",
    }
