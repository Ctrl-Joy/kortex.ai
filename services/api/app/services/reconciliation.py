"""KORTEX reconciliation engine — pure decision logic.

This module has no database, HTTP or framework dependencies. It receives
immutable *views* of the evidence and returns *decisions*. The service layer
(`app.services.pipeline`) persists those decisions.

Principles encoded here:

* Model confidence (what the detector reported) is kept separate from
  reconciliation confidence (how strongly ALL the evidence supports a
  conclusion). Every adjustment is recorded as an explicit factor.
* A camera event without a matching scan is a *candidate* discrepancy, never
  proof of intent. A missing camera event never proves that no pickup occurred.
* One scan can match at most one physical event and vice versa.
* Weak evidence leads to verification (rescan / confirmation / staff review),
  never to a silent cart change or an accusation.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.models.enums import DiscrepancyKind, DiscrepancyState, ReconciliationOutcome
from app.services.policy import Policy

# --------------------------------------------------------------------------
# Views (inputs)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ScanView:
    id: str
    product_id: str
    occurred_at: datetime
    matched: bool = False


@dataclass(frozen=True)
class PickupView:
    id: str
    occurred_at: datetime
    candidate_product_ids: tuple[str, ...]
    model_confidence: float | None
    track_id: str | None = None
    track_frames: int | None = None
    recognition_level: str = "SKU"  # SKU | CLASS | UNKNOWN
    uncertainty_reason: str | None = None
    returned: bool = False
    contradictory: bool = False  # producer flagged conflicting observations

    @property
    def single_product_id(self) -> str | None:
        if len(self.candidate_product_ids) == 1:
            return self.candidate_product_ids[0]
        return None


@dataclass(frozen=True)
class SensorView:
    id: str
    occurred_at: datetime
    delta_grams: int


# --------------------------------------------------------------------------
# Decisions (outputs)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Factor:
    label: str
    delta: float
    detail: str

    def to_dict(self) -> dict:
        return {"label": self.label, "delta": round(self.delta, 3), "detail": self.detail}


@dataclass(frozen=True)
class Evidence:
    model_confidence: float
    score: float
    factors: tuple[Factor, ...]
    sensor_verdict: str  # NONE | AGREES | CONTRADICTS | MISMATCH

    def factor_dicts(self) -> list[dict]:
        return [f.to_dict() for f in self.factors]


@dataclass(frozen=True)
class PickupDecision:
    outcome: ReconciliationOutcome
    kind: DiscrepancyKind | None = None
    state: DiscrepancyState | None = None
    blocking: bool = False
    conflicting_scan_id: str | None = None
    explanation: str = ""
    recommended_action: str = ""
    customer_options: tuple[str, ...] = ()


@dataclass(frozen=True)
class CheckoutBlocker:
    code: str
    message: str
    action: str


@dataclass
class CheckoutInput:
    session_status: str
    already_checked_out: bool
    cart_lines: Sequence[tuple[str, int, bool]]  # (product_id, qty, product_active)
    blocking_discrepancies: Sequence[tuple[str, str, str]]  # (id, kind, state)
    pending_observations: int = 0


@dataclass
class CheckoutEligibility:
    eligible: bool
    blockers: list[CheckoutBlocker] = field(default_factory=list)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def describe_confidence(score: float | None) -> str:
    if score is None:
        return "No confidence available — evidence came from a non-model source."
    if score >= 0.80:
        return "High: several consistent signals support this observation."
    if score >= 0.55:
        return "Moderate: the observation is plausible but not conclusive."
    if score >= 0.20:
        return "Low: the evidence is weak; human verification is required."
    return "Very low: treated as noise and logged only."


def _within(t: datetime, start: datetime, end: datetime) -> bool:
    return start <= t <= end


# --------------------------------------------------------------------------
# Evidence scoring
# --------------------------------------------------------------------------


def score_pickup_evidence(
    pickup: PickupView,
    *,
    sensors: Iterable[SensorView],
    product_weights: dict[str, int | None],
    recent_coverage_gap: bool,
    policy: Policy,
) -> Evidence:
    """Combine model output and supporting evidence into a reconciliation score."""
    model_conf = clamp(pickup.model_confidence if pickup.model_confidence is not None else 0.5)
    factors: list[Factor] = [
        Factor("Model confidence", model_conf, f"Detector reported {model_conf:.2f} for this observation.")
    ]
    score = model_conf

    if pickup.track_frames is not None and pickup.track_frames >= policy.min_track_frames:
        score += policy.track_bonus
        factors.append(
            Factor(
                "Stable track",
                policy.track_bonus,
                f"Object tracked across {pickup.track_frames} frames (≥ {policy.min_track_frames}).",
            )
        )

    if pickup.recognition_level == "CLASS":
        score -= policy.class_level_penalty
        factors.append(
            Factor(
                "Class-level recognition",
                -policy.class_level_penalty,
                "Detector recognised a generic object class, not a specific SKU.",
            )
        )
    elif pickup.recognition_level == "UNKNOWN" or not pickup.candidate_product_ids:
        score -= policy.class_level_penalty
        factors.append(
            Factor("Unknown product", -policy.class_level_penalty, "No catalogue product could be associated.")
        )

    if pickup.contradictory:
        score -= policy.sensor_contradict_penalty
        factors.append(
            Factor(
                "Contradictory observations",
                -policy.sensor_contradict_penalty,
                pickup.uncertainty_reason or "The vision producer reported conflicting observations.",
            )
        )

    verdict = "NONE"
    window = timedelta(seconds=policy.sensor_window_s)
    nearby = [s for s in sensors if _within(s.occurred_at, pickup.occurred_at - window, pickup.occurred_at + window)]
    if nearby:
        reading = min(nearby, key=lambda s: abs((s.occurred_at - pickup.occurred_at).total_seconds()))
        removed = -reading.delta_grams  # a pickup should reduce shelf weight
        weights = [w for pid in pickup.candidate_product_ids if (w := product_weights.get(pid))]
        if abs(reading.delta_grams) < policy.sensor_noise_grams or removed < 0:
            verdict = "CONTRADICTS"
            score -= policy.sensor_contradict_penalty
            factors.append(
                Factor(
                    "Shelf weight contradicts",
                    -policy.sensor_contradict_penalty,
                    f"Shelf weight changed by {reading.delta_grams:+d} g; a removal was expected.",
                )
            )
        elif weights and any(abs(removed - w) <= w * policy.sensor_tolerance_ratio for w in weights):
            verdict = "AGREES"
            score += policy.sensor_agree_bonus
            factors.append(
                Factor(
                    "Shelf weight agrees",
                    policy.sensor_agree_bonus,
                    f"Removed {removed} g is consistent with the candidate product weight "
                    "(supporting evidence only — weight cannot identify a product).",
                )
            )
        elif weights:
            verdict = "MISMATCH"
            score -= policy.sensor_mismatch_penalty
            factors.append(
                Factor(
                    "Weight differs",
                    -policy.sensor_mismatch_penalty,
                    f"Removed {removed} g does not match the expected weight of the candidate product.",
                )
            )

    if recent_coverage_gap:
        score -= policy.coverage_gap_penalty
        factors.append(
            Factor("Camera recently reconnected", -policy.coverage_gap_penalty, "Tracking continuity was interrupted.")
        )

    return Evidence(
        model_confidence=model_conf, score=round(clamp(score), 3), factors=tuple(factors), sensor_verdict=verdict
    )


# --------------------------------------------------------------------------
# Matching
# --------------------------------------------------------------------------


def find_matching_scan(pickup: PickupView, scans: Iterable[ScanView], policy: Policy) -> ScanView | None:
    """Closest-in-time unmatched scan of a candidate product inside the window."""
    if not pickup.candidate_product_ids:
        return None
    start = pickup.occurred_at - timedelta(seconds=policy.scan_lead_s)
    end = pickup.occurred_at + timedelta(seconds=policy.scan_grace_s)
    candidates = [
        s
        for s in scans
        if not s.matched and s.product_id in pickup.candidate_product_ids and _within(s.occurred_at, start, end)
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda s: (abs((s.occurred_at - pickup.occurred_at).total_seconds()), s.id))


def find_pickup_for_scan(scan: ScanView, pickups: Iterable[PickupView], policy: Policy) -> PickupView | None:
    """Reverse lookup used when a scan arrives after pending pickups."""
    best: PickupView | None = None
    best_gap = float("inf")
    for p in pickups:
        if p.returned or scan.product_id not in p.candidate_product_ids:
            continue
        start = p.occurred_at - timedelta(seconds=policy.scan_lead_s)
        end = p.occurred_at + timedelta(seconds=policy.scan_grace_s)
        if not _within(scan.occurred_at, start, end):
            continue
        gap = abs((scan.occurred_at - p.occurred_at).total_seconds())
        if gap < best_gap:
            best, best_gap = p, gap
    return best


def find_pickup_for_return(ret: PickupView, pickups: Iterable[PickupView], policy: Policy) -> PickupView | None:
    """Most recent un-returned pickup of an overlapping product (same track preferred)."""
    start = ret.occurred_at - timedelta(seconds=policy.return_window_s)
    eligible = [
        p
        for p in pickups
        if not p.returned
        and _within(p.occurred_at, start, ret.occurred_at)
        and (
            (ret.track_id is not None and p.track_id == ret.track_id)
            or set(p.candidate_product_ids) & set(ret.candidate_product_ids)
        )
    ]
    if not eligible:
        return None
    same_track = [p for p in eligible if ret.track_id is not None and p.track_id == ret.track_id]
    pool = same_track or eligible
    return max(pool, key=lambda p: (p.occurred_at, p.id))


def classify_repeat_scan(now: datetime, previous_same_product: Sequence[datetime], policy: Policy) -> str | None:
    """Return "DEBOUNCE", "SOFT_DUPLICATE" or None for a new scan of a product."""
    if not previous_same_product:
        return None
    last = max(previous_same_product)
    gap = (now - last).total_seconds()
    if gap < 0:
        gap = 0
    if gap * 1000 < policy.scan_debounce_ms:
        return "DEBOUNCE"
    if gap < policy.duplicate_scan_window_s:
        return "SOFT_DUPLICATE"
    return None


# --------------------------------------------------------------------------
# Decisions for unmatched pickups
# --------------------------------------------------------------------------


def decide_unmatched_pickup(
    pickup: PickupView,
    evidence: Evidence,
    *,
    other_unmatched_scans: Sequence[ScanView],
    policy: Policy,
    product_names: dict[str, str],
) -> PickupDecision:
    """Decide what an unmatched pickup means once its grace window has expired."""
    score = evidence.score
    single = pickup.single_product_id
    observed_name = product_names.get(single, "an item") if single else "an item"

    if score < policy.noise_floor:
        return PickupDecision(
            outcome=ReconciliationOutcome.LOW_SIGNAL_IGNORED,
            explanation=(
                f"Reconciliation confidence {score:.2f} is below the noise floor "
                f"({policy.noise_floor:.2f}). Logged for audit; no action requested."
            ),
        )

    if evidence.sensor_verdict == "CONTRADICTS" or pickup.contradictory:
        return PickupDecision(
            outcome=ReconciliationOutcome.CONFLICTING,
            kind=DiscrepancyKind.CONFLICTING_EVIDENCE,
            state=DiscrepancyState.AWAITING_STAFF,
            blocking=True,
            explanation=(
                f"The camera reported a candidate pickup of {observed_name}, but other evidence "
                "contradicts it (e.g. shelf weight did not drop). The signals disagree, so no "
                "conclusion is drawn automatically."
            ),
            recommended_action="Staff: review the evidence and either dismiss as a false positive or confirm with the customer.",
            customer_options=("REQUEST_STAFF",),
        )

    if score < policy.uncertain_threshold or single is None:
        reason = pickup.uncertainty_reason or (
            "the product could not be narrowed to a single SKU" if single is None else "the signal is weak"
        )
        options = ["SCAN_NOW", "REQUEST_STAFF"]
        if policy.allow_customer_attestation_for_uncertain:
            options.insert(1, "CONFIRM_NOTHING_EXTRA")
        return PickupDecision(
            outcome=ReconciliationOutcome.UNCERTAIN,
            kind=DiscrepancyKind.UNCERTAIN_OBSERVATION,
            state=DiscrepancyState.AWAITING_CUSTOMER,
            blocking=True,
            explanation=(
                f"Uncertain visual observation (reconciliation confidence {score:.2f}): {reason}. "
                "This is not treated as a missed scan; it only asks for a quick check."
            ),
            recommended_action="Ask the customer to scan any unscanned item or confirm their basket; staff review if unclear.",
            customer_options=tuple(options),
        )

    # Confident single-SKU pickup with no matching scan.
    window_scans = [s for s in other_unmatched_scans if s.product_id != single]
    if window_scans and score >= policy.mismatch_threshold:
        scan = min(window_scans, key=lambda s: abs((s.occurred_at - pickup.occurred_at).total_seconds()))
        scanned_name = product_names.get(scan.product_id, "another item")
        return PickupDecision(
            outcome=ReconciliationOutcome.WRONG_PRODUCT_CANDIDATE,
            kind=DiscrepancyKind.WRONG_PRODUCT,
            state=DiscrepancyState.AWAITING_CUSTOMER,
            blocking=True,
            conflicting_scan_id=scan.id,
            explanation=(
                f"Scanned {scanned_name}, but the camera observed a candidate pickup of {observed_name} "
                f"at the same time (reconciliation confidence {score:.2f}). The cart is NOT changed "
                "until the customer or staff confirms."
            ),
            recommended_action="Ask the customer which item they have; apply the correction only after confirmation.",
            customer_options=("REPLACE_ITEM", "KEEP_SCANNED", "REQUEST_STAFF"),
        )

    return PickupDecision(
        outcome=ReconciliationOutcome.MISSED_SCAN_CANDIDATE,
        kind=DiscrepancyKind.MISSED_SCAN,
        state=DiscrepancyState.AWAITING_CUSTOMER,
        blocking=True,
        explanation=(
            f"Candidate pickup of {observed_name} with no matching scan within "
            f"{policy.scan_grace_s:.0f}s (reconciliation confidence {score:.2f}). This may be a "
            "forgotten scan or an item that was put back out of camera view."
        ),
        recommended_action="Invite the customer to add the item or confirm it was put back; staff verify if disputed.",
        customer_options=("ADD_TO_CART", "PUT_BACK", "REQUEST_STAFF"),
    )


# --------------------------------------------------------------------------
# Checkout eligibility
# --------------------------------------------------------------------------

_KIND_LABEL = {
    DiscrepancyKind.MISSED_SCAN: "possible missed scan",
    DiscrepancyKind.WRONG_PRODUCT: "possible wrong-product scan",
    DiscrepancyKind.DUPLICATE_SCAN: "duplicate scan to confirm",
    DiscrepancyKind.UNCERTAIN_OBSERVATION: "uncertain observation to verify",
    DiscrepancyKind.PICKUP_RETURN: "returned item still in cart",
    DiscrepancyKind.CONFLICTING_EVIDENCE: "conflicting or incomplete evidence",
}


def evaluate_checkout(inp: CheckoutInput) -> CheckoutEligibility:
    blockers: list[CheckoutBlocker] = []

    if inp.already_checked_out:
        blockers.append(
            CheckoutBlocker(
                "ALREADY_CHECKED_OUT", "This session has already been checked out.", "Show the existing receipt."
            )
        )
    elif inp.session_status != "ACTIVE":
        blockers.append(
            CheckoutBlocker(
                "SESSION_NOT_ACTIVE", f"Session is {inp.session_status.lower()}.", "Start a new shopping session."
            )
        )

    live_lines = [line for line in inp.cart_lines if line[1] > 0]
    if not live_lines:
        blockers.append(CheckoutBlocker("EMPTY_CART", "The cart is empty.", "Scan at least one product."))
    for product_id, _qty, active in live_lines:
        if not active:
            blockers.append(
                CheckoutBlocker(
                    "INACTIVE_PRODUCT",
                    f"Product {product_id} is no longer sold.",
                    "Remove it from the cart or ask staff for help.",
                )
            )

    if inp.pending_observations:
        blockers.append(
            CheckoutBlocker(
                "VERIFICATION_PENDING",
                f"{inp.pending_observations} shelf observation(s) are still being verified.",
                "Wait a moment and try again.",
            )
        )

    for disc_id, kind, state in inp.blocking_discrepancies:
        label = _KIND_LABEL.get(DiscrepancyKind(kind), kind.lower())
        if state == DiscrepancyState.AWAITING_CUSTOMER:
            action = "Review the alert in your cart and choose an option."
        elif state == DiscrepancyState.ESCALATED:
            action = "A supervisor is reviewing this; please wait or visit the help desk."
        else:
            action = "A staff member will assist shortly."
        blockers.append(CheckoutBlocker("UNRESOLVED_DISCREPANCY", f"Unresolved {label} ({disc_id}).", action))

    return CheckoutEligibility(eligible=not blockers, blockers=blockers)
