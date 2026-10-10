"""Webcam capture with automatic reconnection. Frames are kept in memory only
(latest frame); no video is written to disk."""

from __future__ import annotations

import logging
import sys
import threading
import time

import cv2
import numpy as np

log = logging.getLogger("kortex.vision.camera")

_BACKEND = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY


def enumerate_cameras(max_index: int = 4) -> list[dict]:
    """Probe device indices. OpenCV cannot list names portably, so indices only."""
    found = []
    for idx in range(max_index + 1):
        cap = cv2.VideoCapture(idx, _BACKEND)
        ok = cap.isOpened()
        if ok:
            ok, frame = cap.read()
            found.append({"index": idx, "readable": bool(ok), "shape": list(frame.shape) if ok else None})
        cap.release()
    return found


class CameraSource:
    def __init__(self, index: int, width: int, height: int, url: str | None = None):
        self.index = index
        self.url = url  # network stream (RTSP/HTTP) takes precedence over a device index
        self.width = width
        self.height = height
        self.status = "STARTING"  # STARTING | ONLINE | OFFLINE | DISABLED
        self.message: str | None = None
        self._frame: np.ndarray | None = None
        self._frame_at = 0.0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.listeners: list = []  # callables(status: str)

    def start(self) -> None:
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="camera")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        self._set_status("DISABLED", "Camera stopped")

    def switch(self, index: int) -> None:
        self.stop()
        self.index = index
        self.url = None
        self.start()

    def latest(self) -> tuple[np.ndarray | None, float]:
        with self._lock:
            return (None if self._frame is None else self._frame.copy()), self._frame_at

    def _set_status(self, status: str, message: str | None = None) -> None:
        changed = status != self.status
        self.status = status
        self.message = message
        if changed:
            for fn in list(self.listeners):
                try:
                    fn(status)
                except Exception:  # pragma: no cover
                    log.exception("camera listener failed")

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop.is_set():
            cap = cv2.VideoCapture(self.url) if self.url else cv2.VideoCapture(self.index, _BACKEND)
            if not cap.isOpened():
                cap.release()
                target = "the configured stream URL" if self.url else f"camera {self.index}"
                self._set_status("OFFLINE", f"Cannot open {target}. Is another app using it?")
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 10)
                continue
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
            failures = 0
            backoff = 1.0
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok or frame is None:
                    failures += 1
                    if failures > 15:
                        self._set_status("OFFLINE", "Camera stopped delivering frames; reconnecting…")
                        break
                    time.sleep(0.05)
                    continue
                failures = 0
                with self._lock:
                    self._frame = frame
                    self._frame_at = time.time()
                if self.status != "ONLINE":
                    self._set_status("ONLINE", None)
            cap.release()
