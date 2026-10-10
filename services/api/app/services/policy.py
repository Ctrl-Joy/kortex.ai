"""Reconciliation policy: configurable thresholds and windows.

These defaults are tuned for the controlled hackathon demo. They are NOT
scientifically validated and must be calibrated with real store data before
any deployment.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, fields
from typing import Any


@dataclass(frozen=True)
class Policy:
    # --- scan handling ---------------------------------------------------
    scan_debounce_ms: int = 1500
    """Same barcode in the same session inside this window is treated as a
    repeated scanner callback and ignored (no quantity change)."""
    duplicate_scan_window_s: float = 8.0
    """Same barcode again after the debounce but inside this window is
    accepted, but flagged so the customer can confirm the quantity."""

    # --- temporal matching -----------------------------------------------
    scan_lead_s: float = 20.0
    """A scan up to this many seconds BEFORE a pickup may match it
    (customer scans the item while it is still on the shelf)."""
    scan_grace_s: float = 15.0
    """How long after a pickup KORTEX waits for a matching scan before it
    raises a candidate discrepancy."""
    return_window_s: float = 180.0
    """A return can cancel a pickup that happened up to this long before."""
    vision_dedupe_window_s: float = 4.0
    """Same track + same event type inside this window is a duplicate."""

    # --- confidence ------------------------------------------------------
    noise_floor: float = 0.20
    """Below this reconciliation confidence an unmatched pickup is logged only."""
    uncertain_threshold: float = 0.55
    """Below this, an unmatched pickup is an *uncertain observation*."""
    mismatch_threshold: float = 0.70
    """Minimum confidence to propose a wrong-product correction."""
    min_track_frames: int = 5
    track_bonus: float = 0.10
    class_level_penalty: float = 0.10
    sensor_agree_bonus: float = 0.15
    sensor_contradict_penalty: float = 0.30
    sensor_mismatch_penalty: float = 0.05
    coverage_gap_penalty: float = 0.10

    # --- weight sensor (supporting evidence only) ------------------------
    sensor_window_s: float = 5.0
    sensor_noise_grams: int = 15
    sensor_tolerance_ratio: float = 0.25

    # --- workflow --------------------------------------------------------
    allow_customer_attestation_for_uncertain: bool = True
    coverage_gap_requires_staff_check: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_overrides(cls, overrides: dict[str, Any] | None) -> Policy:
        if not overrides:
            return cls()
        allowed = {f.name: f.type for f in fields(cls)}
        clean = {k: v for k, v in overrides.items() if k in allowed}
        return cls(**clean)


# Human-readable descriptions surfaced on the Settings page.
POLICY_DESCRIPTIONS: dict[str, str] = {
    "scan_debounce_ms": "Repeated scanner callbacks for the same barcode inside this window are ignored.",
    "duplicate_scan_window_s": "A second scan of the same item inside this window asks the customer to confirm quantity.",
    "scan_lead_s": "A scan this many seconds before a pickup can still match it.",
    "scan_grace_s": "Time KORTEX waits after a pickup for a scan before raising a candidate discrepancy.",
    "return_window_s": "A return can cancel a pickup observed up to this many seconds earlier.",
    "vision_dedupe_window_s": "Same track and event type inside this window is treated as one event.",
    "noise_floor": "Unmatched pickups below this reconciliation confidence are logged only.",
    "uncertain_threshold": "Unmatched pickups below this confidence are treated as uncertain observations.",
    "mismatch_threshold": "Minimum confidence before KORTEX proposes a wrong-product correction.",
    "min_track_frames": "Tracks seen for at least this many frames add a stability bonus.",
    "sensor_window_s": "Weight readings within this many seconds of a pickup are considered.",
    "sensor_noise_grams": "Weight changes smaller than this are treated as 'no change'.",
    "sensor_tolerance_ratio": "Allowed deviation between measured and catalogue weight.",
    "allow_customer_attestation_for_uncertain": "Customers may self-confirm low-confidence observations.",
    "coverage_gap_requires_staff_check": "A camera outage during a session requires a quick staff check.",
}

POLICY_BOUNDS: dict[str, tuple[float, float]] = {
    "scan_debounce_ms": (200, 10_000),
    "duplicate_scan_window_s": (1, 120),
    "scan_lead_s": (0, 300),
    "scan_grace_s": (3, 600),
    "return_window_s": (10, 3600),
    "vision_dedupe_window_s": (0.5, 60),
    "noise_floor": (0, 1),
    "uncertain_threshold": (0, 1),
    "mismatch_threshold": (0, 1),
    "min_track_frames": (1, 300),
    "track_bonus": (0, 0.5),
    "class_level_penalty": (0, 0.5),
    "sensor_agree_bonus": (0, 0.5),
    "sensor_contradict_penalty": (0, 1),
    "sensor_mismatch_penalty": (0, 0.5),
    "coverage_gap_penalty": (0, 0.5),
    "sensor_window_s": (0.5, 60),
    "sensor_noise_grams": (1, 500),
    "sensor_tolerance_ratio": (0.01, 1),
}
