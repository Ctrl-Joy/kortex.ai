"""Lightweight vision-service simulator for cloud deployments without a webcam.

Sends heartbeats so the dashboard shows "Vision service: Online" and periodically
emits simulated camera events (pickup/putback) so the Live Monitoring page has
real-time activity. Runs as a background thread inside the API process.

Enable with: KORTEX_VISION_SIMULATOR=true (env var on Render).
"""

from __future__ import annotations

import logging
import random
import threading
import time
import uuid
from datetime import UTC, datetime

log = logging.getLogger("kortex.vision_simulator")

# Products from the seed catalog with their model classes
PRODUCTS = [
    {"sku": "MUG-350", "class_label": "cup", "name": "Ceramic Coffee Mug 350"},
    {"sku": "WATER-500", "class_label": "bottle", "name": "Spring Water 500ml"},
    {"sku": "BOWL-RND", "class_label": "bowl", "name": "Round Mixing Bowl"},
    {"sku": "APPLE-GRN", "class_label": "apple", "name": "Green Apple (single)"},
    {"sku": "BAN-5PK", "class_label": "banana", "name": "Banana 5-Pack"},
    {"sku": "BOOK-A5", "class_label": "book", "name": "A5 Lined Notebook"},
    {"sku": "REMOTE-TV", "class_label": "remote", "name": "Universal TV Remote"},
    {"sku": "VASE-CER", "class_label": "vase", "name": "Ceramic Flower Vase"},
]

ZONE_ID = "SHELF-A1"
MODEL_NAME = "yolo11n-sim"


def _heartbeat(db_session_factory, stop_event: threading.Event) -> None:
    """Send periodic heartbeats to mark the vision service as online."""
    from app.models import ServiceHeartbeat
    from app.core.time import utcnow

    while not stop_event.is_set():
        try:
            with db_session_factory() as db:
                hb = db.get(ServiceHeartbeat, "vision")
                if hb is None:
                    hb = ServiceHeartbeat(service="vision")
                    db.add(hb)
                hb.status = {
                    "camera_status": "ONLINE",
                    "camera_index": 0,
                    "model_name": MODEL_NAME,
                    "model_loaded": True,
                    "recognition_mode": "class-level",
                    "fps": round(random.uniform(5.5, 6.5), 2),
                    "zone_id": ZONE_ID,
                    "message": "Cloud simulator — no physical camera",
                }
                hb.last_seen_at = utcnow()

                from app.websocket.hub import enqueue
                enqueue(db, "service.status", data={"service": "vision", "camera_status": "ONLINE"})
                db.commit()
        except Exception:
            log.exception("heartbeat failed")
        stop_event.wait(4)


def _event_emitter(db_session_factory, stop_event: threading.Event) -> None:
    """Emit random pickup/putback events every 8-20 seconds."""
    from app.services import pipeline
    from app.services.audit import Actor
    from app.models.enums import ActorType, EventSource, VisionEventType
    from app.core.time import utcnow

    actor = Actor(ActorType.VISION, "kortex-vision-sim")

    # Wait a bit for the API to fully start
    stop_event.wait(5)

    while not stop_event.is_set():
        try:
            product = random.choice(PRODUCTS)
            event_type = random.choice(["PICKUP", "PICKUP", "PICKUP", "PUTBACK"])
            confidence = round(random.uniform(0.65, 0.95), 2)

            inp = pipeline.VisionInput(
                external_event_id=f"sim-{uuid.uuid4().hex[:12]}",
                zone_id=ZONE_ID,
                event_type=VisionEventType(event_type),
                occurred_at=utcnow(),
                source=EventSource.CAMERA_LIVE,
                is_simulated=True,
                session_id=None,
                track_id=random.randint(100, 999),
                class_label=product["class_label"],
                product_id=None,
                product_sku=product["sku"],
                model_confidence=confidence,
                track_frames=random.randint(8, 30),
                zone_status=None,
                uncertainty_reason=None,
                contradictory=False,
                extra={"model_name": MODEL_NAME},
            )

            with db_session_factory() as db:
                pipeline.ingest_vision_event(db, inp, actor=actor)
                db.commit()

            log.info("sim event: %s %s (conf %.2f)", event_type, product["name"], confidence)
        except Exception:
            log.exception("event emission failed")

        stop_event.wait(random.uniform(8, 20))


_stop = threading.Event()


def start(db_session_factory) -> None:
    """Start heartbeat + event threads. Call once from the API lifespan."""
    log.info("Vision simulator starting (cloud mode, no physical camera)")
    _stop.clear()
    threading.Thread(target=_heartbeat, args=(db_session_factory, _stop), daemon=True, name="vis-sim-hb").start()
    threading.Thread(target=_event_emitter, args=(db_session_factory, _stop), daemon=True, name="vis-sim-ev").start()


def stop() -> None:
    _stop.set()
