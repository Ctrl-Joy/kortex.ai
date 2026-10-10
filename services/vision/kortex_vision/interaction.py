"""Heuristic shelf-interaction inference.

A *candidate* pickup is inferred when a tracked object that rested stably
inside the shelf zone moves out of it and stays out. A *candidate* return is
the reverse. This is a heuristic over bounding boxes — NOT action
recognition — and every event says so. It cannot tell who moved the item.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from kortex_vision.tracker import Track


@dataclass
class _State:
    phase: str = "UNKNOWN"  # UNKNOWN | IN_ZONE | OUT_OF_ZONE
    inside_streak: int = 0
    outside_streak: int = 0
    stable_frames: int = 0
    emitted_pickup: bool = False


@dataclass
class CandidateEvent:
    event_type: str  # PICKUP | RETURN
    track_id: str
    class_label: str
    model_confidence: float
    track_frames: int
    zone_status: str
    uncertainty_reason: str | None
    bbox: list[float]

    def payload(self) -> dict[str, Any]:
        return {
            "event_type": self.event_type,
            "track_id": self.track_id,
            "class_label": self.class_label,
            "model_confidence": round(self.model_confidence, 3),
            "track_frames": self.track_frames,
            "zone_status": self.zone_status,
            "uncertainty_reason": self.uncertainty_reason,
            "bbox": self.bbox,
        }


@dataclass
class ZoneInteractionDetector:
    zone: tuple[float, float, float, float]  # pixel coords x0, y0, x1, y1
    min_in_frames: int = 4
    min_out_frames: int = 3
    lost_stable_frames: int = 12
    _states: dict[int, _State] = field(default_factory=dict)

    def inside(self, track: Track) -> bool:
        cx, cy = track.center
        x0, y0, x1, y1 = self.zone
        return x0 <= cx <= x1 and y0 <= cy <= y1

    def update(self, active: list[Track], removed: list[Track]) -> list[CandidateEvent]:
        events: list[CandidateEvent] = []
        for t in active:
            st = self._states.setdefault(t.id, _State())
            if self.inside(t):
                st.inside_streak += 1
                st.outside_streak = 0
            else:
                st.outside_streak += 1
                st.inside_streak = 0

            if st.phase in ("UNKNOWN", "OUT_OF_ZONE") and st.inside_streak >= self.min_in_frames:
                if st.phase == "OUT_OF_ZONE" and st.emitted_pickup:
                    events.append(self._event("RETURN", t, "ENTERED_ZONE", None))
                    st.emitted_pickup = False
                st.phase = "IN_ZONE"
            elif st.phase == "IN_ZONE" and st.outside_streak >= self.min_out_frames:
                events.append(
                    self._event("PICKUP", t, "EXITED_ZONE", "Heuristic: object left the shelf zone (bounding-box motion)")
                )
                st.phase = "OUT_OF_ZONE"
                st.emitted_pickup = True
            elif st.phase == "UNKNOWN" and st.outside_streak >= self.min_out_frames:
                st.phase = "OUT_OF_ZONE"  # first seen outside: not a pickup
            if st.phase == "IN_ZONE":
                st.stable_frames += 1

        for t in removed:
            st = self._states.pop(t.id, None)
            # A stable shelf item whose track vanished may have been lifted
            # while occluded by a hand. Report it, but explicitly as uncertain.
            if st and st.phase == "IN_ZONE" and st.stable_frames >= self.lost_stable_frames:
                ev = self._event(
                    "PICKUP",
                    t,
                    "LOST_IN_ZONE",
                    "Track lost inside the shelf zone (possible occlusion) — low certainty",
                )
                ev.model_confidence *= 0.6
                events.append(ev)
        return events

    @staticmethod
    def _event(kind: str, t: Track, zone_status: str, reason: str | None) -> CandidateEvent:
        return CandidateEvent(
            event_type=kind,
            track_id=f"cam-{t.id}",
            class_label=t.cls,
            model_confidence=t.mean_conf,
            track_frames=t.frames_seen,
            zone_status=zone_status,
            uncertainty_reason=reason,
            bbox=[round(v, 1) for v in t.bbox],
        )
