"""Shopping-session lifecycle and verification summary."""

from __future__ import annotations

import hashlib
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AuthError, NotFoundError
from app.core.ids import new_token
from app.core.security import constant_time_equals
from app.models import Discrepancy, ScanEvent, ShoppingSession, Store, VisionEvent, ZoneBinding
from app.models.enums import (
    OPEN_DISCREPANCY_STATES,
    ScanStatus,
    SessionStatus,
    VisionEventState,
    VisionEventType,
)
from app.services import audit
from app.services.audit import Actor
from app.websocket.hub import enqueue

DEFAULT_ZONE = "SHELF-A1"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_session(db: Session, session_id: str) -> ShoppingSession:
    s = db.get(ShoppingSession, session_id)
    if s is None:
        raise NotFoundError(f"Session {session_id} not found")
    return s


def verify_customer(session: ShoppingSession, token: str | None) -> None:
    if not token or not constant_time_equals(hash_token(token), session.customer_token_hash):
        raise AuthError("Missing or invalid session token for this shopping session.")


def default_store(db: Session) -> Store:
    store = db.scalar(select(Store).order_by(Store.created_at))
    if store is None:
        raise NotFoundError("No store configured; run the seed script.")
    return store


def bind_zone(db: Session, zone_id: str, session_id: str | None, *, actor: Actor) -> ZoneBinding:
    binding = db.get(ZoneBinding, zone_id)
    if binding is None:
        binding = ZoneBinding(zone_id=zone_id, label=zone_id)
        db.add(binding)
    previous = binding.session_id
    binding.session_id = session_id
    if session_id:
        s = get_session(db, session_id)
        s.zone_id = zone_id
    db.flush()
    if previous != session_id:
        audit.record(
            db,
            actor=actor,
            event_type="ZONE_BINDING_CHANGED",
            summary=f"Camera zone {zone_id} now monitors {session_id or 'no session'}.",
            session_id=session_id,
            entity_type="zone",
            entity_id=zone_id,
            details={"previous_session_id": previous},
        )
        enqueue(db, "zone.updated", session_id=session_id, data={"zone_id": zone_id, "session_id": session_id})
    return binding


def create_session(
    db: Session,
    *,
    actor: Actor,
    is_demo: bool = False,
    scenario_code: str | None = None,
    monitor_zone: str | None = DEFAULT_ZONE,
    label: str | None = None,
) -> tuple[ShoppingSession, str]:
    store = default_store(db)
    token = new_token()
    session = ShoppingSession(
        store_id=store.id,
        status=SessionStatus.ACTIVE,
        customer_label=label or f"Guest {secrets.randbelow(9000) + 1000}",
        customer_token_hash=hash_token(token),
        is_demo=is_demo,
        scenario_code=scenario_code,
    )
    db.add(session)
    db.flush()
    audit.record(
        db,
        actor=actor,
        event_type="SESSION_CREATED",
        summary=f"Shopping session started for {session.customer_label}"
        + (f" (demo scenario {scenario_code})" if scenario_code else ""),
        session_id=session.id,
        entity_type="session",
        entity_id=session.id,
        is_simulated=is_demo,
        details={"store_id": store.id, "is_demo": is_demo, "scenario_code": scenario_code},
    )
    if monitor_zone:
        bind_zone(db, monitor_zone, session.id, actor=actor)
    enqueue(db, "session.created", session_id=session.id, data={"id": session.id})
    return session, token


def verification_summary(db: Session, session: ShoppingSession) -> dict:
    scans = db.execute(
        select(ScanEvent.status, ScanEvent.matched_vision_event_id).where(ScanEvent.session_id == session.id)
    ).all()
    accepted = [s for s in scans if s[0] == ScanStatus.ACCEPTED]
    verified_units = sum(1 for s in accepted if s[1] is not None)
    open_rows = db.execute(
        select(Discrepancy.blocking, func.count())
        .where(Discrepancy.session_id == session.id, Discrepancy.state.in_(OPEN_DISCREPANCY_STATES))
        .group_by(Discrepancy.blocking)
    ).all()
    open_blocking = sum(c for b, c in open_rows if b)
    open_advisory = sum(c for b, c in open_rows if not b)
    pending = db.scalar(
        select(func.count()).where(
            VisionEvent.session_id == session.id,
            VisionEvent.event_type == VisionEventType.PICKUP,
            VisionEvent.state == VisionEventState.OBSERVED,
        )
    )
    observations = db.scalar(
        select(func.count()).where(
            VisionEvent.session_id == session.id,
            VisionEvent.event_type.in_([VisionEventType.PICKUP, VisionEventType.RETURN]),
        )
    )
    if session.status in (SessionStatus.CHECKOUT_AUTHORIZED, SessionStatus.EXITED):
        status = "CHECKED_OUT"
    elif open_blocking:
        status = "NEEDS_ATTENTION"
    elif pending:
        status = "VERIFYING"
    else:
        status = "VERIFIED"
    return {
        "status": status,
        "accepted_units": len(accepted),
        "visually_verified_units": verified_units,
        "unverified_units": len(accepted) - verified_units,
        "camera_observations": observations or 0,
        "pending_observations": pending or 0,
        "open_blocking": open_blocking,
        "open_advisory": open_advisory,
        "camera_gap_open": session.camera_gap_open,
        "note": (
            "Units without a camera observation are not suspicious: cameras do not see every interaction. "
            "Only unexplained physical observations require verification."
        ),
    }
