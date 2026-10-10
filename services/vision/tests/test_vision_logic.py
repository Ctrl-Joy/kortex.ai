"""Tests for tracking, the zone heuristic and the event adapter (no camera needed)."""

from __future__ import annotations

import json

import httpx
import numpy as np

from kortex_vision.detector import NullDetector
from kortex_vision.interaction import ZoneInteractionDetector
from kortex_vision.publisher import EventPublisher, build_event
from kortex_vision.tracker import Detection, IoUTracker, iou

ZONE = (0.0, 0.0, 200.0, 480.0)


def box(cx: float, cy: float = 240, s: float = 60) -> tuple[float, float, float, float]:
    return (cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2)


def test_iou_basics():
    assert iou((0, 0, 10, 10), (0, 0, 10, 10)) == 1.0
    assert iou((0, 0, 10, 10), (20, 20, 30, 30)) == 0.0
    assert 0.3 < iou((0, 0, 10, 10), (5, 0, 15, 10)) < 0.4


def test_tracker_keeps_identity_across_small_motion():
    tr = IoUTracker()
    active, _ = tr.update([Detection("bottle", 0.8, box(100))])
    tid = active[0].id
    for x in range(105, 160, 5):
        active, _ = tr.update([Detection("bottle", 0.8, box(x))])
    assert [t.id for t in active] == [tid]
    assert active[0].frames_seen == 12


def test_tracker_does_not_merge_different_classes():
    tr = IoUTracker()
    tr.update([Detection("bottle", 0.8, box(100))])
    active, _ = tr.update([Detection("cup", 0.8, box(100))])
    assert len(tr.tracks) == 2 and active[0].cls == "cup"


def test_tracker_removes_lost_tracks_after_max_missed():
    tr = IoUTracker(max_missed=2)
    tr.update([Detection("book", 0.9, box(100))])
    removed_all = []
    for _ in range(3):
        _, removed = tr.update([])
        removed_all += removed
    assert len(removed_all) == 1 and not tr.tracks


def run(seq, zone=ZONE):
    tr = IoUTracker(max_missed=3)
    zd = ZoneInteractionDetector(zone=zone, min_in_frames=3, min_out_frames=3, lost_stable_frames=5)
    events = []
    for dets in seq:
        events += zd.update(*tr.update(dets))
    return events


def test_object_leaving_zone_is_candidate_pickup():
    seq = [[Detection("bottle", 0.8, box(x))] for x in [100] * 5 + list(range(130, 330, 25)) + [330] * 4]
    events = run(seq)
    assert [e.event_type for e in events] == ["PICKUP"]
    e = events[0]
    assert e.class_label == "bottle" and e.zone_status == "EXITED_ZONE"
    assert "Heuristic" in (e.uncertainty_reason or "")


def test_pickup_then_return():
    out = [Detection("cup", 0.7, box(x)) for x in range(130, 330, 25)]
    back = [Detection("cup", 0.7, box(x)) for x in range(330, 90, -25)]
    seq = [[Detection("cup", 0.7, box(100))]] * 5 + [[d] for d in out] + [[d] for d in back] + [[Detection("cup", 0.7, box(90))]] * 4
    assert [e.event_type for e in run(seq)] == ["PICKUP", "RETURN"]


def test_object_first_seen_outside_is_not_a_pickup():
    seq = [[Detection("book", 0.8, box(400))]] * 10
    assert run(seq) == []


def test_stationary_object_never_emits():
    assert run([[Detection("bottle", 0.9, box(100))]] * 30) == []


def test_track_lost_in_zone_is_low_certainty_pickup():
    seq = [[Detection("bottle", 0.9, box(100))]] * 8 + [[]] * 5
    events = run(seq)
    assert len(events) == 1
    e = events[0]
    assert e.zone_status == "LOST_IN_ZONE" and e.model_confidence < 0.6
    assert "occlusion" in (e.uncertainty_reason or "")


def test_build_event_payload():
    ev = build_event({"event_type": "PICKUP", "class_label": "bottle", "uncertainty_reason": None}, zone_id="SHELF-A1", model_name="yolo11n")
    assert ev["event_id"].startswith("cam-") and ev["zone_id"] == "SHELF-A1"
    assert "uncertainty_reason" not in ev and ev["model_name"] == "yolo11n"


def test_publisher_sends_with_key_and_tracks_results():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("X-Vision-Key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"event": {"state": "OBSERVED"}, "replay": False})

    pub = EventPublisher("http://api", "secret", client=httpx.Client(transport=httpx.MockTransport(handler)))
    data = pub.send_now(build_event({"event_type": "PICKUP", "class_label": "cup"}, zone_id="Z", model_name="m"))
    assert data["event"]["state"] == "OBSERVED"
    assert seen["key"] == "secret" and seen["body"]["class_label"] == "cup"
    assert pub.sent == 1 and pub.recent[0]["state"] == "OBSERVED"


def test_publisher_does_not_retry_client_errors():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    pub = EventPublisher("http://api", "x", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert pub.send_now({"event_id": "e1", "event_type": "PICKUP"}) is None
    assert calls["n"] == 1 and pub.failed == 1


def test_null_detector_returns_nothing():
    d = NullDetector("no model")
    assert d.detect(np.zeros((10, 10, 3), np.uint8)) == [] and not d.loaded
