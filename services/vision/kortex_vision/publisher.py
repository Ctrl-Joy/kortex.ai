"""Event adapter: publishes candidate events and heartbeats to the KORTEX API.

Real camera events go to POST /api/vision/events (authenticated with
X-Vision-Key) and are stored with source=CAMERA_LIVE — never confused with
simulated events, which only enter through the staff-only demo endpoints.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx

log = logging.getLogger("kortex.vision.publisher")


def build_event(payload: dict[str, Any], *, zone_id: str, model_name: str) -> dict[str, Any]:
    body = {
        "event_id": f"cam-{uuid.uuid4().hex}",
        "zone_id": zone_id,
        "occurred_at": datetime.now(UTC).isoformat(),
        "model_name": model_name,
        **payload,
    }
    return {k: v for k, v in body.items() if v is not None}


class EventPublisher:
    def __init__(self, api_url: str, api_key: str, *, client: httpx.Client | None = None):
        self.api_url = api_url.rstrip("/")
        self.client = client or httpx.Client(timeout=5.0, headers={"X-Vision-Key": api_key})
        if client is not None:
            self.client.headers["X-Vision-Key"] = api_key
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=500)
        self._stop = threading.Event()
        self.sent = 0
        self.failed = 0
        self.last_error: str | None = None
        self.recent: list[dict[str, Any]] = []

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True, name="publisher").start()

    def stop(self) -> None:
        self._stop.set()

    def publish(self, event: dict[str, Any]) -> None:
        try:
            self._queue.put_nowait(event)
        except queue.Full:  # pragma: no cover
            log.warning("event queue full; dropping %s", event.get("event_type"))

    def send_now(self, event: dict[str, Any]) -> dict[str, Any] | None:
        """Synchronous send with idempotent retries (event_id makes retries safe)."""
        for attempt in range(4):
            try:
                r = self.client.post(f"{self.api_url}/api/vision/events", json=event)
                if r.status_code < 500:
                    if r.status_code >= 400:
                        self.failed += 1
                        self.last_error = f"HTTP {r.status_code}: {r.text[:200]}"
                        log.warning("API rejected event: %s", self.last_error)
                        return None
                    self.sent += 1
                    data = r.json()
                    self.recent = ([{**event, "state": data["event"]["state"]}] + self.recent)[:20]
                    return data
            except httpx.HTTPError as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(min(2**attempt * 0.5, 4))
        self.failed += 1
        return None

    def heartbeat(self, status: dict[str, Any]) -> bool:
        try:
            r = self.client.post(f"{self.api_url}/api/vision/heartbeat", json=status)
            return r.status_code == 200
        except httpx.HTTPError as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return False

    def fetch_class_map(self) -> dict[str, str]:
        """model_class → SKU from the catalogue (class-level association only)."""
        try:
            r = self.client.get(f"{self.api_url}/api/products")
            r.raise_for_status()
            return {p["model_class"]: p["sku"] for p in r.json() if p.get("model_class")}
        except httpx.HTTPError:
            return {}

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                event = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            self.send_now(event)
