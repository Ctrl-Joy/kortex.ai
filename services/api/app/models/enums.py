"""Enumerations shared by models, schemas and the reconciliation engine."""

from __future__ import annotations

from enum import StrEnum


class SessionStatus(StrEnum):
    ACTIVE = "ACTIVE"
    CHECKOUT_AUTHORIZED = "CHECKOUT_AUTHORIZED"
    EXITED = "EXITED"
    CANCELLED = "CANCELLED"


class ScanMethod(StrEnum):
    CAMERA_BARCODE = "CAMERA_BARCODE"  # decoded by the browser barcode scanner
    MANUAL_ENTRY = "MANUAL_ENTRY"  # barcode digits typed by the customer
    CATALOGUE_SELECT = "CATALOGUE_SELECT"  # fallback product picker
    QUANTITY_INCREMENT = "QUANTITY_INCREMENT"  # "+" button in the cart
    CORRECTION = "CORRECTION"  # added by a confirmed discrepancy correction


class EventSource(StrEnum):
    CUSTOMER_APP = "CUSTOMER_APP"
    CAMERA_LIVE = "CAMERA_LIVE"  # real webcam + model output
    SIMULATED = "SIMULATED"  # deterministic demo / simulator
    MANUAL = "MANUAL"  # entered by staff by hand
    SENSOR_LIVE = "SENSOR_LIVE"
    SENSOR_SIMULATED = "SENSOR_SIMULATED"
    SYSTEM = "SYSTEM"


class ScanStatus(StrEnum):
    ACCEPTED = "ACCEPTED"
    DUPLICATE_IGNORED = "DUPLICATE_IGNORED"
    REJECTED_UNKNOWN = "REJECTED_UNKNOWN"
    REJECTED_INACTIVE = "REJECTED_INACTIVE"
    REJECTED_INVALID = "REJECTED_INVALID"
    VOIDED = "VOIDED"


class VisionEventType(StrEnum):
    PICKUP = "PICKUP"  # candidate removal from the shelf zone
    RETURN = "RETURN"  # candidate return to the shelf zone
    OBSERVATION = "OBSERVATION"  # product seen, no interaction inferred
    CAMERA_OFFLINE = "CAMERA_OFFLINE"
    CAMERA_ONLINE = "CAMERA_ONLINE"


class VisionEventState(StrEnum):
    OBSERVED = "OBSERVED"  # waiting for a matching scan within the grace window
    MATCHED = "MATCHED"
    CANDIDATE_DISCREPANCY = "CANDIDATE_DISCREPANCY"
    RETURNED = "RETURNED"  # pickup later matched by a return
    RETURN_MATCHED = "RETURN_MATCHED"  # the return event itself
    DUPLICATE = "DUPLICATE"
    LOW_SIGNAL = "LOW_SIGNAL"  # below the noise floor, logged only
    UNASSIGNED = "UNASSIGNED"  # no shopping session bound to the zone
    RESOLVED = "RESOLVED"
    INFO = "INFO"  # camera status / observation-only events


class DiscrepancyKind(StrEnum):
    MISSED_SCAN = "MISSED_SCAN"
    WRONG_PRODUCT = "WRONG_PRODUCT"
    DUPLICATE_SCAN = "DUPLICATE_SCAN"
    UNCERTAIN_OBSERVATION = "UNCERTAIN_OBSERVATION"
    PICKUP_RETURN = "PICKUP_RETURN"
    CONFLICTING_EVIDENCE = "CONFLICTING_EVIDENCE"


class DiscrepancyState(StrEnum):
    AWAITING_CUSTOMER = "AWAITING_CUSTOMER"
    AWAITING_STAFF = "AWAITING_STAFF"
    ESCALATED = "ESCALATED"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


OPEN_DISCREPANCY_STATES = (
    DiscrepancyState.AWAITING_CUSTOMER,
    DiscrepancyState.AWAITING_STAFF,
    DiscrepancyState.ESCALATED,
)


class ReconciliationOutcome(StrEnum):
    MATCHED = "MATCHED"
    MISSED_SCAN_CANDIDATE = "MISSED_SCAN_CANDIDATE"
    WRONG_PRODUCT_CANDIDATE = "WRONG_PRODUCT_CANDIDATE"
    UNCERTAIN = "UNCERTAIN"
    CONFLICTING = "CONFLICTING"
    RETURN_MATCHED = "RETURN_MATCHED"
    RETURN_UNMATCHED = "RETURN_UNMATCHED"
    DUPLICATE_EVENT = "DUPLICATE_EVENT"
    LOW_SIGNAL_IGNORED = "LOW_SIGNAL_IGNORED"
    UNASSIGNED = "UNASSIGNED"
    COVERAGE_GAP = "COVERAGE_GAP"
    DUPLICATE_SCAN = "DUPLICATE_SCAN"
    LATE_SCAN_MATCHED = "LATE_SCAN_MATCHED"


class ActorType(StrEnum):
    CUSTOMER = "CUSTOMER"
    STAFF = "STAFF"
    SYSTEM = "SYSTEM"
    VISION = "VISION"
    SIMULATOR = "SIMULATOR"
    SENSOR = "SENSOR"


class ResolutionActionType(StrEnum):
    CUSTOMER_CONFIRMED_CORRECTION = "CUSTOMER_CONFIRMED_CORRECTION"
    CUSTOMER_KEPT_DUPLICATE = "CUSTOMER_KEPT_DUPLICATE"
    CUSTOMER_REMOVED_DUPLICATE = "CUSTOMER_REMOVED_DUPLICATE"
    CUSTOMER_ATTESTED = "CUSTOMER_ATTESTED"
    CUSTOMER_DISPUTED = "CUSTOMER_DISPUTED"
    CUSTOMER_REQUESTED_STAFF = "CUSTOMER_REQUESTED_STAFF"
    STAFF_RESOLVED = "STAFF_RESOLVED"
    STAFF_DISMISSED = "STAFF_DISMISSED"
    STAFF_REQUESTED_CUSTOMER = "STAFF_REQUESTED_CUSTOMER"
    STAFF_ESCALATED = "STAFF_ESCALATED"
    AUTO_RESOLVED = "AUTO_RESOLVED"


class StaffRole(StrEnum):
    MANAGER = "MANAGER"
    ATTENDANT = "ATTENDANT"
