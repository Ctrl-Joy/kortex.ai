"""Product-recognition adapters.

The reconciliation engine never sees model internals — only `Detection`s and
class labels. A custom-trained, SKU-level model can replace `YoloDetector` by
implementing the same `Detector` protocol.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Protocol

import numpy as np

from kortex_vision.tracker import Detection

log = logging.getLogger("kortex.vision.detector")


class Detector(Protocol):
    name: str
    loaded: bool
    recognition_mode: str

    def class_names(self) -> list[str]: ...

    def detect(self, frame: np.ndarray) -> list[Detection]: ...


class NullDetector:
    """Used when no model can be loaded: camera preview only, no detections."""

    name = "none"
    loaded = False
    recognition_mode = "camera only — no detection model loaded"

    def __init__(self, reason: str = ""):
        self.reason = reason

    def class_names(self) -> list[str]:
        return []

    def detect(self, frame: np.ndarray) -> list[Detection]:
        return []


class YoloDetector:
    """Pretrained Ultralytics YOLO (COCO). Class-level recognition only:
    it can say "bottle", never "Kortex Cola 500 ml"."""

    recognition_mode = "generic COCO classes (class-level, not SKU-level)"

    def __init__(self, model_path: Path, *, conf: float, allowed: set[str], imgsz: int = 480):
        os.environ.setdefault("YOLO_OFFLINE", "1")
        import torch
        from ultralytics import YOLO  # imported lazily: heavy

        # Leave CPU headroom for the camera, preview encoder and the browser.
        torch.set_num_threads(max(1, min(4, (os.cpu_count() or 4) // 2)))

        self.model = YOLO(str(model_path))
        self.name = model_path.stem
        self.conf = conf
        self.imgsz = imgsz
        names = self.model.names
        self._names: dict[int, str] = dict(names) if isinstance(names, dict) else dict(enumerate(names))
        self._allowed_ids = [i for i, n in self._names.items() if n in allowed]
        self.loaded = True

    def class_names(self) -> list[str]:
        return [self._names[i] for i in self._allowed_ids]

    def detect(self, frame: np.ndarray) -> list[Detection]:
        result = self.model.predict(
            frame, conf=self.conf, imgsz=self.imgsz, classes=self._allowed_ids, verbose=False
        )[0]
        out: list[Detection] = []
        boxes = result.boxes
        for xyxy, c, p in zip(boxes.xyxy.tolist(), boxes.cls.tolist(), boxes.conf.tolist(), strict=False):
            out.append(Detection(cls=self._names[int(c)], conf=float(p), bbox=tuple(xyxy)))  # type: ignore[arg-type]
        return out


def load_detector(model_path: Path, *, conf: float, allowed: set[str], imgsz: int) -> Detector:
    if not model_path.exists():
        log.warning("Model file %s not found — running without detection", model_path)
        return NullDetector(f"model file {model_path.name} not found")
    try:
        return YoloDetector(model_path, conf=conf, allowed=allowed, imgsz=imgsz)
    except Exception as exc:  # pragma: no cover - environment dependent
        log.exception("Could not load YOLO model")
        return NullDetector(f"model failed to load: {type(exc).__name__}")
