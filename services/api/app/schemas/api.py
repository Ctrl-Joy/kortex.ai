"""Typed request/response schemas for the REST API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services import barcode as barcode_rules


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class ErrorResponse(BaseModel):
    error: ErrorBody


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------- auth -----


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class StaffOut(ORM):
    id: str
    username: str
    display_name: str
    role: str


class LoginResponse(BaseModel):
    token: str
    expires_in: int
    staff: StaffOut


# ------------------------------------------------------------ products -----


class ProductOut(ORM):
    id: str
    sku: str
    barcode: str
    name: str
    category: str
    price_paise: int
    weight_grams: int | None
    image_url: str | None
    model_class: str | None
    accent_color: str | None
    active: bool
    created_at: datetime
    updated_at: datetime


class ProductBase(BaseModel):
    sku: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9\-_]+$")
    barcode: str = Field(min_length=8, max_length=14)
    name: str = Field(min_length=2, max_length=160)
    category: str = Field(min_length=2, max_length=80)
    price_paise: int = Field(gt=0, le=10_000_000, description="Price in paise (₹1 = 100 paise)")
    weight_grams: int | None = Field(default=None, gt=0, le=100_000)
    image_url: str | None = Field(default=None, max_length=255)
    model_class: str | None = Field(default=None, max_length=64)
    accent_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    active: bool = True

    @field_validator("barcode")
    @classmethod
    def _valid_barcode(cls, v: str) -> str:
        v = barcode_rules.normalise(v)
        if not barcode_rules.is_valid(v):
            raise ValueError("Barcode must be a valid EAN-13, EAN-8, UPC-A or UPC-E code (check digit verified)")
        return v

    @field_validator("name", "category", "sku")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Must not be blank")
        return v

    @field_validator("image_url")
    @classmethod
    def _safe_image(cls, v: str | None) -> str | None:
        if v and not (v.startswith("/") or v.startswith("https://")):
            raise ValueError("Image URL must be a local path (/...) or https:// URL")
        return v or None

    @field_validator("model_class")
    @classmethod
    def _blank_none(cls, v: str | None) -> str | None:
        return v.strip() or None if v else None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=2, max_length=64, pattern=r"^[A-Za-z0-9\-_]+$")
    barcode: str | None = None
    name: str | None = Field(default=None, min_length=2, max_length=160)
    category: str | None = Field(default=None, min_length=2, max_length=80)
    price_paise: int | None = Field(default=None, gt=0, le=10_000_000)
    weight_grams: int | None = Field(default=None, gt=0, le=100_000)
    image_url: str | None = Field(default=None, max_length=255)
    model_class: str | None = Field(default=None, max_length=64)
    accent_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    active: bool | None = None

    @field_validator("barcode")
    @classmethod
    def _valid_barcode(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = barcode_rules.normalise(v)
        if not barcode_rules.is_valid(v):
            raise ValueError("Barcode must be a valid EAN-13, EAN-8, UPC-A or UPC-E code (check digit verified)")
        return v


# ------------------------------------------------------------ sessions -----


class SessionCreate(BaseModel):
    monitor_zone: str | None = Field(default="SHELF-A1", max_length=32)


class CartLineOut(BaseModel):
    product: ProductOut
    quantity: int
    unit_price_paise: int
    line_total_paise: int


class VerificationOut(BaseModel):
    status: str
    accepted_units: int
    visually_verified_units: int
    unverified_units: int
    camera_observations: int
    pending_observations: int
    open_blocking: int
    open_advisory: int
    camera_gap_open: bool
    note: str


class SessionOut(ORM):
    id: str
    store_id: str
    status: str
    customer_label: str
    zone_id: str | None
    is_demo: bool
    scenario_code: str | None
    camera_gap_open: bool
    started_at: datetime
    last_activity_at: datetime
    ended_at: datetime | None


class SessionSummaryOut(SessionOut):
    item_count: int
    subtotal_paise: int
    scan_count: int
    open_discrepancies: int
    verification_status: str
    checkout_status: str


class SessionCreated(BaseModel):
    session: SessionOut
    customer_token: str


class ScanEventOut(ORM):
    id: str
    session_id: str
    product_id: str | None
    barcode: str
    method: str
    source: str
    is_simulated: bool
    status: str
    client_scan_id: str | None
    matched_vision_event_id: str | None
    occurred_at: datetime
    received_at: datetime
    voided_at: datetime | None
    void_reason: str | None


class VisionEventOut(ORM):
    id: str
    external_event_id: str
    session_id: str | None
    zone_id: str
    event_type: str
    source: str
    is_simulated: bool
    track_id: str | None
    class_label: str | None
    candidate_product_ids: list[str]
    product_id: str | None
    model_confidence: float | None
    track_frames: int | None
    zone_status: str | None
    uncertainty_reason: str | None
    recognition_level: str
    state: str
    reconciliation_confidence: float | None
    matched_scan_id: str | None
    related_event_id: str | None
    occurred_at: datetime
    received_at: datetime
    finalize_after: datetime | None
    decided_at: datetime | None


class SensorEventOut(ORM):
    id: str
    session_id: str | None
    zone_id: str
    delta_grams: int
    source: str
    is_simulated: bool
    calibration: dict[str, Any]
    occurred_at: datetime


class ReconciliationOut(ORM):
    id: str
    session_id: str | None
    vision_event_id: str | None
    scan_event_id: str | None
    outcome: str
    model_confidence: float | None
    reconciliation_confidence: float | None
    factors: list[dict[str, Any]]
    explanation: str
    created_at: datetime


class ResolutionActionOut(ORM):
    id: str
    discrepancy_id: str
    actor_type: str
    actor_id: str | None
    action: str
    reason: str | None
    cart_delta: list[dict[str, Any]]
    state_before: str
    state_after: str
    created_at: datetime


class DiscrepancyOut(ORM):
    id: str
    session_id: str
    kind: str
    kind_label: str = ""
    state: str
    blocking: bool
    vision_event_id: str | None
    scan_event_id: str | None
    observed_product: ProductOut | None
    scanned_product: ProductOut | None
    source: str
    is_simulated: bool
    model_confidence: float | None
    reconciliation_confidence: float | None
    confidence_note: str
    explanation: str
    customer_message: str
    recommended_action: str
    customer_options: list[str]
    resolution_code: str | None
    resolution_reason: str | None
    resolved_by: str | None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class DiscrepancyDetailOut(DiscrepancyOut):
    actions: list[ResolutionActionOut]
    vision_event: VisionEventOut | None
    scan_event: ScanEventOut | None
    reconciliation: ReconciliationOut | None


class CustomerSessionState(BaseModel):
    """Everything the customer app needs, in one round trip."""

    session: SessionOut
    lines: list[CartLineOut]
    item_count: int
    subtotal_paise: int
    verification: VerificationOut
    discrepancies: list[DiscrepancyOut]
    recent_scans: list[ScanEventOut]
    checkout: CheckoutRecordOut | None


class CartStateOut(BaseModel):
    label: str
    lines: list[dict[str, Any]]
    item_count: int
    subtotal_paise: int


class SessionDetailOut(BaseModel):
    session: SessionOut
    lines: list[CartLineOut]
    item_count: int
    subtotal_paise: int
    verification: VerificationOut
    scanned_cart: CartStateOut
    corrections: list[ResolutionActionOut]
    checkout: CheckoutRecordOut | None
    eligibility: CheckoutPreviewOut


class AuditEventOut(ORM):
    id: str
    seq: int
    occurred_at: datetime
    actor_type: str
    actor_id: str | None
    event_type: str
    session_id: str | None
    entity_type: str | None
    entity_id: str | None
    source: str | None
    is_simulated: bool
    summary: str
    details: dict[str, Any]


class TimelineEntry(BaseModel):
    at: datetime
    kind: Literal["scan", "vision", "sensor", "reconciliation", "discrepancy", "action", "checkout", "audit"]
    id: str
    title: str
    detail: str = ""
    tone: Literal["neutral", "success", "warning", "danger", "info"] = "neutral"
    source: str | None = None
    is_simulated: bool = False


# --------------------------------------------------------------- scans -----


class ScanRequest(BaseModel):
    barcode: str = Field(min_length=1, max_length=32)
    method: Literal["CAMERA_BARCODE", "MANUAL_ENTRY", "CATALOGUE_SELECT"] = "CAMERA_BARCODE"
    client_scan_id: str | None = Field(default=None, max_length=64)


class ScanResponse(BaseModel):
    status: str
    message: str
    scan: ScanEventOut | None
    product: ProductOut | None
    discrepancy_id: str | None = None


class QuantityRequest(BaseModel):
    quantity: int = Field(ge=0, le=50)


# --------------------------------------------------------------- vision ----


class VisionEventIn(BaseModel):
    event_id: str = Field(min_length=6, max_length=64, description="Producer-generated idempotency key")
    zone_id: str = Field(default="SHELF-A1", max_length=32)
    session_id: str | None = None
    event_type: Literal["PICKUP", "RETURN", "OBSERVATION", "CAMERA_OFFLINE", "CAMERA_ONLINE"]
    occurred_at: datetime | None = None
    track_id: str | None = Field(default=None, max_length=64)
    class_label: str | None = Field(default=None, max_length=64)
    product_id: str | None = None
    product_sku: str | None = None
    model_confidence: float | None = Field(default=None, ge=0, le=1)
    track_frames: int | None = Field(default=None, ge=0, le=100_000)
    zone_status: str | None = Field(default=None, max_length=32)
    uncertainty_reason: str | None = Field(default=None, max_length=255)
    contradictory: bool = False
    model_name: str | None = Field(default=None, max_length=64)
    bbox: list[float] | None = None


class SimulatedVisionEventIn(VisionEventIn):
    event_id: str | None = Field(default=None, max_length=64)  # type: ignore[assignment]


class SensorEventIn(BaseModel):
    event_id: str | None = Field(default=None, max_length=64)
    zone_id: str = Field(default="SHELF-A1", max_length=32)
    session_id: str | None = None
    delta_grams: int = Field(ge=-50_000, le=50_000)
    occurred_at: datetime | None = None
    calibration: dict[str, Any] | None = None


class VisionIngestResponse(BaseModel):
    event: VisionEventOut
    replay: bool
    discrepancy_id: str | None = None


class HeartbeatIn(BaseModel):
    camera_status: Literal["ONLINE", "OFFLINE", "STARTING", "PAUSED", "DISABLED"]
    camera_index: int | None = None
    model_name: str | None = None
    model_loaded: bool = False
    recognition_mode: str | None = None
    fps: float | None = None
    zone_id: str | None = None
    detectable_classes: list[str] = []
    mapped_classes: dict[str, str] = {}
    message: str | None = None


# -------------------------------------------------------- discrepancies ----


class CustomerResolutionIn(BaseModel):
    option: str = Field(min_length=3, max_length=40)


class StaffResolutionIn(BaseModel):
    action: Literal["RESOLVE", "DISMISS", "REQUEST_CUSTOMER", "ESCALATE"]
    reason: str | None = Field(default=None, max_length=1000)
    correction: Literal["NONE", "ADD_OBSERVED", "REPLACE_WITH_OBSERVED", "REMOVE_SCANNED"] = "NONE"


# ------------------------------------------------------------- checkout ----


class BlockerOut(BaseModel):
    code: str
    message: str
    action: str


class CheckoutPreviewOut(BaseModel):
    session_id: str
    eligible: bool
    blockers: list[BlockerOut]
    warnings: list[str]
    lines: list[CartLineOut]
    item_count: int
    subtotal_paise: int
    total_paise: int
    verification: VerificationOut
    already_checked_out: bool
    payment_mode: str = "SIMULATED"


class CheckoutRecordOut(ORM):
    id: str
    session_id: str
    status: str
    item_count: int
    subtotal_paise: int
    total_paise: int
    lines: list[dict[str, Any]]
    payment_mode: str
    exit_code: str
    authorized_at: datetime
    exited_at: datetime | None
    verification_summary: dict[str, Any]


# --------------------------------------------------------------- system ----


class ZoneOut(ORM):
    zone_id: str
    label: str
    session_id: str | None
    updated_at: datetime


class ZoneBindIn(BaseModel):
    session_id: str | None


class PolicyOut(BaseModel):
    values: dict[str, Any]
    defaults: dict[str, Any]
    descriptions: dict[str, str]
    bounds: dict[str, list[float]]
    note: str


class PolicyUpdateIn(BaseModel):
    values: dict[str, Any]


class DemoRunIn(BaseModel):
    scenario: Literal["A", "B", "C", "D", "E", "F", "G", "H"]
    fast: bool = Field(default=False, description="Skip the real grace window (labelled in the audit trail)")
    auto_complete: bool = Field(default=False, description="Also perform the human steps (staff/customer)")
    step_delay_s: float = Field(default=1.2, ge=0, le=10)


class DemoRunOut(BaseModel):
    run_id: str
    scenario: str
    title: str
    status: str
    session_id: str | None
    customer_link: str | None
    steps: list[dict[str, Any]]
    hint: str
    started_at: datetime
    finished_at: datetime | None


CustomerSessionState.model_rebuild()
SessionDetailOut.model_rebuild()
