"""Unit tests for the pure reconciliation engine (no database, no HTTP)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.models.enums import DiscrepancyKind, DiscrepancyState, ReconciliationOutcome
from app.services.policy import Policy
from app.services.reconciliation import (
    CheckoutInput,
    PickupView,
    ScanView,
    SensorView,
    classify_repeat_scan,
    decide_unmatched_pickup,
    evaluate_checkout,
    find_matching_scan,
    find_pickup_for_return,
    find_pickup_for_scan,
    score_pickup_evidence,
)

T0 = datetime(2026, 10, 10, 10, 0, 0, tzinfo=UTC)
P = Policy()
NAMES = {"cola": "Cola", "choc": "Chocolate", "mug": "Mug"}
WEIGHTS = {"cola": 540, "choc": 105, "mug": 330}


def pickup(pid="cola", conf=0.9, at=T0, **kw) -> PickupView:
    return PickupView(
        id=kw.pop("id", "VIS-1"),
        occurred_at=at,
        candidate_product_ids=(pid,) if pid else (),
        model_confidence=conf,
        **kw,
    )


def evidence(p: PickupView, sensors=(), gap=False):
    return score_pickup_evidence(p, sensors=list(sensors), product_weights=WEIGHTS, recent_coverage_gap=gap, policy=P)


# ---------------------------------------------------------------- scoring --


def test_model_and_reconciliation_confidence_are_separate():
    p = pickup(conf=0.60, track_frames=12)
    ev = evidence(p, [SensorView("s", T0 + timedelta(seconds=1), -530)])
    assert ev.model_confidence == 0.60
    assert ev.score == round(0.60 + P.track_bonus + P.sensor_agree_bonus, 3)
    assert evidence(pickup(conf=0.95, track_frames=12)).score == 1.0  # clamped
    labels = [f.label for f in ev.factors]
    assert "Stable track" in labels and "Shelf weight agrees" in labels


def test_sensor_contradiction_lowers_score_and_flags_verdict():
    ev = evidence(pickup(conf=0.8), [SensorView("s", T0, 3)])
    assert ev.sensor_verdict == "CONTRADICTS"
    assert ev.score < 0.8


def test_sensor_outside_window_is_ignored():
    ev = evidence(pickup(conf=0.8), [SensorView("s", T0 + timedelta(seconds=30), 3)])
    assert ev.sensor_verdict == "NONE"


def test_class_level_recognition_is_penalised():
    ev = evidence(pickup(conf=0.8, recognition_level="CLASS"))
    assert ev.score == round(0.8 - P.class_level_penalty, 3)


# --------------------------------------------------------------- matching --


def test_matching_picks_closest_unmatched_same_product_scan():
    scans = [
        ScanView("S1", "cola", T0 - timedelta(seconds=15)),
        ScanView("S2", "cola", T0 + timedelta(seconds=3)),
        ScanView("S3", "choc", T0),
    ]
    assert find_matching_scan(pickup(), scans, P).id == "S2"


def test_matched_scan_cannot_match_a_second_event():
    scans = [ScanView("S1", "cola", T0, matched=True)]
    assert find_matching_scan(pickup(), scans, P) is None


def test_scan_outside_window_does_not_match():
    scans = [ScanView("S1", "cola", T0 + timedelta(seconds=P.scan_grace_s + 5))]
    assert find_matching_scan(pickup(), scans, P) is None


def test_reverse_lookup_for_late_scan():
    pending = [pickup(id="V1", at=T0), pickup(id="V2", pid="choc", at=T0)]
    assert find_pickup_for_scan(ScanView("S", "choc", T0 + timedelta(seconds=4)), pending, P).id == "V2"


def test_return_prefers_same_track_and_most_recent():
    pickups = [
        pickup(id="V1", at=T0 - timedelta(seconds=60), track_id="a"),
        pickup(id="V2", at=T0 - timedelta(seconds=10), track_id="b"),
    ]
    ret = pickup(id="R", at=T0, track_id="a")
    assert find_pickup_for_return(ret, pickups, P).id == "V1"
    ret_no_track = pickup(id="R2", at=T0)
    assert find_pickup_for_return(ret_no_track, pickups, P).id == "V2"


def test_return_ignores_already_returned_pickups():
    pickups = [pickup(id="V1", at=T0 - timedelta(seconds=5), returned=True)]
    assert find_pickup_for_return(pickup(id="R", at=T0), pickups, P) is None


# ----------------------------------------------------------- repeat scans --


def test_repeat_scan_classification():
    assert classify_repeat_scan(T0, [], P) is None
    assert classify_repeat_scan(T0, [T0 - timedelta(milliseconds=400)], P) == "DEBOUNCE"
    assert classify_repeat_scan(T0, [T0 - timedelta(seconds=4)], P) == "SOFT_DUPLICATE"
    assert classify_repeat_scan(T0, [T0 - timedelta(seconds=30)], P) is None


# -------------------------------------------------------------- decisions --


def decide(p, sensors=(), scans=()):
    return decide_unmatched_pickup(
        p, evidence(p, sensors), other_unmatched_scans=list(scans), policy=P, product_names=NAMES
    )


def test_confident_unmatched_pickup_is_missed_scan_candidate():
    d = decide(pickup(conf=0.88, track_frames=10))
    assert d.outcome == ReconciliationOutcome.MISSED_SCAN_CANDIDATE
    assert d.kind == DiscrepancyKind.MISSED_SCAN
    assert d.state == DiscrepancyState.AWAITING_CUSTOMER
    assert "candidate" in d.explanation.lower()
    assert "theft" not in d.explanation.lower()


def test_wrong_product_needs_confidence_above_mismatch_threshold():
    scans = [ScanView("S1", "cola", T0)]
    strong = decide(pickup("choc", conf=0.86), scans=scans)
    assert strong.kind == DiscrepancyKind.WRONG_PRODUCT
    assert strong.conflicting_scan_id == "S1"
    weak = decide(pickup("choc", conf=0.60), scans=scans)
    assert weak.kind == DiscrepancyKind.MISSED_SCAN  # not confident enough to propose a swap


def test_low_confidence_is_uncertain_not_missed_scan():
    d = decide(pickup(conf=0.41, uncertainty_reason="occluded"))
    assert d.kind == DiscrepancyKind.UNCERTAIN_OBSERVATION
    assert "CONFIRM_NOTHING_EXTRA" in d.customer_options


def test_ambiguous_class_with_multiple_candidates_is_uncertain():
    p = PickupView(
        id="V", occurred_at=T0, candidate_product_ids=("cola", "mug"), model_confidence=0.9, recognition_level="CLASS"
    )
    assert decide(p).kind == DiscrepancyKind.UNCERTAIN_OBSERVATION


def test_contradicting_sensor_routes_to_staff():
    d = decide(pickup(conf=0.85, track_frames=10), sensors=[SensorView("s", T0, 1)])
    assert d.kind == DiscrepancyKind.CONFLICTING_EVIDENCE
    assert d.state == DiscrepancyState.AWAITING_STAFF


def test_noise_floor_logs_only():
    d = decide(pickup(conf=0.15))
    assert d.outcome == ReconciliationOutcome.LOW_SIGNAL_IGNORED
    assert d.kind is None


# --------------------------------------------------------------- checkout --


def test_checkout_blocked_by_open_discrepancy_and_empty_cart():
    r = evaluate_checkout(CheckoutInput("ACTIVE", False, [], [("DSC-1", "MISSED_SCAN", "AWAITING_CUSTOMER")]))
    codes = {b.code for b in r.blockers}
    assert not r.eligible
    assert codes == {"EMPTY_CART", "UNRESOLVED_DISCREPANCY"}


def test_checkout_eligible_when_clean():
    r = evaluate_checkout(CheckoutInput("ACTIVE", False, [("cola", 2, True)], []))
    assert r.eligible and not r.blockers


def test_checkout_rejects_already_checked_out_and_inactive_products():
    r = evaluate_checkout(CheckoutInput("CHECKOUT_AUTHORIZED", True, [("cola", 1, False)], []))
    codes = {b.code for b in r.blockers}
    assert {"ALREADY_CHECKED_OUT", "INACTIVE_PRODUCT"} <= codes
