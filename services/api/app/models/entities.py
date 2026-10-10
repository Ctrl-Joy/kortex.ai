"""SQLAlchemy ORM models for KORTEX.

Money is stored as integer paise. Timestamps are stored in UTC.
Evidence rows (scans, vision events, sensor events, reconciliation results,
resolution actions, audit events) are append-only: corrections create new rows
rather than overwriting the original evidence.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import new_id
from app.core.time import utcnow
from app.db.base import Base, UTCDateTime


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class StaffUser(Base):
    __tablename__ = "staff_users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("STF", 6))
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price_paise > 0", name="ck_product_price_positive"),
        CheckConstraint("weight_grams IS NULL OR weight_grams > 0", name="ck_product_weight_positive"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("PRD", 6))
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    barcode: Mapped[str] = mapped_column(String(14), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(80))
    price_paise: Mapped[int] = mapped_column(Integer)
    weight_grams: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Optional mapping to a detector class label (e.g. COCO "bottle"). A class
    # label is NOT a SKU identity: several products may share one class.
    model_class: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    accent_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class ShoppingSession(Base):
    __tablename__ = "shopping_sessions"
    __table_args__ = (Index("ix_sessions_status_started", "status", "started_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("SES", 8))
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"))
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE", index=True)
    customer_label: Mapped[str] = mapped_column(String(64))
    customer_token_hash: Mapped[str] = mapped_column(String(128))
    zone_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    scenario_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    camera_gap_open: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    last_activity_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    items: Mapped[list[CartItem]] = relationship(back_populates="session", cascade="all, delete-orphan")


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        UniqueConstraint("session_id", "product_id", name="uq_cart_session_product"),
        CheckConstraint("quantity >= 0", name="ck_cart_quantity_nonneg"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("shopping_sessions.id"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    session: Mapped[ShoppingSession] = relationship(back_populates="items")
    product: Mapped[Product] = relationship()


class ScanEvent(Base):
    """One unit added to (or attempted to be added to) a cart."""

    __tablename__ = "scan_events"
    __table_args__ = (
        UniqueConstraint("session_id", "client_scan_id", name="uq_scan_client_id"),
        Index("ix_scan_session_time", "session_id", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("SCN", 8))
    session_id: Mapped[str] = mapped_column(ForeignKey("shopping_sessions.id"))
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    barcode: Mapped[str] = mapped_column(String(32))
    method: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32))
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(32))
    client_scan_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duplicate_of_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    matched_vision_event_id: Mapped[str | None] = mapped_column(
        ForeignKey("vision_events.id"), nullable=True, unique=True
    )
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    void_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    product: Mapped[Product | None] = relationship()


class VisionEvent(Base):
    __tablename__ = "vision_events"
    __table_args__ = (
        Index("ix_vision_session_time", "session_id", "occurred_at"),
        Index("ix_vision_state_deadline", "state", "finalize_after"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("VIS", 8))
    external_event_id: Mapped[str] = mapped_column(String(64), unique=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("shopping_sessions.id"), nullable=True)
    zone_id: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(32))
    source: Mapped[str] = mapped_column(String(32))
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    track_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    class_label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    candidate_product_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    model_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    track_frames: Mapped[int | None] = mapped_column(Integer, nullable=True)
    zone_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    uncertainty_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    recognition_level: Mapped[str] = mapped_column(String(16), default="SKU")  # SKU | CLASS | UNKNOWN
    state: Mapped[str] = mapped_column(String(32))
    reconciliation_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    matched_scan_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    related_event_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    finalize_after: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    product: Mapped[Product | None] = relationship(foreign_keys=[product_id])


class SensorEvent(Base):
    """Shelf weight change. Supporting evidence only, never identity proof."""

    __tablename__ = "sensor_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("SNS", 8))
    external_event_id: Mapped[str] = mapped_column(String(64), unique=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("shopping_sessions.id"), nullable=True, index=True)
    zone_id: Mapped[str] = mapped_column(String(32))
    delta_grams: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(32))
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=True)
    calibration: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ReconciliationResult(Base):
    __tablename__ = "reconciliation_results"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("REC", 8))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("shopping_sessions.id"), nullable=True, index=True)
    vision_event_id: Mapped[str | None] = mapped_column(ForeignKey("vision_events.id"), nullable=True)
    scan_event_id: Mapped[str | None] = mapped_column(ForeignKey("scan_events.id"), nullable=True)
    outcome: Mapped[str] = mapped_column(String(40))
    model_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    reconciliation_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    factors: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    explanation: Mapped[str] = mapped_column(Text)
    policy_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Discrepancy(Base):
    __tablename__ = "discrepancies"
    __table_args__ = (Index("ix_discrepancy_session_state", "session_id", "state"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("DSC", 8))
    session_id: Mapped[str] = mapped_column(ForeignKey("shopping_sessions.id"))
    kind: Mapped[str] = mapped_column(String(40), index=True)
    state: Mapped[str] = mapped_column(String(32), index=True)
    blocking: Mapped[bool] = mapped_column(Boolean, default=True)
    dedupe_key: Mapped[str] = mapped_column(String(128), unique=True)
    vision_event_id: Mapped[str | None] = mapped_column(ForeignKey("vision_events.id"), nullable=True)
    scan_event_id: Mapped[str | None] = mapped_column(ForeignKey("scan_events.id"), nullable=True)
    observed_product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    scanned_product_id: Mapped[str | None] = mapped_column(ForeignKey("products.id"), nullable=True)
    reconciliation_result_id: Mapped[str | None] = mapped_column(ForeignKey("reconciliation_results.id"), nullable=True)
    source: Mapped[str] = mapped_column(String(32))
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    model_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    reconciliation_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence_note: Mapped[str] = mapped_column(Text, default="")
    explanation: Mapped[str] = mapped_column(Text)
    customer_message: Mapped[str] = mapped_column(Text)
    recommended_action: Mapped[str] = mapped_column(Text)
    customer_options: Mapped[list[str]] = mapped_column(JSON, default=list)
    resolution_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    resolution_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    observed_product: Mapped[Product | None] = relationship(foreign_keys=[observed_product_id])
    scanned_product: Mapped[Product | None] = relationship(foreign_keys=[scanned_product_id])
    actions: Mapped[list[ResolutionAction]] = relationship(
        back_populates="discrepancy", order_by="ResolutionAction.created_at"
    )


class ResolutionAction(Base):
    __tablename__ = "resolution_actions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ACT", 8))
    discrepancy_id: Mapped[str] = mapped_column(ForeignKey("discrepancies.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("shopping_sessions.id"), index=True)
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(48))
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cart_delta: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    state_before: Mapped[str] = mapped_column(String(32))
    state_after: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    discrepancy: Mapped[Discrepancy] = relationship(back_populates="actions")


class CheckoutRecord(Base):
    __tablename__ = "checkout_records"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("CHK", 8))
    session_id: Mapped[str] = mapped_column(ForeignKey("shopping_sessions.id"), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="AUTHORIZED")
    item_count: Mapped[int] = mapped_column(Integer)
    subtotal_paise: Mapped[int] = mapped_column(Integer)
    total_paise: Mapped[int] = mapped_column(Integer)
    lines: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    payment_mode: Mapped[str] = mapped_column(String(32), default="SIMULATED")
    exit_code: Mapped[str] = mapped_column(String(16))
    authorized_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    exited_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    verification_summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class AuditEvent(Base):
    """Append-only audit log."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_session_seq", "session_id", "seq"),)

    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String(32), unique=True, default=lambda: new_id("AUD", 10))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[str] = mapped_column(String(48), index=True)
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    summary: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class ZoneBinding(Base):
    """Which shopping session a camera/shelf zone is currently attributed to.

    Associating a camera observation with a specific shopper is a hard problem
    in a real store. The prototype uses an explicit, controlled binding.
    """

    __tablename__ = "zone_bindings"

    zone_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    label: Mapped[str] = mapped_column(String(80))
    session_id: Mapped[str | None] = mapped_column(ForeignKey("shopping_sessions.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class ServiceHeartbeat(Base):
    __tablename__ = "service_heartbeats"

    service: Mapped[str] = mapped_column(String(32), primary_key=True)
    status: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
