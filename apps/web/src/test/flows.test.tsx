import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscrepancyDrawer } from "@/features/discrepancies/DiscrepancyDrawer";
import ShopPage from "@/features/customer/ShopPage";
import { formatINR, parseRupeesToPaise } from "@/lib/format";
import { keysFor } from "@/lib/live";
import { customerState, detail, wrongProduct } from "./fixtures";
import { mockFetch, renderWithProviders } from "./utils";

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  localStorage.clear();
});

describe("money formatting", () => {
  it("renders integer paise without float drift", () => {
    expect(formatINR(4000)).toContain("40.00");
    expect(formatINR(19905)).toContain("199.05");
    expect(parseRupeesToPaise("40.5")).toBe(4050);
    expect(parseRupeesToPaise("0.1")).toBe(10);
    expect(parseRupeesToPaise("-3")).toBeNull();
    expect(parseRupeesToPaise("1.234")).toBeNull();
  });
});

describe("live invalidation", () => {
  it("maps discrepancy messages to the right query keys", () => {
    const keys = keysFor({ v: 1, type: "discrepancy.created", session_id: "SES-1", ts: "", data: {} });
    expect(keys).toContainEqual(["discrepancies"]);
    expect(keys).toContainEqual(["customer-state", "SES-1"]);
  });
});

describe("customer scan-and-go", () => {
  it("shows a non-accusatory mismatch alert and confirms the correction with the session token", async () => {
    localStorage.setItem("kortex.shop", JSON.stringify({ sessionId: "SES-TEST", token: "tok-123" }));
    let resolved = false;
    const calls = mockFetch((req) => {
      if (req.startsWith("GET /api/sessions/SES-TEST/state"))
        return {
          body: resolved
            ? customerState({ discrepancies: [{ ...wrongProduct, state: "RESOLVED" }], subtotal_paise: 6000, verification: { ...customerState().verification, status: "VERIFIED", open_blocking: 0 } })
            : customerState(),
        };
      if (req.startsWith("POST /api/discrepancies/DSC-TEST1/customer-resolution")) {
        resolved = true;
        return { body: { ...wrongProduct, state: "RESOLVED" } };
      }
      if (req.startsWith("GET /api/products")) return { body: [] };
      return undefined;
    });

    renderWithProviders(<ShopPage />, { route: "/shop" });
    expect(await screen.findByText("Quick check needed")).toBeInTheDocument();
    expect(screen.queryByText(/theft/i)).not.toBeInTheDocument();
    expect(screen.getByText("You scanned")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /I have Dark Chocolate/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes("customer-resolution"))).toBe(true));
    const call = calls.find((c) => c.url.includes("customer-resolution"))!;
    expect(call.body).toEqual({ option: "REPLACE_ITEM" });
    expect(call.headers["X-Session-Token"]).toBe("tok-123");
    expect(await screen.findByText("Your cart looks good")).toBeInTheDocument();
  });

  it("starts a session when the shopper taps Start shopping", async () => {
    const calls = mockFetch((req) => {
      if (req.startsWith("POST /api/sessions"))
        return { status: 201, body: { session: customerState().session, customer_token: "new-token" } };
      if (req.startsWith("GET /api/sessions/SES-TEST/state")) return { body: customerState({ discrepancies: [], lines: [], item_count: 0, subtotal_paise: 0 }) };
      if (req.startsWith("GET /api/products")) return { body: [] };
      return undefined;
    });
    renderWithProviders(<ShopPage />, { route: "/shop" });
    await userEvent.click(await screen.findByRole("button", { name: /Start shopping/ }));
    expect(await screen.findByText("Your cart is empty")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("kortex.shop")!)).toEqual({ sessionId: "SES-TEST", token: "new-token" });
    expect(calls[0].method).toBe("POST");
  });

  it("explains a backend checkout denial instead of only disabling a button", async () => {
    localStorage.setItem("kortex.shop", JSON.stringify({ sessionId: "SES-TEST", token: "tok" }));
    mockFetch((req) => {
      if (req.startsWith("GET /api/sessions/SES-TEST/state")) return { body: customerState() };
      if (req.startsWith("GET /api/sessions/SES-TEST/checkout/preview"))
        return {
          body: {
            session_id: "SES-TEST",
            eligible: false,
            blockers: [{ code: "UNRESOLVED_DISCREPANCY", message: "Unresolved possible wrong-product scan (DSC-TEST1).", action: "Review the alert in your cart and choose an option." }],
            warnings: [],
            lines: customerState().lines,
            item_count: 1,
            subtotal_paise: 4000,
            total_paise: 4000,
            verification: customerState().verification,
            already_checked_out: false,
            payment_mode: "SIMULATED",
          },
        };
      if (req.startsWith("GET /api/products")) return { body: [] };
      return undefined;
    });
    renderWithProviders(<ShopPage />, { route: "/shop" });
    await userEvent.click(await screen.findByRole("button", { name: /Checkout/ }));
    expect(await screen.findByText(/A few checks are needed/)).toBeInTheDocument();
    expect(screen.getByText(/Unresolved possible wrong-product scan/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pay/ })).toBeDisabled();
  });
});

describe("staff discrepancy review", () => {
  it("requires a documented reason before dismissing a false positive", async () => {
    const calls = mockFetch((req) => {
      if (req.startsWith("GET /api/discrepancies/DSC-TEST1")) return { body: detail };
      if (req.startsWith("POST /api/discrepancies/DSC-TEST1/staff-resolution")) return { body: { ...detail, state: "DISMISSED" } };
      return undefined;
    });
    renderWithProviders(<DiscrepancyDrawer id="DSC-TEST1" onClose={() => {}} />);
    expect(await screen.findByText(/not a finding of wrongdoing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Dismiss false positive/ }));
    await userEvent.click(screen.getByRole("button", { name: /Confirm decision/ }));
    expect(await screen.findByText(/Please document a reason/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    await userEvent.type(screen.getByLabelText(/Reason/), "Shelf count unchanged; shopper only read the label.");
    await userEvent.click(screen.getByRole("button", { name: /Confirm decision/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ action: "DISMISS", correction: "NONE" });
  });
});
