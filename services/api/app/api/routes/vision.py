from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.api.deps import DB, Staff, VisionKey
from app.core.time import utcnow
from app.models import ServiceHeartbeat, VisionEvent
from app.models.enums import ActorType, EventSource, VisionEventType
from app.schemas import api as s
from app.services import pipeline
from app.services.audit import Actor
from app.services.pipeline import VisionInput

router = APIRouter(prefix="/api/vision", tags=["vision"])

HEARTBEAT_STALE_AFTER = timedelta(seconds=15)
VISION_ACTOR = Actor(ActorType.VISION, "kortex-vision")


def to_input(body: s.VisionEventIn, *, source: EventSource, is_simulated: bool, event_id: str) -> VisionInput:
    extra = {}
    if body.model_name:
        extra["model_name"] = body.model_name
    if body.bbox:
        extra["bbox"] = body.bbox[:4]
    return VisionInput(
        external_event_id=event_id,
        zone_id=body.zone_id,
        event_type=VisionEventType(body.event_type),
        occurred_at=body.occurred_at or utcnow(),
        source=source,
        is_simulated=is_simulated,
        session_id=body.session_id,
        track_id=body.track_id,
        class_label=body.class_label,
        product_id=body.product_id,
        product_sku=body.product_sku,
        model_confidence=body.model_confidence,
        track_frames=body.track_frames,
        zone_status=body.zone_status,
        uncertainty_reason=body.uncertainty_reason,
        contradictory=body.contradictory,
        extra=extra,
    )


@router.post("/events", response_model=s.VisionIngestResponse)
def ingest_live_event(body: s.VisionEventIn, db: DB, _key: VisionKey) -> s.VisionIngestResponse:
    """Real camera events from the KORTEX vision service (X-Vision-Key required)."""
    out = pipeline.ingest_vision_event(
        db,
        to_input(body, source=EventSource.CAMERA_LIVE, is_simulated=False, event_id=body.event_id),
        actor=VISION_ACTOR,
    )
    db.commit()
    return s.VisionIngestResponse(
        event=s.VisionEventOut.model_validate(out.event),
        replay=out.replay,
        discrepancy_id=out.discrepancy.id if out.discrepancy else None,
    )


@router.post("/sensor-events", response_model=s.SensorEventOut)
def ingest_live_sensor(body: s.SensorEventIn, db: DB, _key: VisionKey) -> s.SensorEventOut:
    """Live shelf-weight readings (e.g. a future ESP32 + HX711 bridge)."""
    from app.core.ids import new_id

    ev, _ = pipeline.ingest_sensor_event(
        db,
        external_event_id=body.event_id or new_id("SNSLIVE", 12),
        zone_id=body.zone_id,
        delta_grams=body.delta_grams,
        occurred_at=body.occurred_at or utcnow(),
        source=EventSource.SENSOR_LIVE,
        is_simulated=False,
        calibration=body.calibration,
        session_id=body.session_id,
        actor=Actor(ActorType.SENSOR, "shelf-sensor"),
    )
    db.commit()
    return s.SensorEventOut.model_validate(ev)


@router.post("/heartbeat", response_model=dict)
def heartbeat(body: s.HeartbeatIn, db: DB, _key: VisionKey) -> dict:
    hb = db.get(ServiceHeartbeat, "vision")
    if hb is None:
        hb = ServiceHeartbeat(service="vision")
        db.add(hb)
    hb.status = body.model_dump()
    hb.last_seen_at = utcnow()
    from app.websocket.hub import enqueue

    enqueue(db, "service.status", data={"service": "vision", "camera_status": body.camera_status})
    db.commit()
    return {"ok": True}


def vision_status(db) -> dict:
    hb = db.get(ServiceHeartbeat, "vision")
    if hb is None:
        return {
            "online": False,
            "status": None,
            "last_seen_at": None,
            "message": "Vision service has not connected yet.",
        }
    online = utcnow() - hb.last_seen_at < HEARTBEAT_STALE_AFTER
    return {
        "online": online,
        "status": hb.status,
        "last_seen_at": hb.last_seen_at.isoformat(),
        "message": None if online else "No heartbeat in the last 15 seconds — vision service is not running.",
    }


@router.get("/status", response_model=dict)
def get_status(db: DB) -> dict:
    return vision_status(db)


@router.get("/events", response_model=list[s.VisionEventOut])
def recent_events(
    db: DB,
    _staff: Staff,
    session_id: str | None = None,
    source: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
) -> list[s.VisionEventOut]:
    stmt = select(VisionEvent)
    if session_id:
        stmt = stmt.where(VisionEvent.session_id == session_id)
    if source:
        stmt = stmt.where(VisionEvent.source == source)
    rows = db.scalars(stmt.order_by(VisionEvent.received_at.desc()).limit(limit))
    return [s.VisionEventOut.model_validate(r) for r in rows]
