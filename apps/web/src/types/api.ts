/** Types mirroring the FastAPI response schemas (services/api/app/schemas/api.py). */

export type Paise = number;

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Staff {
  id: string;
  username: string;
  display_name: string;
  role: "MANAGER" | "ATTENDANT";
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  category: string;
  price_paise: Paise;
  weight_grams: number | null;
  image_url: string | null;
  model_class: string | null;
  accent_color: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type SessionStatus = "ACTIVE" | "CHECKOUT_AUTHORIZED" | "EXITED" | "CANCELLED";

export interface ShoppingSession {
  id: string;
  store_id: string;
  status: SessionStatus;
  customer_label: string;
  zone_id: string | null;
  is_demo: boolean;
  scenario_code: string | null;
  camera_gap_open: boolean;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
}

export interface SessionSummary extends ShoppingSession {
  item_count: number;
  subtotal_paise: Paise;
  scan_count: number;
  open_discrepancies: number;
  verification_status: string;
  checkout_status: string;
}

export interface CartLine {
  product: Product;
  quantity: number;
  unit_price_paise: Paise;
  line_total_paise: Paise;
}

export interface Verification {
  status: "VERIFIED" | "VERIFYING" | "NEEDS_ATTENTION" | "CHECKED_OUT";
  accepted_units: number;
  visually_verified_units: number;
  unverified_units: number;
  camera_observations: number;
  pending_observations: number;
  open_blocking: number;
  open_advisory: number;
  camera_gap_open: boolean;
  note: string;
}

export type EventSource =
  | "CUSTOMER_APP"
  | "CAMERA_LIVE"
  | "SIMULATED"
  | "MANUAL"
  | "SENSOR_LIVE"
  | "SENSOR_SIMULATED"
  | "SYSTEM";

export interface ScanEvent {
  id: string;
  session_id: string;
  product_id: string | null;
  barcode: string;
  method: string;
  source: EventSource;
  is_simulated: boolean;
  status: string;
  client_scan_id: string | null;
  matched_vision_event_id: string | null;
  occurred_at: string;
  received_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface VisionEvent {
  id: string;
  external_event_id: string;
  session_id: string | null;
  zone_id: string;
  event_type: "PICKUP" | "RETURN" | "OBSERVATION" | "CAMERA_OFFLINE" | "CAMERA_ONLINE";
  source: EventSource;
  is_simulated: boolean;
  track_id: string | null;
  class_label: string | null;
  candidate_product_ids: string[];
  product_id: string | null;
  model_confidence: number | null;
  track_frames: number | null;
  zone_status: string | null;
  uncertainty_reason: string | null;
  recognition_level: "SKU" | "CLASS" | "UNKNOWN";
  state: string;
  reconciliation_confidence: number | null;
  matched_scan_id: string | null;
  related_event_id: string | null;
  occurred_at: string;
  received_at: string;
  finalize_after: string | null;
  decided_at: string | null;
}

export interface SensorEvent {
  id: string;
  session_id: string | null;
  zone_id: string;
  delta_grams: number;
  source: EventSource;
  is_simulated: boolean;
  calibration: Record<string, unknown>;
  occurred_at: string;
}

export interface Factor {
  label: string;
  delta: number;
  detail: string;
}

export interface Reconciliation {
  id: string;
  session_id: string | null;
  vision_event_id: string | null;
  scan_event_id: string | null;
  outcome: string;
  model_confidence: number | null;
  reconciliation_confidence: number | null;
  factors: Factor[];
  explanation: string;
  created_at: string;
}

export type DiscrepancyKind =
  | "MISSED_SCAN"
  | "WRONG_PRODUCT"
  | "DUPLICATE_SCAN"
  | "UNCERTAIN_OBSERVATION"
  | "PICKUP_RETURN"
  | "CONFLICTING_EVIDENCE";

export type DiscrepancyState = "AWAITING_CUSTOMER" | "AWAITING_STAFF" | "ESCALATED" | "RESOLVED" | "DISMISSED";

export interface ResolutionAction {
  id: string;
  discrepancy_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  reason: string | null;
  cart_delta: { product_id: string; name?: string; qty_delta: number; unit_price_paise?: number | null }[];
  state_before: string;
  state_after: string;
  created_at: string;
}

export interface Discrepancy {
  id: string;
  session_id: string;
  kind: DiscrepancyKind;
  kind_label: string;
  state: DiscrepancyState;
  blocking: boolean;
  vision_event_id: string | null;
  scan_event_id: string | null;
  observed_product: Product | null;
  scanned_product: Product | null;
  source: EventSource;
  is_simulated: boolean;
  model_confidence: number | null;
  reconciliation_confidence: number | null;
  confidence_note: string;
  explanation: string;
  customer_message: string;
  recommended_action: string;
  customer_options: string[];
  resolution_code: string | null;
  resolution_reason: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface DiscrepancyDetail extends Discrepancy {
  actions: ResolutionAction[];
  vision_event: VisionEvent | null;
  scan_event: ScanEvent | null;
  reconciliation: Reconciliation | null;
}

export interface CheckoutRecord {
  id: string;
  session_id: string;
  status: "AUTHORIZED" | "EXITED";
  item_count: number;
  subtotal_paise: Paise;
  total_paise: Paise;
  lines: {
    product_id: string;
    sku: string;
    barcode: string;
    name: string;
    quantity: number;
    unit_price_paise: Paise;
    line_total_paise: Paise;
  }[];
  payment_mode: string;
  exit_code: string;
  authorized_at: string;
  exited_at: string | null;
  verification_summary: Partial<Verification>;
}

export interface Blocker {
  code: string;
  message: string;
  action: string;
}

export interface CheckoutPreview {
  session_id: string;
  eligible: boolean;
  blockers: Blocker[];
  warnings: string[];
  lines: CartLine[];
  item_count: number;
  subtotal_paise: Paise;
  total_paise: Paise;
  verification: Verification;
  already_checked_out: boolean;
  payment_mode: string;
}

export interface CustomerState {
  session: ShoppingSession;
  lines: CartLine[];
  item_count: number;
  subtotal_paise: Paise;
  verification: Verification;
  discrepancies: Discrepancy[];
  recent_scans: ScanEvent[];
  checkout: CheckoutRecord | null;
}

export interface SessionDetail {
  session: ShoppingSession;
  lines: CartLine[];
  item_count: number;
  subtotal_paise: Paise;
  verification: Verification;
  scanned_cart: {
    label: string;
    lines: { product_id: string; name: string; quantity: number; unit_price_paise: Paise; line_total_paise: Paise }[];
    item_count: number;
    subtotal_paise: Paise;
  };
  corrections: ResolutionAction[];
  checkout: CheckoutRecord | null;
  eligibility: CheckoutPreview;
}

export interface AuditEvent {
  id: string;
  seq: number;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  event_type: string;
  session_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  source: string | null;
  is_simulated: boolean;
  summary: string;
  details: Record<string, unknown>;
}

export interface ScanResponse {
  status: string;
  message: string;
  scan: ScanEvent | null;
  product: Product | null;
  discrepancy_id: string | null;
}

export interface VisionStatus {
  online: boolean;
  last_seen_at: string | null;
  message: string | null;
  status: {
    camera_status: "ONLINE" | "OFFLINE" | "STARTING" | "DISABLED";
    camera_index: number | null;
    model_name: string | null;
    model_loaded: boolean;
    recognition_mode: string | null;
    fps: number | null;
    zone_id: string | null;
    detectable_classes: string[];
    mapped_classes: Record<string, string>;
    message: string | null;
  } | null;
}

export interface Health {
  api: { ok: boolean; version: string; environment: string };
  database: { ok: boolean; engine: string; error: string | null };
  websocket: { ok: boolean; clients: number };
  vision: VisionStatus;
  simulation: { enabled: boolean; note: string };
  security: { insecure_dev_secret: boolean };
  time: string;
}

export interface Overview {
  generated_at: string;
  kpis: {
    active_sessions: number;
    sessions_awaiting_review: number;
    open_discrepancies: number;
    awaiting_customer: number;
    resolved_discrepancies: number;
    dismissed_discrepancies: number;
    checkouts_authorized: number;
    checkouts_denied: number;
    sessions_blocked_now: number;
    revenue_paise: Paise;
  };
  discrepancy_distribution: { kind: DiscrepancyKind; label: string; count: number }[];
  activity: { date: string; sessions: number; checkouts: number; discrepancies: number }[];
  event_sources: { vision: Record<string, number>; scans: Record<string, number> };
  recent_sessions: SessionSummary[];
  vision: VisionStatus;
  data_note: string;
}

export interface Zone {
  zone_id: string;
  label: string;
  session_id: string | null;
  updated_at: string;
}

export interface PolicyInfo {
  values: Record<string, number | boolean>;
  defaults: Record<string, number | boolean>;
  descriptions: Record<string, string>;
  bounds: Record<string, [number, number]>;
  note: string;
}

export interface DemoScenario {
  code: string;
  title: string;
  summary: string;
  hint: string;
  steps: string[];
}

export interface DemoRun {
  run_id: string;
  scenario: string;
  title: string;
  status: "RUNNING" | "WAITING_FOR_PRESENTER" | "COMPLETED" | "FAILED";
  session_id: string | null;
  customer_link: string | null;
  steps: { label: string; status: string; detail: string; human: boolean; at: string | null }[];
  hint: string;
  started_at: string;
  finished_at: string | null;
}

export interface LiveMessage {
  v: number;
  type: string;
  session_id: string | null;
  ts: string;
  data: Record<string, unknown>;
}
