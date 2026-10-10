"""Demo / simulation endpoints (staff only). Everything injected here is
stored with source=SIMULATED (or SENSOR_SIMULATED) and is_simulated=True."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import DB, Staff
from app.api.routes.vision import to_input
from app.core.errors import NotFoundError
from app.core.ids import new_id
from app.core.time import utcnow
from app.db.session import SessionLocal
from app.models.enums import ActorType, EventSource
from app.schemas import api as s
from app.services import demo, pipeline, sessions
from app.services.audit import Actor

router = APIRouter(prefix="/api/demo", tags=["demo"])


def _sim_actor(staff) -> Actor:
    return Actor(ActorType.SIMULATOR, f"injected-by:{staff.username}")


@router.get("/scenarios")
def scenarios(_staff: Staff) -> list[dict]:
    return [
        {
            "code": sc.code,
            "title": sc.title,
            "summary": sc.summary,
            "hint": sc.hint,
            "steps": [st.label for st in sc.steps],
        }
        for sc in demo.SCENARIOS.values()
    ]


@router.post("/scenarios", response_model=s.DemoRunOut, status_code=202)
def run_scenario(body: s.DemoRunIn, _staff: Staff) -> dict:
    """Start a scenario in a NEW demo session. Existing data is never reset."""
    run = demo.start_run(
        body.scenario,
        session_factory=SessionLocal,
        fast=body.fast,
        auto_complete=body.auto_complete,
        step_delay_s=body.step_delay_s,
    )
    return run.to_dict()


@router.get("/runs", response_model=list[s.DemoRunOut])
def runs(_staff: Staff) -> list[dict]:
    return [r.to_dict() for r in demo.list_runs()[:20]]


@router.get("/runs/{run_id}", response_model=s.DemoRunOut)
def run_status(run_id: str, _staff: Staff) -> dict:
    run = demo.get_run(run_id)
    if run is None:
        raise NotFoundError("Demo run not found (runs are kept in memory until the API restarts)")
    return run.to_dict()


@router.post("/runs/{run_id}/autoplay", response_model=s.DemoRunOut)
def autoplay(run_id: str, _staff: Staff) -> dict:
    run = demo.resume_run(run_id, session_factory=SessionLocal)
    if run is None:
        raise NotFoundError("Demo run not found")
    return run.to_dict()


@router.post("/vision-events", response_model=s.VisionIngestResponse)
def inject_vision_event(body: s.SimulatedVisionEventIn, db: DB, staff: Staff) -> s.VisionIngestResponse:
    """Inject a SIMULATED camera event into the real reconciliation pipeline."""
    out = pipeline.ingest_vision_event(
        db,
        to_input(body, source=EventSource.SIMULATED, is_simulated=True, event_id=body.event_id or new_id("SIMVE", 12)),
        actor=_sim_actor(staff),
    )
    db.commit()
    return s.VisionIngestResponse(
        event=s.VisionEventOut.model_validate(out.event),
        replay=out.replay,
        discrepancy_id=out.discrepancy.id if out.discrepancy else None,
    )


@router.post("/sensor-events", response_model=s.SensorEventOut)
def inject_sensor_event(body: s.SensorEventIn, db: DB, staff: Staff) -> s.SensorEventOut:
    ev, _ = pipeline.ingest_sensor_event(
        db,
        external_event_id=body.event_id or new_id("SIMSNS", 12),
        zone_id=body.zone_id,
        delta_grams=body.delta_grams,
        occurred_at=body.occurred_at or utcnow(),
        source=EventSource.SENSOR_SIMULATED,
        is_simulated=True,
        calibration=body.calibration or {"device": "simulated-hx711"},
        session_id=body.session_id,
        actor=_sim_actor(staff),
    )
    db.commit()
    return s.SensorEventOut.model_validate(ev)


@router.post("/sessions/{session_id}/scans", response_model=s.ScanResponse)
def inject_scan(session_id: str, body: s.ScanRequest, db: DB, staff: Staff) -> s.ScanResponse:
    """Inject a SIMULATED barcode scan into a session (for monitoring demos)."""
    from app.api import serializers as ser

    session = sessions.get_session(db, session_id)
    out = pipeline.process_scan(
        db,
        session,
        code=body.barcode,
        method=body.method,
        actor=_sim_actor(staff),
        source=EventSource.SIMULATED,
        is_simulated=True,
        client_scan_id=body.client_scan_id,
    )
    db.commit()
    return s.ScanResponse(
        status=out.status,
        message=out.message,
        scan=s.ScanEventOut.model_validate(out.scan) if out.scan else None,
        product=ser.product(out.product) if out.product else None,
        discrepancy_id=out.discrepancy.id if out.discrepancy else None,
    )


@router.post("/sessions", response_model=s.SessionCreated, status_code=201)
def demo_session(db: DB, staff: Staff) -> s.SessionCreated:
    """Create an empty labelled demo session bound to the demo camera zone."""
    session, token = sessions.create_session(db, actor=_sim_actor(staff), is_demo=True)
    db.commit()
    return s.SessionCreated(session=s.SessionOut.model_validate(session), customer_token=token)
