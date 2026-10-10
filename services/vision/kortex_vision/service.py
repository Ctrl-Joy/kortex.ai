"""Vision pipeline orchestration: camera → detector → tracker → zone heuristic → API."""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

import cv2
import numpy as np

from kortex_vision.camera import CameraSource
from kortex_vision.config import RETAIL_CLASSES, VisionSettings
from kortex_vision.detector import Detector, load_detector
from kortex_vision.interaction import ZoneInteractionDetector
from kortex_vision.publisher import EventPublisher, build_event
from kortex_vision.tracker import IoUTracker, Track

log = logging.getLogger("kortex.vision")

CYAN = (238, 211, 34)  # BGR
AMBER = (36, 191, 251)
GREEN = (153, 211, 52)
WHITE = (240, 237, 231)


class VisionService:
    def __init__(self, settings: VisionSettings, *, detector: Detector | None = None, publisher: EventPublisher | None = None):
        self.s = settings
        self.camera = CameraSource(settings.camera_index, settings.frame_width, settings.frame_height, url=settings.camera_url)
        self.detector = detector or load_detector(
            settings.model_path, conf=settings.conf_threshold, allowed=RETAIL_CLASSES, imgsz=settings.imgsz
        )
        self.publisher = publisher or EventPublisher(settings.api_url, settings.vision_api_key)
        self.tracker = IoUTracker(iou_threshold=0.25, max_missed=max(4, int(settings.process_fps * 1.5)))
        self.interaction: ZoneInteractionDetector | None = None
        self.class_map: dict[str, str] = {}
        self.fps = 0.0
        self._jpeg: bytes | None = None
        self._jpeg_lock = threading.Lock()
        self._jpeg_event = threading.Condition(self._jpeg_lock)
        self._stop = threading.Event()
        self._was_online = False
        self.events_emitted = 0
        self.camera.listeners.append(self._on_camera_status)

    # ------------------------------------------------------------ lifecycle
    def start(self) -> None:
        self.publisher.start()
        self.camera.start()
        threading.Thread(target=self._process_loop, daemon=True, name="process").start()
        threading.Thread(target=self._heartbeat_loop, daemon=True, name="heartbeat").start()

    def stop(self) -> None:
        self._stop.set()
        self.camera.stop()
        self.publisher.stop()

    # --------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        return {
            "camera_status": self.camera.status,
            "camera_index": self.camera.index,
            "model_name": self.detector.name,
            "model_loaded": self.detector.loaded,
            "recognition_mode": self.detector.recognition_mode,
            "fps": round(self.fps, 2),
            "zone_id": self.s.zone_id,
            "detectable_classes": self.detector.class_names(),
            "mapped_classes": self.class_map,
            "message": self.camera.message or getattr(self.detector, "reason", None),
        }

    def latest_jpeg(self, wait: float = 1.0) -> bytes | None:
        with self._jpeg_event:
            self._jpeg_event.wait(timeout=wait)
            return self._jpeg

    # ---------------------------------------------------------------- loops
    def _on_camera_status(self, status: str) -> None:
        # Camera outages are reported so reconciliation knows evidence is incomplete.
        if status == "ONLINE":
            if self._was_online:
                self.publisher.publish(build_event({"event_type": "CAMERA_ONLINE"}, zone_id=self.s.zone_id, model_name=self.detector.name))
            self._was_online = True
        elif status == "OFFLINE" and self._was_online:
            self.publisher.publish(build_event({"event_type": "CAMERA_OFFLINE"}, zone_id=self.s.zone_id, model_name=self.detector.name))

    def _heartbeat_loop(self) -> None:
        last_map = 0.0
        while not self._stop.is_set():
            if time.time() - last_map > 30:
                self.class_map = self.publisher.fetch_class_map() or self.class_map
                last_map = time.time()
            self.publisher.heartbeat(self.status())
            self._stop.wait(4)

    def _process_loop(self) -> None:
        period = 1.0 / max(0.5, self.s.process_fps)
        last_frame_at = 0.0
        while not self._stop.is_set():
            t0 = time.time()
            frame, at = self.camera.latest()
            if frame is None or at == last_frame_at:
                self._render_placeholder()
                time.sleep(0.1)
                continue
            last_frame_at = at
            h, w = frame.shape[:2]
            if self.interaction is None or self.interaction.zone[2] > w + 1:
                x0, y0, x1, y1 = self.s.shelf_zone
                self.interaction = ZoneInteractionDetector(zone=(x0 * w, y0 * h, x1 * w, y1 * h))
            try:
                detections = self.detector.detect(frame)
            except Exception:  # pragma: no cover
                log.exception("detection failed")
                detections = []
            active, removed = self.tracker.update(detections)
            for ev in self.interaction.update(active, removed):
                self.events_emitted += 1
                log.info("candidate %s: %s (track %s, conf %.2f)", ev.event_type, ev.class_label, ev.track_id, ev.model_confidence)
                self.publisher.publish(build_event(ev.payload(), zone_id=self.s.zone_id, model_name=self.detector.name))
            self._render(frame, active)
            dt = time.time() - t0
            self.fps = 0.8 * self.fps + 0.2 * (1.0 / max(dt, period)) if self.fps else 1.0 / max(dt, period)
            time.sleep(max(0.0, period - dt))

    # ------------------------------------------------------------ rendering
    def _publish_jpeg(self, img: np.ndarray) -> None:
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if ok:
            with self._jpeg_event:
                self._jpeg = buf.tobytes()
                self._jpeg_event.notify_all()

    def _render_placeholder(self) -> None:
        img = np.full((self.s.frame_height, self.s.frame_width, 3), (20, 14, 8), np.uint8)
        cv2.putText(img, f"Camera {self.camera.status}", (24, 48), cv2.FONT_HERSHEY_SIMPLEX, 0.8, WHITE, 2, cv2.LINE_AA)
        if self.camera.message:
            cv2.putText(img, self.camera.message[:70], (24, 84), cv2.FONT_HERSHEY_SIMPLEX, 0.5, AMBER, 1, cv2.LINE_AA)
        self._publish_jpeg(img)

    def _render(self, frame: np.ndarray, tracks: list[Track]) -> None:
        img = frame.copy()
        assert self.interaction is not None
        x0, y0, x1, y1 = (int(v) for v in self.interaction.zone)
        overlay = img.copy()
        cv2.rectangle(overlay, (x0, y0), (x1, y1), CYAN, -1)
        img = cv2.addWeighted(overlay, 0.08, img, 0.92, 0)
        cv2.rectangle(img, (x0, y0), (x1, y1), CYAN, 1)
        cv2.putText(img, f"SHELF ZONE {self.s.zone_id}", (x0 + 8, y0 + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, CYAN, 1, cv2.LINE_AA)
        # Boxes come ONLY from real model detections in this frame.
        for t in tracks:
            if t.missed:
                continue
            bx1, by1, bx2, by2 = (int(v) for v in t.bbox)
            inside = self.interaction.inside(t)
            color = GREEN if inside else AMBER
            cv2.rectangle(img, (bx1, by1), (bx2, by2), color, 2)
            mapped = self.class_map.get(t.cls)
            label = f"#{t.id} {t.cls} {t.mean_conf:.2f}" + (f" ~{mapped}" if mapped else "")
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.48, 1)
            cv2.rectangle(img, (bx1, max(0, by1 - th - 8)), (bx1 + tw + 8, by1), color, -1)
            cv2.putText(img, label, (bx1 + 4, by1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (10, 10, 10), 1, cv2.LINE_AA)
        h = img.shape[0]
        cv2.rectangle(img, (0, h - 24), (img.shape[1], h), (12, 8, 6), -1)
        cv2.putText(
            img,
            f"KORTEX VISION | {self.detector.name} | class-level | candidate events are heuristic | {self.fps:.1f} fps",
            (8, h - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            WHITE,
            1,
            cv2.LINE_AA,
        )
        self._publish_jpeg(img)
