import type { CustomerState, Discrepancy, DiscrepancyDetail, Product } from "@/types/api";

export const cola: Product = {
  id: "PRD-COLA",
  sku: "BEV-COLA-500",
  barcode: "8901001000012",
  name: "Kortex Cola 500 ml",
  category: "Beverages",
  price_paise: 4000,
  weight_grams: 540,
  image_url: null,
  model_class: "bottle",
  accent_color: "#ef4444",
  active: true,
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
};

export const choc: Product = { ...cola, id: "PRD-CHOC", sku: "CNF-CHOC-100", name: "Dark Chocolate Bar 100 g", price_paise: 6000, model_class: null };

export const wrongProduct: Discrepancy = {
  id: "DSC-TEST1",
  session_id: "SES-TEST",
  kind: "WRONG_PRODUCT",
  kind_label: "Possible wrong-product scan",
  state: "AWAITING_CUSTOMER",
  blocking: true,
  vision_event_id: "VIS-1",
  scan_event_id: "SCN-1",
  observed_product: choc,
  scanned_product: cola,
  source: "SIMULATED",
  is_simulated: true,
  model_confidence: 0.86,
  reconciliation_confidence: 0.96,
  confidence_note: "High",
  explanation: "Scanned Cola but camera observed a candidate pickup of Chocolate.",
  customer_message: "You scanned Kortex Cola 500 ml, but the shelf camera saw what looks like Dark Chocolate Bar 100 g. Which one do you have?",
  recommended_action: "Ask the customer.",
  customer_options: ["REPLACE_ITEM", "KEEP_SCANNED", "REQUEST_STAFF"],
  resolution_code: null,
  resolution_reason: null,
  resolved_by: null,
  created_at: "2026-10-10T10:00:00Z",
  updated_at: "2026-10-10T10:00:00Z",
  resolved_at: null,
};

export function customerState(overrides: Partial<CustomerState> = {}): CustomerState {
  return {
    session: {
      id: "SES-TEST",
      store_id: "STR",
      status: "ACTIVE",
      customer_label: "Guest 1234",
      zone_id: "SHELF-A1",
      is_demo: false,
      scenario_code: null,
      camera_gap_open: false,
      started_at: "2026-10-10T10:00:00Z",
      last_activity_at: "2026-10-10T10:00:00Z",
      ended_at: null,
    },
    lines: [{ product: cola, quantity: 1, unit_price_paise: 4000, line_total_paise: 4000 }],
    item_count: 1,
    subtotal_paise: 4000,
    verification: {
      status: "NEEDS_ATTENTION",
      accepted_units: 1,
      visually_verified_units: 0,
      unverified_units: 1,
      camera_observations: 1,
      pending_observations: 0,
      open_blocking: 1,
      open_advisory: 0,
      camera_gap_open: false,
      note: "",
    },
    discrepancies: [wrongProduct],
    recent_scans: [],
    checkout: null,
    ...overrides,
  };
}

export const detail: DiscrepancyDetail = {
  ...wrongProduct,
  state: "AWAITING_STAFF",
  actions: [],
  vision_event: null,
  scan_event: null,
  reconciliation: null,
};
