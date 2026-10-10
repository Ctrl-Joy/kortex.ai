"""Lightweight IoU multi-object tracker (tested, dependency-free).

Detections are greedily associated to existing tracks of the same class by
intersection-over-union. It is intentionally simple: good enough for a
controlled demo shelf, and swappable for ByteTrack/BoT-SORT later.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from itertools import count

BBox = tuple[float, float, float, float]  # x1, y1, x2, y2 (pixels)


@dataclass(frozen=True)
class Detection:
    cls: str
    conf: float
    bbox: BBox


@dataclass
class Track:
    id: int
    cls: str
    bbox: BBox
    frames_seen: int = 1
    missed: int = 0
    confs: deque[float] = field(default_factory=lambda: deque(maxlen=15))

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return (x1 + x2) / 2, (y1 + y2) / 2

    @property
    def mean_conf(self) -> float:
        return sum(self.confs) / len(self.confs) if self.confs else 0.0


def iou(a: BBox, b: BBox) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    return inter / (area_a + area_b - inter)


class IoUTracker:
    def __init__(self, iou_threshold: float = 0.25, max_missed: int = 8):
        self.iou_threshold = iou_threshold
        self.max_missed = max_missed
        self.tracks: dict[int, Track] = {}
        self._ids = count(1)

    def update(self, detections: list[Detection]) -> tuple[list[Track], list[Track]]:
        """Return (active tracks updated this frame, tracks removed this frame)."""
        pairs = sorted(
            (
                (iou(t.bbox, d.bbox), tid, di)
                for tid, t in self.tracks.items()
                for di, d in enumerate(detections)
                if t.cls == d.cls
            ),
            reverse=True,
        )
        used_tracks: set[int] = set()
        used_dets: set[int] = set()
        for score, tid, di in pairs:
            if score < self.iou_threshold:
                break
            if tid in used_tracks or di in used_dets:
                continue
            t, d = self.tracks[tid], detections[di]
            t.bbox = d.bbox
            t.frames_seen += 1
            t.missed = 0
            t.confs.append(d.conf)
            used_tracks.add(tid)
            used_dets.add(di)

        for di, d in enumerate(detections):
            if di in used_dets:
                continue
            tid = next(self._ids)
            t = Track(id=tid, cls=d.cls, bbox=d.bbox)
            t.confs.append(d.conf)
            self.tracks[tid] = t
            used_tracks.add(tid)

        removed: list[Track] = []
        for tid in list(self.tracks):
            if tid in used_tracks:
                continue
            t = self.tracks[tid]
            t.missed += 1
            if t.missed > self.max_missed:
                removed.append(self.tracks.pop(tid))

        active = [self.tracks[tid] for tid in used_tracks if tid in self.tracks]
        return active, removed
