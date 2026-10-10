import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  CircleCheck,
  DoorOpen,
  Hand,
  Keyboard,
  Loader2,
  Lock,
  LogOut,
  Minus,
  Plus,
  Receipt,
  ScanLine,
  Search,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { LiveProvider, useLive } from "@/app/live-context";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { ProductThumb } from "@/components/status/ProductThumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Meter, Skeleton } from "@/components/ui/misc";
import { useCustomerState, useProducts } from "@/hooks/queries";
import { ApiError, api, errorMessage } from "@/lib/api";
import { shopStore, type ShopCredentials } from "@/lib/auth";
import { formatINR, formatDateTime } from "@/lib/format";
import { cn, uid } from "@/lib/utils";
import type { Blocker, CheckoutPreview, CheckoutRecord, CustomerState, Discrepancy, ScanResponse } from "@/types/api";
import { BarcodeScanner } from "./BarcodeScanner";
import { scanFeedback } from "./feedback";

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const [creds, setCreds] = useState<ShopCredentials | null>(() => shopStore.get());

  // Adopt credentials from a staff-generated demo link, then strip them from the URL.
  useEffect(() => {
    const session = params.get("session");
    const token = params.get("token");
    if (session && token) {
      const c = { sessionId: session, token };
      shopStore.set(c);
      setCreds(c);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const end = () => {
    shopStore.clear();
    setCreds(null);
  };

  return (
    <div className="mx-auto min-h-screen max-w-2xl">
      {creds ? (
        <LiveProvider query={`session_id=${encodeURIComponent(creds.sessionId)}&session_token=${encodeURIComponent(creds.token)}`}>
          <ShopSession creds={creds} onEnd={end} />
        </LiveProvider>
      ) : (
        <Welcome onStart={setCreds} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Welcome */

function Welcome({ onStart }: { onStart: (c: ShopCredentials) => void }) {
  const start = useMutation({
    mutationFn: () => api.post<{ session: { id: string }; customer_token: string }>("/api/sessions", { monitor_zone: "SHELF-A1" }, "none"),
    onSuccess: (r) => {
      const c = { sessionId: r.session.id, token: r.customer_token };
      shopStore.set(c);
      onStart(c);
    },
    onError: (e) => toast.error("Could not start a session", { description: errorMessage(e) }),
  });
  return (
    <div className="flex min-h-screen flex-col px-5 py-8">
      <Logo />
      <div className="flex flex-1 flex-col justify-center py-10">
        <div className="relative mx-auto mb-8 grid size-36 place-items-center">
          <div className="absolute inset-0 rounded-full bg-accent/10 blur-2xl" />
          <div className="relative grid size-28 place-items-center rounded-3xl border border-accent/30 bg-surface shadow-[var(--shadow-glow)]">
            <ScanLine className="size-12 text-accent" />
          </div>
        </div>
        <h1 className="text-center text-3xl font-semibold tracking-tight text-fg">Scan. Pick. Go.</h1>
        <p className="mx-auto mt-3 max-w-sm text-center text-[15px] leading-relaxed text-muted">
          Scan items with your phone as you shop at <span className="text-fg">KORTEX Demo Store</span>. Skip the queue — your
          cart is verified as you go.
        </p>
        <Button variant="primary" size="xl" className="mx-auto mt-8 w-full max-w-xs" loading={start.isPending} onClick={() => start.mutate()}>
          <ShoppingBag /> Start shopping
        </Button>
        <ul className="mx-auto mt-10 grid max-w-sm gap-3 text-[13px] text-muted">
          <li className="flex gap-3">
            <ShieldCheck className="size-5 shrink-0 text-teal" /> No account or personal details needed. No facial recognition.
          </li>
          <li className="flex gap-3">
            <Hand className="size-5 shrink-0 text-teal" /> If something doesn’t add up, we’ll simply ask you — you can always fix it yourself.
          </li>
        </ul>
      </div>
      <p className="text-center text-xs text-subtle">
        Prototype · payments are simulated ·{" "}
        <Link to="/login" className="text-muted hover:text-fg">
          Staff sign in
        </Link>
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- Session */

type View = "shop" | "checkout";

function ShopSession({ creds, onEnd }: { creds: ShopCredentials; onEnd: () => void }) {
  const q = useCustomerState(creds.sessionId, creds.token);
  const [view, setView] = useState<View>("shop");
  const auth = useMemo(() => ({ sessionToken: creds.token }), [creds.token]);

  useEffect(() => {
    if (q.error instanceof ApiError && (q.error.status === 401 || q.error.status === 404)) {
      toast.error("This shopping session is no longer available.");
      onEnd();
    }
  }, [q.error, onEnd]);

  if (q.isError && !(q.error instanceof ApiError && (q.error.status === 401 || q.error.status === 404))) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <TriangleAlert className="size-6 text-warn" />
        <p className="text-sm text-fg">{errorMessage(q.error)}</p>
        <Button variant="outline" onClick={() => q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-12" />
        <Skeleton className="h-56" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  const s = q.data;
  if (s.checkout || s.session.status !== "ACTIVE") return <ReceiptView state={s} auth={auth} onEnd={onEnd} />;
  if (view === "checkout") return <CheckoutView state={s} auth={auth} onBack={() => setView("shop")} />;
  return <ShopView state={s} auth={auth} onCheckout={() => setView("checkout")} onEnd={onEnd} />;
}

function ShopHeader({ state, onEnd }: { state: CustomerState; onEnd?: () => void }) {
  const { status } = useLive();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur-md">
      <LogoMark className="size-7" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-fg">KORTEX Demo Store</p>
        <p className="truncate font-mono text-[11px] text-subtle">
          {state.session.id} · {state.session.customer_label}
        </p>
      </div>
      {state.session.is_demo && <Badge tone="sim">DEMO</Badge>}
      <span className={cn("size-2 rounded-full", status === "open" ? "bg-ok" : "bg-warn")} title={status === "open" ? "Live" : "Reconnecting"} />
      {onEnd && (
        <button onClick={onEnd} className="rounded-md p-1.5 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Leave session on this device">
          <LogOut className="size-4" />
        </button>
      )}
    </header>
  );
}

/* --------------------------------------------------------------- Shopping */

function ShopView({
  state,
  auth,
  onCheckout,
  onEnd,
}: {
  state: CustomerState;
  auth: { sessionToken: string };
  onCheckout: () => void;
  onEnd: () => void;
}) {
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(true);
  const [mode, setMode] = useState<"camera" | "manual" | "catalogue">("camera");
  const [lastResult, setLastResult] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const key = ["customer-state", state.session.id];

  const scan = useMutation({
    mutationFn: (v: { barcode: string; method: string }) =>
      api.post<ScanResponse>(`/api/sessions/${state.session.id}/scans`, { ...v, client_scan_id: uid("scan") }, auth),
    onSuccess: (r) => {
      if (r.status === "ACCEPTED") {
        scanFeedback(r.discrepancy_id ? "warn" : "ok");
        setLastResult({ tone: r.discrepancy_id ? "warn" : "ok", text: r.discrepancy_id ? `${r.message} Please confirm the quantity below.` : r.message });
      } else {
        scanFeedback("warn");
        setLastResult({ tone: "warn", text: r.message });
      }
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      scanFeedback("error");
      const text =
        e instanceof ApiError && e.code === "rejected_unknown"
          ? "This barcode isn’t in our catalogue — nothing was added. Try the catalogue search or ask staff."
          : e instanceof ApiError && e.code === "rejected_invalid"
            ? "That doesn’t look like a valid product barcode. Nothing was added."
            : errorMessage(e);
      setLastResult({ tone: "bad", text });
    },
  });

  const qty = useMutation({
    mutationFn: (v: { productId: string; quantity: number }) =>
      api.put<CustomerState>(`/api/sessions/${state.session.id}/items/${v.productId}`, { quantity: v.quantity }, auth),
    onSuccess: (data) => qc.setQueryData(key, data),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const open = state.discrepancies.filter((d) => ["AWAITING_CUSTOMER", "AWAITING_STAFF", "ESCALATED"].includes(d.state));
  const blocking = open.filter((d) => d.blocking).length;

  return (
    <div className="pb-28">
      <ShopHeader state={state} onEnd={onEnd} />
      <div className="space-y-4 px-4 py-4">
        <VerificationStrip state={state} />

        {open.length > 0 && (
          <section className="space-y-3" aria-label="Items to confirm">
            {open.map((d) => (
              <AlertCard key={d.id} d={d} auth={auth} sessionId={state.session.id} onScanNow={() => { setMode("camera"); setScanning(true); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            ))}
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="flex border-b border-line" role="tablist" aria-label="Add items">
            {(
              [
                { k: "camera", label: "Scan", icon: Camera },
                { k: "manual", label: "Type code", icon: Keyboard },
                { k: "catalogue", label: "Find item", icon: Search },
              ] as const
            ).map(({ k, label, icon: Icon }) => (
              <button
                key={k}
                role="tab"
                aria-selected={mode === k}
                onClick={() => setMode(k)}
                className={cn(
                  "flex flex-1 cursor-pointer items-center justify-center gap-2 border-b-2 py-3 text-[13px] font-medium",
                  mode === k ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          <div className="p-3">
            {mode === "camera" && (
              <>
                <BarcodeScanner active={scanning} onDetected={(code) => scan.mutate({ barcode: code, method: "CAMERA_BARCODE" })} />
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-xs text-subtle">EAN-13 · EAN-8 · UPC-A · UPC-E</p>
                  <Button size="sm" variant="ghost" onClick={() => setScanning((s) => !s)}>
                    {scanning ? "Pause camera" : "Resume camera"}
                  </Button>
                </div>
              </>
            )}
            {mode === "manual" && <ManualEntry onSubmit={(code) => scan.mutate({ barcode: code, method: "MANUAL_ENTRY" })} loading={scan.isPending} />}
            {mode === "catalogue" && <CataloguePicker onPick={(code) => scan.mutate({ barcode: code, method: "CATALOGUE_SELECT" })} loading={scan.isPending} />}
            {lastResult && (
              <p
                role="status"
                className={cn(
                  "mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] animate-fade-in",
                  lastResult.tone === "ok" && "border-ok/30 bg-ok/10 text-ok",
                  lastResult.tone === "warn" && "border-warn/30 bg-warn/10 text-warn",
                  lastResult.tone === "bad" && "border-bad/30 bg-bad/10 text-bad",
                )}
              >
                {lastResult.tone === "ok" ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
                {lastResult.text}
              </p>
            )}
          </div>
        </section>

        <section className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">Your cart</h2>
            <span className="text-xs text-muted">{state.item_count} item{state.item_count === 1 ? "" : "s"}</span>
          </div>
          {state.lines.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <ShoppingBag className="mx-auto size-6 text-subtle" />
              <p className="mt-2 text-sm text-fg">Your cart is empty</p>
              <p className="mt-1 text-xs text-muted">Scan a product barcode to add it.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line/70">
              {state.lines.map((l) => (
                <li key={l.product.id} className="flex items-center gap-3 px-4 py-3">
                  <ProductThumb product={l.product} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-fg">{l.product.name}</p>
                    <p className="num text-xs text-muted">
                      {formatINR(l.unit_price_paise)} · <span className="font-mono">{l.product.sku}</span>
                    </p>
                    <p className="num mt-0.5 text-[13px] font-semibold text-fg">{formatINR(l.line_total_paise)}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-line bg-surface-2 p-0.5">
                    <button
                      className="grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40"
                      onClick={() => qty.mutate({ productId: l.product.id, quantity: l.quantity - 1 })}
                      disabled={qty.isPending}
                      aria-label={l.quantity === 1 ? `Remove ${l.product.name}` : `Decrease ${l.product.name}`}
                    >
                      {l.quantity === 1 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
                    </button>
                    <span className="num w-6 text-center text-sm font-semibold" aria-label="Quantity">
                      {l.quantity}
                    </span>
                    <button
                      className="grid size-8 cursor-pointer place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-fg disabled:opacity-40"
                      onClick={() => qty.mutate({ productId: l.product.id, quantity: l.quantity + 1 })}
                      disabled={qty.isPending || l.quantity >= 50}
                      aria-label={`Increase ${l.product.name}`}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur-md" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              Total ({state.item_count} item{state.item_count === 1 ? "" : "s"})
            </p>
            <p className="num text-xl font-semibold text-fg">{formatINR(state.subtotal_paise)}</p>
          </div>
          <Button variant="primary" size="lg" onClick={onCheckout} disabled={state.item_count === 0}>
            {blocking ? <Lock /> : <Receipt />} Checkout
          </Button>
        </div>
      </div>
    </div>
  );
}

function VerificationStrip({ state }: { state: CustomerState }) {
  const v = state.verification;
  const total = Math.max(1, v.accepted_units);
  const label =
    v.status === "NEEDS_ATTENTION"
      ? "Please review the item(s) below"
      : v.status === "VERIFYING"
        ? "Verifying recent shelf activity…"
        : "Your cart looks good";
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        v.status === "NEEDS_ATTENTION" ? "border-warn/30 bg-warn/[0.06]" : v.status === "VERIFYING" ? "border-accent/30 bg-accent/[0.05]" : "border-ok/25 bg-ok/[0.05]",
      )}
    >
      <div className="flex items-center gap-2">
        {v.status === "NEEDS_ATTENTION" ? (
          <TriangleAlert className="size-4 text-warn" />
        ) : v.status === "VERIFYING" ? (
          <Loader2 className="size-4 animate-spin text-accent" />
        ) : (
          <BadgeCheck className="size-4 text-ok" />
        )}
        <p className="text-[13px] font-medium text-fg">{label}</p>
      </div>
      <div className="mt-2.5 flex items-center gap-3">
        <Meter value={v.accepted_units ? v.visually_verified_units / total : 0} tone="ok" />
        <span className="num shrink-0 text-xs text-muted">
          {v.visually_verified_units}/{v.accepted_units} seen by camera
        </span>
      </div>
      {v.camera_gap_open && <p className="mt-2 text-xs text-muted">The shelf camera is briefly offline — that’s okay, keep shopping.</p>}
    </div>
  );
}

const OPTION_LABEL: Record<string, (d: Discrepancy) => string> = {
  ADD_TO_CART: (d) => `Yes, add ${d.observed_product?.name ?? "it"}`,
  PUT_BACK: () => "I put it back",
  REPLACE_ITEM: (d) => `I have ${d.observed_product?.name ?? "the other item"}`,
  KEEP_SCANNED: (d) => `I have ${d.scanned_product?.name ?? "what I scanned"}`,
  KEEP_BOTH: () => "Yes, I have two",
  REMOVE_EXTRA: () => "No, remove the extra one",
  SCAN_NOW: () => "Scan an item now",
  CONFIRM_NOTHING_EXTRA: () => "Everything is scanned",
  REMOVE_RETURNED: () => "Remove it from my cart",
  KEEP_ITEM: () => "Keep it",
  REQUEST_STAFF: () => "Ask a staff member",
};

function AlertCard({
  d,
  auth,
  sessionId,
  onScanNow,
}: {
  d: Discrepancy;
  auth: { sessionToken: string };
  sessionId: string;
  onScanNow: () => void;
}) {
  const qc = useQueryClient();
  const respond = useMutation({
    mutationFn: (option: string) => api.post<Discrepancy>(`/api/discrepancies/${d.id}/customer-resolution`, { option }, auth),
    onSuccess: (r) => {
      toast.success(r.state === "RESOLVED" ? "Thanks — your cart is updated." : "A staff member has been notified.");
      qc.invalidateQueries({ queryKey: ["customer-state", sessionId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (d.state !== "AWAITING_CUSTOMER") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/[0.06] px-4 py-3">
        <UserRound className="mt-0.5 size-5 shrink-0 text-info" />
        <div>
          <p className="text-[13px] font-semibold text-fg">A team member will help shortly</p>
          <p className="mt-0.5 text-[13px] text-muted">{d.customer_message}</p>
          {d.state === "ESCALATED" && <p className="mt-1 text-xs text-subtle">A supervisor is reviewing this. Thank you for your patience.</p>}
        </div>
      </div>
    );
  }

  const primary = new Set(["ADD_TO_CART", "REPLACE_ITEM", "KEEP_BOTH", "CONFIRM_NOTHING_EXTRA", "REMOVE_RETURNED"]);
  return (
    <div className={cn("rounded-xl border px-4 py-3 animate-slide-up", d.blocking ? "border-warn/40 bg-warn/[0.07]" : "border-line-strong bg-surface-2")}>
      <p className="flex items-center gap-2 text-[13px] font-semibold text-fg">
        <TriangleAlert className={cn("size-4", d.blocking ? "text-warn" : "text-muted")} />
        {d.blocking ? "Quick check needed" : "Just so you know"}
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-fg">{d.customer_message}</p>
      {(d.observed_product || d.scanned_product) && d.kind === "WRONG_PRODUCT" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            { label: "You scanned", p: d.scanned_product },
            { label: "Camera saw", p: d.observed_product },
          ].map(({ label, p }) =>
            p ? (
              <div key={label} className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-2">
                <ProductThumb product={p} className="size-9" />
                <div className="min-w-0">
                  <p className="text-[11px] text-subtle">{label}</p>
                  <p className="truncate text-xs font-medium text-fg">{p.name}</p>
                  <p className="num text-xs text-muted">{formatINR(p.price_paise)}</p>
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {d.customer_options.map((o) => (
          <Button
            key={o}
            variant={primary.has(o) ? "primary" : o === "REQUEST_STAFF" ? "ghost" : "secondary"}
            size="lg"
            className="w-full justify-center"
            loading={respond.isPending && respond.variables === o}
            disabled={respond.isPending}
            onClick={() => (o === "SCAN_NOW" ? onScanNow() : respond.mutate(o))}
          >
            {OPTION_LABEL[o]?.(d) ?? o}
          </Button>
        ))}
      </div>
      {d.is_simulated && <p className="mt-2 text-[11px] text-sim">Triggered by a simulated demo event.</p>}
    </div>
  );
}

function ManualEntry({ onSubmit, loading }: { onSubmit: (code: string) => void; loading: boolean }) {
  const [code, setCode] = useState("");
  const valid = /^\d{8}$|^\d{12,13}$/.test(code);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) {
          onSubmit(code);
          setCode("");
        }
      }}
      className="space-y-2"
    >
      <label htmlFor="manual" className="text-[13px] text-muted">
        Type the digits under the barcode
      </label>
      <div className="flex gap-2">
        <Input id="manual" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 13))} placeholder="e.g. 8901001000018" className="h-11 font-mono text-base" />
        <Button type="submit" variant="primary" size="lg" disabled={!valid} loading={loading}>
          Add
        </Button>
      </div>
      <p className="text-xs text-subtle">8, 12 or 13 digits. Unknown codes are never added to your cart.</p>
    </form>
  );
}

function CataloguePicker({ onPick, loading }: { onPick: (barcode: string) => void; loading: boolean }) {
  const [term, setTerm] = useState("");
  const products = useProducts({ q: term || undefined });
  return (
    <div className="space-y-2">
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-11" />
      <p className="text-xs text-subtle">Use this if a barcode won’t scan. Selected items are recorded as catalogue selections.</p>
      <ul className="max-h-72 divide-y divide-line/60 overflow-y-auto rounded-lg border border-line">
        {products.data?.map((p) => (
          <li key={p.id}>
            <button className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-50" onClick={() => onPick(p.barcode)} disabled={loading}>
              <ProductThumb product={p} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-fg">{p.name}</p>
                <p className="text-xs text-subtle">{p.category}</p>
              </div>
              <span className="num text-[13px] font-semibold text-fg">{formatINR(p.price_paise)}</span>
              <Plus className="size-4 text-accent" />
            </button>
          </li>
        ))}
        {products.data?.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No matching products.</li>}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- Checkout */

function CheckoutView({ state, auth, onBack }: { state: CustomerState; auth: { sessionToken: string }; onBack: () => void }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["customer-state", state.session.id, "preview"],
    queryFn: () => api.get<CheckoutPreview>(`/api/sessions/${state.session.id}/checkout/preview`, auth),
  });
  const [denied, setDenied] = useState<Blocker[] | null>(null);

  const authorize = useMutation({
    mutationFn: () => api.post<CheckoutRecord>(`/api/sessions/${state.session.id}/checkout`, undefined, auth),
    onSuccess: () => {
      scanFeedback("ok");
      qc.invalidateQueries({ queryKey: ["customer-state", state.session.id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "checkout_blocked") {
        setDenied((e.details.blockers as Blocker[]) ?? []);
        qc.invalidateQueries({ queryKey: ["customer-state", state.session.id] });
      } else toast.error(errorMessage(e));
    },
  });

  const p = preview.data;
  const blockers = denied ?? p?.blockers ?? [];

  return (
    <div className="pb-10">
      <ShopHeader state={state} />
      <div className="space-y-4 px-4 py-4">
        <button onClick={onBack} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Back to cart
        </button>
        <h1 className="text-xl font-semibold text-fg">Review & checkout</h1>
        {!p ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            {blockers.length > 0 && (
              <div className="rounded-xl border border-warn/40 bg-warn/[0.07] p-4" role="alert">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-fg">
                  <Lock className="size-4 text-warn" /> A few checks are needed before you can leave
                </p>
                <ul className="mt-2 space-y-2">
                  {blockers.map((b, i) => (
                    <li key={i} className="text-[13px]">
                      <p className="text-fg">{b.message}</p>
                      <p className="text-xs text-muted">{b.action}</p>
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" className="mt-3 w-full" onClick={onBack}>
                  Go to my cart to resolve
                </Button>
              </div>
            )}
            {p.warnings.map((w, i) => (
              <p key={i} className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[13px] text-muted">
                {w}
              </p>
            ))}
            <Bill lines={p.lines.map((l) => ({ name: l.product.name, quantity: l.quantity, unit: l.unit_price_paise, total: l.line_total_paise }))} total={p.total_paise} count={p.item_count} />
            <Button
              variant="primary"
              size="xl"
              className="w-full"
              disabled={blockers.length > 0 || p.item_count === 0}
              loading={authorize.isPending}
              onClick={() => {
                setDenied(null);
                authorize.mutate();
              }}
            >
              <ShieldCheck /> Pay {formatINR(p.total_paise)} · simulated
            </Button>
            <p className="text-center text-xs text-subtle">
              Prototype authorization — no real payment is taken. The server re-checks every rule before approving.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Bill({ lines, total, count }: { lines: { name: string; quantity: number; unit: number; total: number }[]; total: number; count: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-dashed border-line-strong px-4 py-3">
        <p className="label-eyebrow">Itemised bill</p>
      </div>
      <ul className="divide-y divide-line/60 px-4">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-2.5 text-[13px]">
            <div>
              <p className="text-fg">{l.name}</p>
              <p className="num text-xs text-muted">
                {l.quantity} × {formatINR(l.unit)}
              </p>
            </div>
            <span className="num font-medium text-fg">{formatINR(l.total)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-dashed border-line-strong bg-surface-2/60 px-4 py-3">
        <span className="text-[13px] text-muted">
          Total · {count} item{count === 1 ? "" : "s"} <span className="text-subtle">(MRP incl. taxes)</span>
        </span>
        <span className="num text-lg font-semibold text-fg">{formatINR(total)}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Receipt */

function ReceiptView({ state, auth, onEnd }: { state: CustomerState; auth: { sessionToken: string }; onEnd: () => void }) {
  const qc = useQueryClient();
  const r = state.checkout;
  const exit = useMutation({
    mutationFn: () => api.post<CheckoutRecord>(`/api/sessions/${state.session.id}/exit`, undefined, auth),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-state", state.session.id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!r) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-fg">This session was {state.session.status.toLowerCase().replace("_", " ")}.</p>
        <Button variant="primary" onClick={onEnd}>
          Start a new session
        </Button>
      </div>
    );
  }
  const exited = !!r.exited_at;
  return (
    <div className="pb-10">
      <ShopHeader state={state} />
      <div className="space-y-4 px-4 py-5">
        <div className="text-center">
          <div className={cn("mx-auto grid size-16 place-items-center rounded-full", exited ? "bg-info/15 text-info" : "bg-ok/15 text-ok")}>
            {exited ? <DoorOpen className="size-8" /> : <CircleCheck className="size-8" />}
          </div>
          <h1 className="mt-3 text-2xl font-semibold text-fg">{exited ? "Thanks for shopping!" : "You’re all set"}</h1>
          <p className="mt-1 text-[13px] text-muted">
            {exited ? `Exit confirmed ${formatDateTime(r.exited_at)} (simulated gate).` : "Checkout authorized. Show this code at the exit."}
          </p>
        </div>
        {!exited && (
          <div className="card mx-auto max-w-xs px-4 py-4 text-center">
            <p className="label-eyebrow">Exit code</p>
            <p className="mt-1 font-mono text-4xl font-bold tracking-[0.25em] text-accent">{r.exit_code}</p>
          </div>
        )}
        <Bill lines={r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit_price_paise, total: l.line_total_paise }))} total={r.total_paise} count={r.item_count} />
        <div className="card px-4 py-3 text-xs text-muted">
          <div className="flex justify-between">
            <span>Receipt</span>
            <span className="font-mono text-fg">{r.id}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Payment</span>
            <Badge tone="sim">{r.payment_mode}</Badge>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Authorized</span>
            <span className="text-fg">{formatDateTime(r.authorized_at)}</span>
          </div>
        </div>
        {!exited ? (
          <Button variant="primary" size="xl" className="w-full" loading={exit.isPending} onClick={() => exit.mutate()}>
            <DoorOpen /> Simulate exit gate
          </Button>
        ) : (
          <Button variant="secondary" size="lg" className="w-full" onClick={onEnd}>
            Start a new shopping session
          </Button>
        )}
      </div>
    </div>
  );
}
