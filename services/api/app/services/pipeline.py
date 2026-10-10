"""Event pipeline: applies reconciliation-engine decisions to persisted state.

Barcode scans, camera observations (real or simulated) and sensor readings all
enter through this module, so every source follows exactly the same rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError, ValidationFailed
from app.core.time import ensure_utc, utcnow
from app.models import (
    Discrepancy,
    Product,
    ReconciliationResult,
    ScanEvent,
    SensorEvent,
    ShoppingSession,
    VisionEvent,
    ZoneBinding,
)
from app.models.enums import (
    OPEN_DISCREPANCY_STATES,
    DiscrepancyKind,
    DiscrepancyState,
    EventSource,
    ReconciliationOutcome,
    ScanStatus,
    SessionStatus,
    VisionEventState,
    VisionEventType,
)
from app.services import audit, barcode, cart, discrepancies
from app.services.audit import Actor
from app.services.policy import Policy
from app.services.policy_access import current_policy
from app.services.reconciliation import (
    Evidence,
    PickupView,
    ScanView,
    SensorView,
    classify_repeat_scan,
    decide_unmatched_pickup,
    find_matching_scan,
    find_pickup_for_return,
    find_pickup_for_scan,
    score_pickup_evidence,
)
from app.websocket.hub import enqueue

SCAN_LIKE_METHODS = {"CAMERA_BARCODE", "MANUAL_ENTRY", "CATALOGUE_SELECT"}
ACTIVE_PICKUP_STATES = (
    VisionEventState.OBSERVED,
    VisionEventState.MATCHED,
    VisionEventState.CANDIDATE_DISCREPANCY,
    VisionEventState.RESOLVED,
)


# --------------------------------------------------------------------------
# View builders
# --------------------------------------------------------------------------


def _scan_view(s: ScanEvent) -> ScanView:
    return ScanView(
        id=s.id, product_id=s.product_id or "", occurred_at=s.occurred_at, matched=s.matched_vision_event_id is not None
    )


def _pickup_view(v: VisionEvent) -> PickupView:
    return PickupView(
        id=v.id,
        occurred_at=v.occurred_at,
        candidate_product_ids=tuple(v.candidate_product_ids or ()),
        model_confidence=v.model_confidence,
        track_id=v.track_id,
        track_frames=v.track_frames,
        recognition_level=v.recognition_level,
        uncertainty_reason=v.uncertainty_reason,
        returned=v.state == VisionEventState.RETURNED,
        contradictory=bool((v.payload or {}).get("contradictory")),
    )


def _accepted_scans(db: Session, session_id: str) -> list[ScanEvent]:
    return list(
        db.scalars(
            select(ScanEvent)
            .where(ScanEvent.session_id == session_id, ScanEvent.status == ScanStatus.ACCEPTED)
            .order_by(ScanEvent.occurred_at)
        )
    )


def _product_names(db: Session) -> dict[str, str]:
    return {p.id: p.name for p in db.scalars(select(Product))}


def _record_result(
    db: Session,
    *,
    session_id: str | None,
    outcome: ReconciliationOutcome,
    explanation: str,
    policy: Policy,
    vision_event: VisionEvent | None = None,
    scan: ScanEvent | None = None,
    evidence: Evidence | None = None,
) -> ReconciliationResult:
    rr = ReconciliationResult(
        session_id=session_id,
        vision_event_id=vision_event.id if vision_event else None,
        scan_event_id=scan.id if scan else None,
        outcome=outcome,
        model_confidence=evidence.model_confidence
        if evidence
        else (vision_event.model_confidence if vision_event else None),
        reconciliation_confidence=evidence.score if evidence else None,
        factors=evidence.factor_dicts() if evidence else [],
        explanation=explanation,
        policy_snapshot=policy.to_dict(),
    )
    db.add(rr)
    db.flush()
    if vision_event is not None and evidence is not None:
        vision_event.reconciliation_confidence = evidence.score
    is_sim = bool(vision_event.is_simulated) if vision_event else bool(scan.is_simulated) if scan else False
    audit.record(
        db,
        actor=audit.SYSTEM,
        event_type="RECONCILIATION_DECISION",
        summary=f"{outcome.replace('_', ' ').title()}: {explanation}",
        session_id=session_id,
        entity_type="reconciliation_result",
        entity_id=rr.id,
        source=vision_event.source if vision_event else (scan.source if scan else None),
        is_simulated=is_sim,
        details={
            "outcome": outcome,
            "vision_event_id": rr.vision_event_id,
            "scan_event_id": rr.scan_event_id,
            "reconciliation_confidence": rr.reconciliation_confidence,
            "factors": rr.factors,
        },
    )
    enqueue(db, "reconciliation.created", session_id=session_id, data={"id": rr.id, "outcome": outcome})
    return rr


def _evidence_for(db: Session, ve: VisionEvent, policy: Policy) -> Evidence:
    window = timedelta(seconds=policy.sensor_window_s)
    sensors = db.scalars(
        select(SensorEvent).where(
            SensorEvent.zone_id == ve.zone_id,
            # Readings attributed to another shopping session are never evidence for this one.
            or_(SensorEvent.session_id == ve.session_id, SensorEvent.session_id.is_(None)),
            SensorEvent.occurred_at >= ve.occurred_at - window,
            SensorEvent.occurred_at <= ve.occurred_at + window,
        )
    ).all()
    weights = {
        p.id: p.weight_grams for p in db.scalars(select(Product).where(Product.id.in_(ve.candidate_product_ids or [])))
    }
    recent_gap = False
    if ve.session_id:
        recent_gap = (
            db.scalar(
                select(VisionEvent.id).where(
                    VisionEvent.session_id == ve.session_id,
                    VisionEvent.event_type == VisionEventType.CAMERA_ONLINE,
                    VisionEvent.occurred_at <= ve.occurred_at,
                    VisionEvent.occurred_at >= ve.occurred_at - timedelta(seconds=30),
                )
            )
            is not None
        )
    return score_pickup_evidence(
        _pickup_view(ve),
        sensors=[SensorView(s.id, s.occurred_at, s.delta_grams) for s in sensors],
        product_weights=weights,
        recent_coverage_gap=recent_gap,
        policy=policy,
    )


def _link(scan: ScanEvent, ve: VisionEvent, state: VisionEventState = VisionEventState.MATCHED) -> None:
    scan.matched_vision_event_id = ve.id
    ve.matched_scan_id = scan.id
    ve.state = state
    ve.decided_at = utcnow()
    ve.finalize_after = None


def _resolve_duplicate_flag_for_scan(db: Session, scan: ScanEvent) -> None:
    d = db.scalar(
        select(Discrepancy).where(
            Discrepancy.scan_event_id == scan.id,
            Discrepancy.kind == DiscrepancyKind.DUPLICATE_SCAN,
            Discrepancy.state.in_(OPEN_DISCREPANCY_STATES),
        )
    )
    if d is not None:
        discrepancies.auto_resolve(
            db, d, "A separate physical pickup was observed for the second unit.", "SECOND_UNIT_OBSERVED"
        )


# --------------------------------------------------------------------------
# Barcode scans
# --------------------------------------------------------------------------


@dataclass
class ScanOutcome:
    status: str  # ACCEPTED | DUPLICATE_IGNORED | IDEMPOTENT_REPLAY | REJECTED_*
    scan: ScanEvent | None
    message: str
    product: Product | None = None
    discrepancy: Discrepancy | None = None

    @property
    def accepted(self) -> bool:
        return self.status in ("ACCEPTED", "DUPLICATE_IGNORED", "IDEMPOTENT_REPLAY")


def _lookup_product(db: Session, code: str) -> Product | None:
    variants = {code}
    if len(code) == 12:
        variants.add("0" + code)  # UPC-A read of an EAN-13 starting with 0
    if len(code) == 13 and code.startswith("0"):
        variants.add(code[1:])
    if len(code) == 8 and (upca := barcode.upce_to_upca(code)):
        variants.update({upca, "0" + upca})
    return db.scalar(select(Product).where(Product.barcode.in_(variants)))


def process_scan(
    db: Session,
    session: ShoppingSession,
    *,
    code: str,
    method: str,
    actor: Actor,
    source: str = EventSource.CUSTOMER_APP,
    is_simulated: bool = False,
    client_scan_id: str | None = None,
    occurred_at: datetime | None = None,
) -> ScanOutcome:
    cart.ensure_active(session)
    policy = current_policy(db)
    now = utcnow()
    occurred = ensure_utc(occurred_at) if occurred_at else now

    if client_scan_id:
        existing = db.scalar(
            select(ScanEvent).where(ScanEvent.session_id == session.id, ScanEvent.client_scan_id == client_scan_id)
        )
        if existing is not None:
            return ScanOutcome("IDEMPOTENT_REPLAY", existing, "This scan was already processed.", existing.product)

    code = barcode.normalise(code)

    def reject(status: ScanStatus, message: str, product: Product | None = None) -> ScanOutcome:
        scan = ScanEvent(
            session_id=session.id,
            product_id=product.id if product else None,
            barcode=code[:32],
            method=method,
            source=source,
            is_simulated=is_simulated,
            status=status,
            client_scan_id=client_scan_id,
            occurred_at=occurred,
        )
        db.add(scan)
        db.flush()
        audit.record(
            db,
            actor=actor,
            event_type="BARCODE_SCAN_REJECTED",
            summary=f"Scan of {code[:32]!r} rejected: {message}",
            session_id=session.id,
            entity_type="scan",
            entity_id=scan.id,
            source=source,
            is_simulated=is_simulated,
            details={"status": status, "method": method},
        )
        return ScanOutcome(status, scan, message, product)

    if not barcode.is_valid(code):
        return reject(ScanStatus.REJECTED_INVALID, "Not a valid EAN-13, EAN-8, UPC-A or UPC-E barcode.")
    product = _lookup_product(db, code)
    if product is None:
        return reject(ScanStatus.REJECTED_UNKNOWN, "This barcode is not in the store catalogue.")
    if not product.active:
        return reject(ScanStatus.REJECTED_INACTIVE, f"{product.name} is not currently sold.", product)

    repeat = None
    if method in SCAN_LIKE_METHODS:
        previous = db.scalars(
            select(ScanEvent.occurred_at).where(
                ScanEvent.session_id == session.id,
                ScanEvent.product_id == product.id,
                ScanEvent.method.in_(SCAN_LIKE_METHODS),
                ScanEvent.status.in_([ScanStatus.ACCEPTED, ScanStatus.DUPLICATE_IGNORED]),
            )
        ).all()
        repeat = classify_repeat_scan(occurred, list(previous), policy)

    if repeat == "DEBOUNCE":
        scan = ScanEvent(
            session_id=session.id,
            product_id=product.id,
            barcode=code,
            method=method,
            source=source,
            is_simulated=is_simulated,
            status=ScanStatus.DUPLICATE_IGNORED,
            client_scan_id=client_scan_id,
            occurred_at=occurred,
        )
        db.add(scan)
        db.flush()
        audit.record(
            db,
            actor=actor,
            event_type="BARCODE_SCAN_DEBOUNCED",
            summary=f"Repeated read of {product.name} within {policy.scan_debounce_ms} ms ignored (no quantity change).",
            session_id=session.id,
            entity_type="scan",
            entity_id=scan.id,
            source=source,
            is_simulated=is_simulated,
        )
        return ScanOutcome("DUPLICATE_IGNORED", scan, f"{product.name} is already in your cart.", product)

    scan = cart.add_unit(
        db,
        session,
        product,
        method=method,
        source=source,
        is_simulated=is_simulated,
        occurred_at=occurred,
        client_scan_id=client_scan_id,
        barcode=code,
    )
    audit.record(
        db,
        actor=actor,
        event_type="BARCODE_SCAN",
        summary=f"{product.name} scanned ({method.replace('_', ' ').lower()}).",
        session_id=session.id,
        entity_type="scan",
        entity_id=scan.id,
        source=source,
        is_simulated=is_simulated,
        details={"barcode": code, "symbology": barcode.classify(code), "price_paise": product.price_paise},
    )
    enqueue(db, "scan.created", session_id=session.id, data={"id": scan.id, "product_id": product.id})

    flagged: Discrepancy | None = None
    if repeat == "SOFT_DUPLICATE":
        flagged, _ = discrepancies.create(
            db,
            session=session,
            kind=DiscrepancyKind.DUPLICATE_SCAN,
            state=DiscrepancyState.AWAITING_CUSTOMER,
            dedupe_key=f"DUP:{scan.id}",
            blocking=True,
            explanation=(
                f"{product.name} was scanned again within {policy.duplicate_scan_window_s:.0f}s. The second unit was "
                "added, but the customer is asked to confirm the quantity to avoid an accidental double charge."
            ),
            recommended_action="Customer confirms quantity; resolves automatically if a second pickup is observed.",
            source=source,
            is_simulated=is_simulated,
            scan_event_id=scan.id,
            scanned_product_id=product.id,
            scanned_name=product.name,
        )

    link_scan(db, session, scan, policy)
    cart.notify_cart(db, session.id)
    return ScanOutcome("ACCEPTED", scan, f"Added {product.name}.", product, flagged)


def link_scan(db: Session, session: ShoppingSession, scan: ScanEvent, policy: Policy) -> None:
    """Try to verify a newly added unit against pending or flagged pickups."""
    pending = list(
        db.scalars(
            select(VisionEvent).where(
                VisionEvent.session_id == session.id,
                VisionEvent.event_type == VisionEventType.PICKUP,
                VisionEvent.state == VisionEventState.OBSERVED,
            )
        )
    )
    match = find_pickup_for_scan(_scan_view(scan), [_pickup_view(v) for v in pending], policy)
    if match is not None:
        ve = next(v for v in pending if v.id == match.id)
        _link(scan, ve)
        _record_result(
            db,
            session_id=session.id,
            outcome=ReconciliationOutcome.MATCHED,
            explanation=f"Scan {scan.id} matched pending pickup {ve.id}.",
            policy=policy,
            vision_event=ve,
            scan=scan,
            evidence=_evidence_for(db, ve, policy),
        )
        return

    # A late scan can resolve an open missed-scan / uncertain / wrong-product prompt.
    open_flags = list(
        db.scalars(
            select(Discrepancy)
            .where(
                Discrepancy.session_id == session.id,
                Discrepancy.state.in_(OPEN_DISCREPANCY_STATES),
                Discrepancy.kind.in_(
                    [
                        DiscrepancyKind.MISSED_SCAN,
                        DiscrepancyKind.UNCERTAIN_OBSERVATION,
                        DiscrepancyKind.WRONG_PRODUCT,
                    ]
                ),
                Discrepancy.vision_event_id.is_not(None),
            )
            .order_by(Discrepancy.created_at)
        )
    )
    for d in open_flags:
        ve = db.get(VisionEvent, d.vision_event_id)
        if ve is None or ve.matched_scan_id or scan.product_id not in (ve.candidate_product_ids or []):
            continue
        _link(scan, ve, VisionEventState.RESOLVED)
        _record_result(
            db,
            session_id=session.id,
            outcome=ReconciliationOutcome.LATE_SCAN_MATCHED,
            explanation=f"Scan {scan.id} arrived after the prompt and matches observation {ve.id}.",
            policy=policy,
            vision_event=ve,
            scan=scan,
        )
        discrepancies.auto_resolve(db, d, "Customer scanned the observed item after the prompt.", "LATE_SCAN_MATCHED")
        return


# --------------------------------------------------------------------------
# Vision events
# --------------------------------------------------------------------------


@dataclass
class VisionInput:
    external_event_id: str
    zone_id: str
    event_type: VisionEventType
    occurred_at: datetime
    source: EventSource
    is_simulated: bool
    session_id: str | None = None
    track_id: str | None = None
    class_label: str | None = None
    product_id: str | None = None
    product_sku: str | None = None
    model_confidence: float | None = None
    track_frames: int | None = None
    zone_status: str | None = None
    uncertainty_reason: str | None = None
    contradictory: bool = False
    extra: dict[str, Any] | None = None


@dataclass
class VisionOutcome:
    event: VisionEvent
    replay: bool = False
    discrepancy: Discrepancy | None = None


def _resolve_session(db: Session, inp: VisionInput) -> tuple[ShoppingSession | None, str | None]:
    if inp.session_id:
        s = db.get(ShoppingSession, inp.session_id)
        if s is None:
            raise NotFoundError(f"Session {inp.session_id} not found")
        if s.status != SessionStatus.ACTIVE:
            return None, f"session {s.id} is {s.status.lower()}"
        return s, None
    binding = db.get(ZoneBinding, inp.zone_id)
    if binding is None or binding.session_id is None:
        return None, f"no active shopping session is bound to zone {inp.zone_id}"
    s = db.get(ShoppingSession, binding.session_id)
    if s is None or s.status != SessionStatus.ACTIVE:
        return None, f"the session bound to zone {inp.zone_id} is not active"
    return s, None


def _resolve_candidates(db: Session, inp: VisionInput) -> tuple[list[str], str | None, str]:
    """Return (candidate product ids, single product id, recognition level)."""
    if inp.product_id or inp.product_sku:
        p = (
            db.get(Product, inp.product_id)
            if inp.product_id
            else db.scalar(select(Product).where(Product.sku == inp.product_sku))
        )
        if p is None:
            raise ValidationFailed("Unknown product for vision event", code="unknown_product")
        return [p.id], p.id, "SKU"
    if inp.class_label:
        ids = list(
            db.scalars(select(Product.id).where(Product.model_class == inp.class_label, Product.active.is_(True)))
        )
        if ids:
            return ids, ids[0] if len(ids) == 1 else None, "CLASS"
    return [], None, "UNKNOWN"


def ingest_vision_event(db: Session, inp: VisionInput, *, actor: Actor) -> VisionOutcome:
    existing = db.scalar(select(VisionEvent).where(VisionEvent.external_event_id == inp.external_event_id))
    if existing is not None:
        return VisionOutcome(existing, replay=True)

    policy = current_policy(db)
    session, unassigned_reason = _resolve_session(db, inp)
    candidates, single, level = _resolve_candidates(db, inp)
    occurred = ensure_utc(inp.occurred_at)
    payload = dict(inp.extra or {})
    payload["contradictory"] = inp.contradictory

    ve = VisionEvent(
        external_event_id=inp.external_event_id,
        session_id=session.id if session else None,
        zone_id=inp.zone_id,
        event_type=inp.event_type,
        source=inp.source,
        is_simulated=inp.is_simulated,
        track_id=inp.track_id,
        class_label=inp.class_label,
        candidate_product_ids=candidates,
        product_id=single,
        model_confidence=inp.model_confidence,
        track_frames=inp.track_frames,
        zone_status=inp.zone_status,
        uncertainty_reason=inp.uncertainty_reason,
        recognition_level=level,
        state=VisionEventState.OBSERVED,
        occurred_at=occurred,
        payload=payload,
    )
    db.add(ve)
    db.flush()

    label = single and db.get(Product, single)
    what = label.name if label else (inp.class_label or "unidentified object")
    audit.record(
        db,
        actor=actor,
        event_type="CAMERA_EVENT",
        summary=(
            f"{'[SIMULATED] ' if inp.is_simulated else ''}Candidate {inp.event_type.lower().replace('_', ' ')}"
            f" — {what} in {inp.zone_id}"
            + (f" (model confidence {inp.model_confidence:.2f})" if inp.model_confidence is not None else "")
        ),
        session_id=ve.session_id,
        entity_type="vision_event",
        entity_id=ve.id,
        source=inp.source,
        is_simulated=inp.is_simulated,
        details={
            "event_type": inp.event_type,
            "track_id": inp.track_id,
            "class_label": inp.class_label,
            "candidates": candidates,
            "recognition_level": level,
            "model_confidence": inp.model_confidence,
            "uncertainty_reason": inp.uncertainty_reason,
        },
    )
    enqueue(db, "vision.created", session_id=ve.session_id, data={"id": ve.id, "event_type": ve.event_type})

    if session is None:
        ve.state = VisionEventState.UNASSIGNED
        _record_result(
            db,
            session_id=None,
            outcome=ReconciliationOutcome.UNASSIGNED,
            explanation=f"Observation not attributed to any shopper: {unassigned_reason}.",
            policy=policy,
            vision_event=ve,
        )
        return VisionOutcome(ve)

    session.last_activity_at = utcnow()

    if inp.event_type in (VisionEventType.CAMERA_OFFLINE, VisionEventType.CAMERA_ONLINE):
        return VisionOutcome(ve, discrepancy=_handle_camera_status(db, session, ve, policy))
    if inp.event_type == VisionEventType.OBSERVATION:
        ve.state = VisionEventState.INFO
        return VisionOutcome(ve)

    # Duplicate suppression: same track (or same candidates without a track)
    # and same event type inside the dedupe window.
    window = timedelta(seconds=policy.vision_dedupe_window_s)
    dup_query = select(VisionEvent).where(
        VisionEvent.session_id == session.id,
        VisionEvent.id != ve.id,
        VisionEvent.event_type == ve.event_type,
        VisionEvent.state != VisionEventState.DUPLICATE,
        VisionEvent.occurred_at >= occurred - window,
        VisionEvent.occurred_at <= occurred + window,
    )
    if ve.track_id:
        dup_query = dup_query.where(VisionEvent.track_id == ve.track_id)
    else:
        dup_query = dup_query.where(VisionEvent.track_id.is_(None))
    duplicate_of = next(
        (d for d in db.scalars(dup_query) if ve.track_id or (d.candidate_product_ids or []) == candidates), None
    )
    if duplicate_of is not None:
        ve.state = VisionEventState.DUPLICATE
        ve.related_event_id = duplicate_of.id
        ve.decided_at = utcnow()
        _record_result(
            db,
            session_id=session.id,
            outcome=ReconciliationOutcome.DUPLICATE_EVENT,
            explanation=f"Duplicate of {duplicate_of.id} (same track and event type within {policy.vision_dedupe_window_s:.0f}s); no new alert.",
            policy=policy,
            vision_event=ve,
        )
        return VisionOutcome(ve)

    if inp.event_type == VisionEventType.RETURN:
        return VisionOutcome(ve, discrepancy=_handle_return(db, session, ve, policy))

    # PICKUP
    ve.finalize_after = occurred + timedelta(seconds=policy.scan_grace_s)
    scans = _accepted_scans(db, session.id)
    match = find_matching_scan(_pickup_view(ve), [_scan_view(s) for s in scans], policy)
    if match is not None:
        scan = next(s for s in scans if s.id == match.id)
        _link(scan, ve)
        _record_result(
            db,
            session_id=session.id,
            outcome=ReconciliationOutcome.MATCHED,
            explanation=f"Candidate pickup matched scan {scan.id} of the same product.",
            policy=policy,
            vision_event=ve,
            scan=scan,
            evidence=_evidence_for(db, ve, policy),
        )
        _resolve_duplicate_flag_for_scan(db, scan)
    return VisionOutcome(ve)


def _handle_camera_status(db: Session, session: ShoppingSession, ve: VisionEvent, policy: Policy) -> Discrepancy | None:
    ve.state = VisionEventState.INFO
    ve.decided_at = utcnow()
    if ve.event_type == VisionEventType.CAMERA_ONLINE:
        session.camera_gap_open = False
        _record_result(
            db,
            session_id=session.id,
            outcome=ReconciliationOutcome.COVERAGE_GAP,
            explanation="Camera reconnected; visual verification resumed.",
            policy=policy,
            vision_event=ve,
        )
        enqueue(db, "session.updated", session_id=session.id, data={"camera_gap_open": False})
        return None

    already_open = session.camera_gap_open
    session.camera_gap_open = True
    enqueue(db, "session.updated", session_id=session.id, data={"camera_gap_open": True})
    rr = _record_result(
        db,
        session_id=session.id,
        outcome=ReconciliationOutcome.COVERAGE_GAP,
        explanation=(
            "Camera disconnected during the session. Missing camera events from this period do NOT prove "
            "that no pickup occurred; scans in this period cannot be visually verified."
        ),
        policy=policy,
        vision_event=ve,
    )
    if already_open or not policy.coverage_gap_requires_staff_check:
        return None
    d, _ = discrepancies.create(
        db,
        session=session,
        kind=DiscrepancyKind.CONFLICTING_EVIDENCE,
        state=DiscrepancyState.AWAITING_STAFF,
        dedupe_key=f"GAP:{ve.id}",
        blocking=True,
        explanation=(
            "Incomplete evidence: camera coverage was interrupted during this session, so items handled during "
            "the outage could not be verified. This is not an indication of wrongdoing."
        ),
        recommended_action="Staff: perform a quick basket check at exit, then resolve with a note.",
        source=ve.source,
        is_simulated=ve.is_simulated,
        vision_event_id=ve.id,
        reconciliation_result_id=rr.id,
        customer_message=(
            "Our shelf camera was briefly unavailable during your visit, so some items couldn't be verified "
            "automatically. A team member will do a quick, routine check before you leave."
        ),
    )
    return d


def _handle_return(db: Session, session: ShoppingSession, ve: VisionEvent, policy: Policy) -> Discrepancy | None:
    pickups = list(
        db.scalars(
            select(VisionEvent).where(
                VisionEvent.session_id == session.id,
                VisionEvent.event_type == VisionEventType.PICKUP,
                VisionEvent.state.in_(ACTIVE_PICKUP_STATES),
                VisionEvent.occurred_at <= ve.occurred_at,
            )
        )
    )
    target_view = find_pickup_for_return(_pickup_view(ve), [_pickup_view(p) for p in pickups], policy)
    if target_view is None:
        ve.state = VisionEventState.INFO
        ve.decided_at = utcnow()
        _record_result(
            db,
            session_id=session.id,
            outcome=ReconciliationOutcome.RETURN_UNMATCHED,
            explanation="Candidate return with no earlier pickup in this session; logged only.",
            policy=policy,
            vision_event=ve,
        )
        return None

    pickup = next(p for p in pickups if p.id == target_view.id)
    prior_state = pickup.state
    pickup.state = VisionEventState.RETURNED
    pickup.related_event_id = ve.id
    pickup.finalize_after = None
    pickup.decided_at = utcnow()
    ve.state = VisionEventState.RETURN_MATCHED
    ve.related_event_id = pickup.id
    ve.decided_at = utcnow()
    product = db.get(Product, pickup.product_id) if pickup.product_id else None
    name = product.name if product else "the item"
    rr = _record_result(
        db,
        session_id=session.id,
        outcome=ReconciliationOutcome.RETURN_MATCHED,
        explanation=f"Return of {name} matched earlier pickup {pickup.id}; no removal is outstanding for it.",
        policy=policy,
        vision_event=ve,
    )

    # Any open alert raised for the pickup is resolved by the return evidence.
    for d in db.scalars(
        select(Discrepancy).where(
            Discrepancy.vision_event_id == pickup.id, Discrepancy.state.in_(OPEN_DISCREPANCY_STATES)
        )
    ):
        discrepancies.auto_resolve(db, d, f"Return to shelf observed ({ve.id}).", "RETURN_OBSERVED")

    scanned_unit = None
    if pickup.matched_scan_id:
        s = db.get(ScanEvent, pickup.matched_scan_id)
        if s is not None and s.status == ScanStatus.ACCEPTED:
            scanned_unit = s

    if scanned_unit is not None:
        # Customer-protective advisory: scanned item went back on the shelf.
        d, _ = discrepancies.create(
            db,
            session=session,
            kind=DiscrepancyKind.PICKUP_RETURN,
            state=DiscrepancyState.AWAITING_CUSTOMER,
            dedupe_key=f"RET:{pickup.id}",
            blocking=False,
            explanation=(
                f"{name} was scanned and later observed being returned to the shelf. The unit is still in the "
                "cart; the customer is asked whether to remove it (advisory, does not block checkout)."
            ),
            recommended_action="Customer chooses whether to remove the returned unit.",
            source=ve.source,
            is_simulated=ve.is_simulated,
            vision_event_id=pickup.id,
            scan_event_id=scanned_unit.id,
            observed_product_id=pickup.product_id,
            observed_name=name,
            reconciliation_result_id=rr.id,
            model_confidence=ve.model_confidence,
        )
        return d

    d, _ = discrepancies.create(
        db,
        session=session,
        kind=DiscrepancyKind.PICKUP_RETURN,
        state=DiscrepancyState.RESOLVED,
        dedupe_key=f"RET:{pickup.id}",
        blocking=False,
        explanation=(
            f"Candidate pickup of {name} followed by a return ({ve.id}). Previous state: {prior_state.lower()}. "
            "No unresolved removal remains, so no alert is shown to the customer."
        ),
        recommended_action="None — informational record.",
        source=ve.source,
        is_simulated=ve.is_simulated,
        vision_event_id=pickup.id,
        observed_product_id=pickup.product_id,
        observed_name=name,
        reconciliation_result_id=rr.id,
        model_confidence=ve.model_confidence,
        customer_options=(),
    )
    d.resolution_code = "RETURN_OBSERVED"
    d.resolution_reason = "Automatically closed: return observed."
    d.resolved_by = audit.SYSTEM.label
    return d


# --------------------------------------------------------------------------
# Sensor readings
# --------------------------------------------------------------------------


def ingest_sensor_event(
    db: Session,
    *,
    external_event_id: str,
    zone_id: str,
    delta_grams: int,
    occurred_at: datetime,
    source: EventSource,
    is_simulated: bool,
    calibration: dict[str, Any] | None,
    session_id: str | None,
    actor: Actor,
) -> tuple[SensorEvent, bool]:
    existing = db.scalar(select(SensorEvent).where(SensorEvent.external_event_id == external_event_id))
    if existing is not None:
        return existing, True
    if session_id is None:
        binding = db.get(ZoneBinding, zone_id)
        session_id = binding.session_id if binding else None
    ev = SensorEvent(
        external_event_id=external_event_id,
        session_id=session_id,
        zone_id=zone_id,
        delta_grams=delta_grams,
        source=source,
        is_simulated=is_simulated,
        calibration=calibration or {},
        occurred_at=ensure_utc(occurred_at),
    )
    db.add(ev)
    db.flush()
    audit.record(
        db,
        actor=actor,
        event_type="SENSOR_READING",
        summary=f"{'[SIMULATED] ' if is_simulated else ''}Shelf weight change {delta_grams:+d} g in {zone_id} (supporting evidence only).",
        session_id=session_id,
        entity_type="sensor_event",
        entity_id=ev.id,
        source=source,
        is_simulated=is_simulated,
        details={"delta_grams": delta_grams, "calibration": calibration or {}},
    )
    enqueue(db, "sensor.created", session_id=session_id, data={"id": ev.id})
    return ev, False


# --------------------------------------------------------------------------
# Finalisation of pending pickups
# --------------------------------------------------------------------------


def finalize_pending(db: Session, *, session_id: str | None = None, force: bool = False) -> int:
    """Decide pickups whose grace window expired (or all pending ones if forced)."""
    policy = current_policy(db)
    now = utcnow()
    q = select(VisionEvent).where(
        VisionEvent.event_type == VisionEventType.PICKUP,
        VisionEvent.state == VisionEventState.OBSERVED,
        VisionEvent.session_id.is_not(None),
    )
    if session_id:
        q = q.where(VisionEvent.session_id == session_id)
    if not force:
        q = q.where(or_(VisionEvent.finalize_after.is_(None), VisionEvent.finalize_after <= now))
    pending = list(db.scalars(q.order_by(VisionEvent.occurred_at)))
    if not pending:
        return 0
    names = _product_names(db)
    decided = 0
    for ve in pending:
        session = db.get(ShoppingSession, ve.session_id)
        if session is None:
            continue
        scans = _accepted_scans(db, session.id)
        match = find_matching_scan(_pickup_view(ve), [_scan_view(s) for s in scans], policy)
        evidence = _evidence_for(db, ve, policy)
        if match is not None:
            scan = next(s for s in scans if s.id == match.id)
            _link(scan, ve)
            _record_result(
                db,
                session_id=session.id,
                outcome=ReconciliationOutcome.MATCHED,
                explanation=f"Candidate pickup matched scan {scan.id}.",
                policy=policy,
                vision_event=ve,
                scan=scan,
                evidence=evidence,
            )
            _resolve_duplicate_flag_for_scan(db, scan)
            decided += 1
            continue

        # Scans already cited by an open wrong-product alert are not reused.
        cited = set(
            db.scalars(
                select(Discrepancy.scan_event_id).where(
                    Discrepancy.session_id == session.id,
                    Discrepancy.kind == DiscrepancyKind.WRONG_PRODUCT,
                    Discrepancy.state.in_(OPEN_DISCREPANCY_STATES),
                )
            )
        )
        start = ve.occurred_at - timedelta(seconds=policy.scan_lead_s)
        end = ve.occurred_at + timedelta(seconds=policy.scan_grace_s)
        window_scans = [
            _scan_view(s)
            for s in scans
            if s.matched_vision_event_id is None
            and s.id not in cited
            and s.method in SCAN_LIKE_METHODS
            and start <= s.occurred_at <= end
        ]
        decision = decide_unmatched_pickup(
            _pickup_view(ve), evidence, other_unmatched_scans=window_scans, policy=policy, product_names=names
        )
        rr = _record_result(
            db,
            session_id=session.id,
            outcome=decision.outcome,
            explanation=decision.explanation,
            policy=policy,
            vision_event=ve,
            evidence=evidence,
        )
        ve.decided_at = now
        ve.finalize_after = None
        if decision.kind is None:
            ve.state = VisionEventState.LOW_SIGNAL
            decided += 1
            continue
        ve.state = VisionEventState.CANDIDATE_DISCREPANCY
        conflicting = db.get(ScanEvent, decision.conflicting_scan_id) if decision.conflicting_scan_id else None
        discrepancies.create(
            db,
            session=session,
            kind=decision.kind,
            state=decision.state or DiscrepancyState.AWAITING_CUSTOMER,
            dedupe_key=f"VIS:{ve.id}",
            blocking=decision.blocking,
            explanation=decision.explanation,
            recommended_action=decision.recommended_action,
            source=ve.source,
            is_simulated=ve.is_simulated,
            customer_options=decision.customer_options,
            vision_event_id=ve.id,
            scan_event_id=conflicting.id if conflicting else None,
            observed_product_id=ve.product_id,
            scanned_product_id=conflicting.product_id if conflicting else None,
            observed_name=names.get(ve.product_id or "", None),
            scanned_name=names.get(conflicting.product_id or "", None) if conflicting else None,
            reconciliation_result_id=rr.id,
            model_confidence=ve.model_confidence,
            reconciliation_confidence=evidence.score,
        )
        decided += 1
    return decided


def pending_count(db: Session, session_id: str) -> int:
    return len(
        db.scalars(
            select(VisionEvent.id).where(
                VisionEvent.session_id == session_id,
                VisionEvent.event_type == VisionEventType.PICKUP,
                VisionEvent.state == VisionEventState.OBSERVED,
            )
        ).all()
    )
