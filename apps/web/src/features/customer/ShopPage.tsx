import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  Check,
  CircleCheck,
  DoorOpen,
  Hourglass,
  Lock,
  LogOut,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { LiveProvider, useLive } from "@/app/live-context";
import { Logo } from "@/components/brand/Logo";
import { ProductThumb } from "@/components/status/ProductThumb";
import { ServerNotice, useServerState } from "@/components/status/ServerNotice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/misc";
import { useCustomerState, useProducts } from "@/hooks/queries";
import { ApiError, api, errorMessage } from "@/lib/api";
import { shopStore, type ShopCredentials } from "@/lib/auth";
import { formatINR, formatDateTime } from "@/lib/format";
import { cn, uid } from "@/lib/utils";
import type { Blocker, CheckoutPreview, CheckoutRecord, CustomerState, Discrepancy, PendingPickup, ScanResponse } from "@/types/api";
import { BarcodeScanner } from "./BarcodeScanner";
import { scanFeedback } from "./feedback";

type SessionAuth = { sessionToken: string };

const OPEN_STATES = ["AWAITING_CUSTOMER", "AWAITING_STAFF", "ESCALATED"];

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
    <main className="mx-auto min-h-dvh max-w-xl">
      {creds ? (
        <LiveProvider query={`session_id=${encodeURIComponent(creds.sessionId)}&session_token=${encodeURIComponent(creds.token)}`}>
          <ShopSession creds={creds} onEnd={end} />
        </LiveProvider>
      ) : (
        <Welcome onStart={setCreds} />
      )}
    </main>
  );
}

/* ---------------------------------------------------------------- Welcome */

function Welcome({ onStart }: { onStart: (c: ShopCredentials) => void }) {
  const server = useServerState();
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
    <div className="flex min-h-dvh flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <Logo />
      {/* Anchored from the top so a late font swap or status notice never moves the headline. */}
      <div className="flex-1 pb-10 pt-[16vh]">
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-fg">
          Scan.
          <br />
          Pick.
          <br />
          Go.
        </h1>
        <p className="mt-5 max-w-sm text-[17px] leading-relaxed text-muted">
          Scan items with your phone as you shop and skip the queue. If something doesn’t add up, we just ask.
        </p>
      </div>
      <div className="space-y-3">
        <ServerNotice state={server.state} onRetry={server.retry} />
        <Button variant="primary" size="xl" className="w-full" loading={start.isPending} onClick={() => start.mutate()}>
          <ShoppingBag /> Start shopping
        </Button>
        <p className="text-center text-xs text-subtle">
          No account needed. Prototype: payment is simulated.{" "}
          <Link to="/login" className="tap inline-block py-2 text-muted underline-offset-4 hover:text-fg hover:underline">
            Staff sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Session */

type View = "shop" | "checkout";

function ShopSession({ creds, onEnd }: { creds: ShopCredentials; onEnd: () => void }) {
  const q = useCustomerState(creds.sessionId, creds.token);
  const [view, setView] = useState<View>("shop");
  const auth = useMemo(() => ({ sessionToken: creds.token }), [creds.token]);
  const gone = q.error instanceof ApiError && (q.error.status === 401 || q.error.status === 404);

  useEffect(() => {
    if (gone) {
      toast.error("This shopping session is no longer available.");
      onEnd();
    }
  }, [gone, onEnd]);

  if (q.isError && !gone && !q.data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <TriangleAlert className="size-7 text-warn" />
        <p className="text-[15px] text-fg">{errorMessage(q.error)}</p>
        <Button variant="outline" size="lg" onClick={() => q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="space-y-4 p-4" aria-busy="true" aria-label="Loading your cart">
        <Skeleton className="h-10" />
        <Skeleton className="h-20" />
        <Skeleton className="h-56" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const s = q.data;
  if (s.checkout || s.session.status !== "ACTIVE") return <ReceiptView state={s} auth={auth} onEnd={onEnd} />;
  if (view === "checkout") return <CheckoutView state={s} auth={auth} onBack={() => setView("shop")} />;
  return <ShopView state={s} auth={auth} onCheckout={() => setView("checkout")} onEnd={onEnd} />;
}

function ShopHeader({ state, onLeave }: { state: CustomerState; onLeave?: () => void }) {
  const { status } = useLive();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center gap-3 px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-fg">KORTEX Demo Store</p>
          <p className="flex items-center gap-1.5 truncate text-xs text-subtle">
            <span className={cn("size-1.5 shrink-0 rounded-full", status === "open" ? "bg-ok" : "bg-warn")} aria-hidden />
            {status === "open" ? state.session.customer_label : "Reconnecting…"}
            {state.session.is_demo && " · demo session"}
          </p>
        </div>
        {onLeave && (
          <button onClick={onLeave} className="-mr-2 grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg" aria-label="End this shopping session">
            <LogOut className="size-[18px]" />
          </button>
        )}
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- Shopping */

type AddMode = "camera" | "manual" | "catalogue";

function ShopView({ state, auth, onCheckout, onEnd }: { state: CustomerState; auth: SessionAuth; onCheckout: () => void; onEnd: () => void }) {
  const qc = useQueryClient();
  const [cameraOn, setCameraOn] = useState(false);
  const [mode, setMode] = useState<AddMode>("camera");
  const [leaving, setLeaving] = useState(false);
  const [lastResult, setLastResult] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const key = ["customer-state", state.session.id];

  const scan = useMutation({
    mutationFn: (v: { barcode: string; method: string }) =>
      api.post<ScanResponse>(`/api/sessions/${state.session.id}/scans`, { ...v, client_scan_id: uid("scan") }, auth),
    onSuccess: (r) => {
      const flagged = r.status !== "ACCEPTED" || !!r.discrepancy_id;
      scanFeedback(flagged ? "warn" : "ok");
      setLastResult({ tone: flagged ? "warn" : "ok", text: r.discrepancy_id ? `${r.message} Please confirm the quantity above.` : r.message });
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => {
      scanFeedback("error");
      const text =
        e instanceof ApiError && e.code === "rejected_unknown"
          ? "That barcode isn’t in this store’s catalogue. Nothing was added."
          : e instanceof ApiError && e.code === "rejected_invalid"
            ? "That doesn’t look like a product barcode. Nothing was added."
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

  const leave = useMutation({
    mutationFn: () => api.post(`/api/sessions/${state.session.id}/cancel`, undefined, auth),
    onSettled: onEnd,
  });

  const open = state.discrepancies.filter((d) => OPEN_STATES.includes(d.state));
  const blocking = open.filter((d) => d.blocking).length;
  const pending = state.pending_pickups ?? [];

  // A new alert must never appear off screen.
  const openCount = open.length;
  useEffect(() => {
    if (openCount > 0) window.scrollTo({ top: 0 });
  }, [openCount]);

  return (
    <div className="pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <ShopHeader state={state} onLeave={() => setLeaving(true)} />
      <div className="space-y-5 px-4 py-4">
        <StatusBanner state={state} pending={pending} />

        {open.length > 0 && (
          <section className="space-y-3" aria-label="Items to confirm">
            {open.map((d) => (
              <AlertCard
                key={d.id}
                d={d}
                auth={auth}
                sessionId={state.session.id}
                onScanNow={() => {
                  setMode("camera");
                  setCameraOn(true);
                  window.scrollTo({ top: 0 });
                }}
              />
            ))}
          </section>
        )}

        <section aria-label="Add items">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="How to add an item">
            {(
              [
                { k: "camera", label: "Scan" },
                { k: "manual", label: "Type code" },
                { k: "catalogue", label: "Browse" },
              ] as const
            ).map(({ k, label }) => (
              <button
                key={k}
                role="tab"
                aria-selected={mode === k}
                onClick={() => setMode(k)}
                className={cn("min-h-11 rounded-lg text-sm font-medium transition-colors", mode === k ? "bg-canvas text-fg" : "text-muted hover:text-fg")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {mode === "camera" &&
              (cameraOn ? (
                <>
                  <BarcodeScanner active onDetected={(code) => scan.mutate({ barcode: code, method: "CAMERA_BARCODE" })} />
                  <button onClick={() => setCameraOn(false)} className="mt-1 min-h-11 w-full text-[13px] text-muted hover:text-fg">
                    Turn camera off
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setCameraOn(true)}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-9 text-center hover:bg-surface"
                >
                  <Camera className="size-7 text-fg" />
                  <span className="text-[15px] font-medium text-fg">Turn on camera to scan</span>
                  <span className="text-[13px] text-muted">Point it at the barcode on the product.</span>
                </button>
              ))}
            {mode === "manual" && <ManualEntry onSubmit={(code) => scan.mutate({ barcode: code, method: "MANUAL_ENTRY" })} loading={scan.isPending} />}
            {mode === "catalogue" && <CataloguePicker onPick={(code) => scan.mutate({ barcode: code, method: "CATALOGUE_SELECT" })} loading={scan.isPending} />}
            {lastResult && (
              <p
                role="status"
                className={cn(
                  "mt-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm",
                  lastResult.tone === "ok" && "bg-ok/10 text-ok",
                  lastResult.tone === "warn" && "bg-warn/10 text-warn",
                  lastResult.tone === "bad" && "bg-bad/10 text-bad",
                )}
              >
                {lastResult.tone === "ok" ? <CircleCheck className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
                {lastResult.text}
              </p>
            )}
          </div>
        </section>

        <section aria-label="Your cart">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold text-fg">Your cart</h2>
            <span className="num text-[13px] text-subtle">
              {state.item_count} item{state.item_count === 1 ? "" : "s"}
            </span>
          </div>
          {state.lines.length === 0 ? (
            <div className="mt-2 rounded-xl border border-line px-6 py-9 text-center">
              <p className="text-[15px] text-fg">Your cart is empty</p>
              <p className="mt-1 text-[13px] text-muted">Scan a barcode to add your first item.</p>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {state.lines.map((l) => (
                <li key={l.product.id} className="flex items-center gap-3 px-3 py-3">
                  <ProductThumb product={l.product} className="size-12" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-fg">{l.product.name}</p>
                    <p className="num text-[13px] text-muted">
                      {formatINR(l.line_total_paise)}
                      {l.quantity > 1 && <span className="text-subtle"> · {formatINR(l.unit_price_paise)} each</span>}
                    </p>
                  </div>
                  <div className="flex items-center">
                    <button
                      className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
                      onClick={() => qty.mutate({ productId: l.product.id, quantity: l.quantity - 1 })}
                      disabled={qty.isPending}
                      aria-label={l.quantity === 1 ? `Remove ${l.product.name}` : `Decrease ${l.product.name}`}
                    >
                      {l.quantity === 1 ? <Trash2 className="size-4" /> : <Minus className="size-4" />}
                    </button>
                    <span className="num w-6 text-center text-[15px] font-semibold" aria-label="Quantity">
                      {l.quantity}
                    </span>
                    <button
                      className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
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

        {state.simulated_shelf && <SimulatedShelf state={state} auth={auth} pending={pending} />}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-subtle">Total</p>
            <p className="num text-xl font-semibold text-fg">{formatINR(state.subtotal_paise)}</p>
          </div>
          <Button variant="primary" size="lg" className="h-12 px-6" onClick={onCheckout} disabled={state.item_count === 0}>
            {blocking > 0 && <Lock />} Checkout
          </Button>
        </div>
      </div>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent title="End this shopping session?" description="Your cart will be cleared and nothing is charged.">
          <DialogFooter className="border-t-0">
            <Button variant="ghost" size="lg" onClick={() => setLeaving(false)}>
              Keep shopping
            </Button>
            <Button variant="danger" size="lg" loading={leave.isPending} onClick={() => leave.mutate()}>
              End session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useSecondsLeft(iso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : null;
}

/** One large, unmistakable state: all good, waiting for a scan, or needs a check. */
function StatusBanner({ state, pending }: { state: CustomerState; pending: PendingPickup[] }) {
  const v = state.verification;
  const first = pending[0];
  const seconds = useSecondsLeft(first?.finalize_after);
  if (v.status === "NEEDS_ATTENTION") {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-warn/10 px-4 py-3.5" role="status">
        <TriangleAlert className="size-6 shrink-0 text-warn" />
        <div>
          <p className="text-[15px] font-semibold text-fg">One thing to check</p>
          <p className="text-[13px] text-muted">Answer below and you’re good to go.</p>
        </div>
      </div>
    );
  }
  if (v.status === "VERIFYING" && first) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-surface-2 px-4 py-3.5" role="status">
        <Hourglass className="size-6 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-fg">Scan {first.product_name ?? "the item you picked up"}</p>
          <p className="text-[13px] text-muted">
            The shelf saw a pickup{pending.length > 1 ? ` (${pending.length} items)` : ""}. Scan it to add it to your cart.
          </p>
        </div>
        {seconds != null && <span className="num shrink-0 text-lg font-semibold text-fg">{seconds}s</span>}
      </div>
    );
  }
  if (v.accepted_units === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-ok/10 px-4 py-3.5" role="status">
      <CircleCheck className="size-6 shrink-0 text-ok" />
      <div>
        <p className="text-[15px] font-semibold text-fg">Your cart looks good</p>
        <p className="num text-[13px] text-muted">
          {v.visually_verified_units > 0 ? `${v.visually_verified_units} of ${v.accepted_units} items also seen on the shelf.` : "Nothing needs your attention."}
          {v.camera_gap_open && " The shelf camera is briefly offline; keep shopping."}
        </p>
      </div>
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

const PRIMARY_OPTIONS = new Set(["ADD_TO_CART", "REPLACE_ITEM", "KEEP_BOTH", "CONFIRM_NOTHING_EXTRA", "REMOVE_RETURNED"]);

function AlertCard({ d, auth, sessionId, onScanNow }: { d: Discrepancy; auth: SessionAuth; sessionId: string; onScanNow: () => void }) {
  const qc = useQueryClient();
  const respond = useMutation({
    mutationFn: (option: string) => api.post<Discrepancy>(`/api/discrepancies/${d.id}/customer-resolution`, { option }, auth),
    onSuccess: (r) => {
      toast.success(r.state === "RESOLVED" ? "Thanks, your cart is updated." : "A staff member has been notified.");
      qc.invalidateQueries({ queryKey: ["customer-state", sessionId] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (d.state !== "AWAITING_CUSTOMER") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-line px-4 py-3.5">
        <UserRound className="mt-0.5 size-5 shrink-0 text-muted" />
        <div>
          <p className="text-[15px] font-semibold text-fg">A team member will help shortly</p>
          <p className="mt-0.5 text-sm text-muted">{d.customer_message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border px-4 py-4", d.blocking ? "border-warn/40" : "border-line")}>
      <p className="text-xs font-medium text-subtle">{d.blocking ? "Quick check needed" : "Just so you know"}</p>
      <p className="mt-1 text-[16px] leading-snug text-fg">{d.customer_message}</p>
      {d.kind === "WRONG_PRODUCT" && (d.observed_product || d.scanned_product) && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {[
            { label: "You scanned", p: d.scanned_product },
            { label: "Shelf saw", p: d.observed_product },
          ].map(({ label, p }) =>
            p ? (
              <div key={label} className="min-w-0 rounded-lg bg-surface-2 p-2.5">
                <p className="text-xs text-subtle">{label}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <ProductThumb product={p} className="size-9" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-fg">{p.name}</p>
                    <p className="num text-xs text-muted">{formatINR(p.price_paise)}</p>
                  </div>
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {d.customer_options.map((o) => (
          <Button
            key={o}
            variant={PRIMARY_OPTIONS.has(o) ? "primary" : o === "REQUEST_STAFF" ? "ghost" : "secondary"}
            size="lg"
            className="h-auto min-h-12 w-full whitespace-normal py-2 text-center leading-tight"
            loading={respond.isPending && respond.variables === o}
            disabled={respond.isPending}
            onClick={() => (o === "SCAN_NOW" ? onScanNow() : respond.mutate(o))}
          >
            {OPTION_LABEL[o]?.(d) ?? o}
          </Button>
        ))}
      </div>
      {d.is_simulated && <p className="mt-3 text-xs text-sim">Raised by a simulated shelf event.</p>}
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
    >
      <label htmlFor="manual" className="text-sm text-muted">
        Type the digits under the barcode
      </label>
      <div className="mt-2 flex gap-2">
        <Input
          id="manual"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 13))}
          placeholder="8901001000018"
          className="h-12 font-mono text-base sm:text-base"
        />
        <Button type="submit" variant="primary" size="lg" className="h-12" disabled={!valid} loading={loading}>
          Add
        </Button>
      </div>
      <p className="mt-2 text-xs text-subtle">8, 12 or 13 digits.</p>
    </form>
  );
}

function CataloguePicker({ onPick, loading }: { onPick: (barcode: string) => void; loading: boolean }) {
  const [term, setTerm] = useState("");
  const products = useProducts({ q: term || undefined });
  return (
    <div>
      <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-12 text-base sm:text-base" />
      <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line">
        {!products.data && (
          <li className="p-3">
            <Skeleton className="h-10" />
          </li>
        )}
        {products.data?.items.map((p) => (
          <li key={p.id}>
            <button className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface disabled:opacity-50" onClick={() => onPick(p.barcode)} disabled={loading}>
              <ProductThumb product={p} className="size-10" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-fg">{p.name}</span>
              <span className="num text-sm text-muted">{formatINR(p.price_paise)}</span>
              <Plus className="size-4 text-muted" />
            </button>
          </li>
        ))}
        {products.data?.items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">No matching products.</li>}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------- Simulated shelf */

/**
 * Hosted demos have no shelf camera. This stands in for it: the shopper says
 * what they took off the shelf, and the server treats it exactly like a camera
 * event (stored and shown as SIMULATED).
 */
function SimulatedShelf({ state, auth, pending }: { state: CustomerState; auth: SessionAuth; pending: PendingPickup[] }) {
  const qc = useQueryClient();
  const products = useProducts();
  const act = useMutation({
    mutationFn: (v: { productId: string; type: "PICKUP" | "RETURN" }) =>
      api.post(`/api/sessions/${state.session.id}/shelf-events`, { product_id: v.productId, event_type: v.type }, auth),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-state", state.session.id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const waiting = new Set(pending.map((p) => p.product_id));

  return (
    <section aria-label="Simulated shelf" className="rounded-xl border border-dashed border-line-strong p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-fg">Try the shelf check</h2>
        <Badge tone="sim">Simulated</Badge>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        This demo has no shelf camera. Take an item here, then scan it, or don’t, and see what KORTEX asks.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {!products.data && (
          <li className="py-2">
            <Skeleton className="h-10" />
          </li>
        )}
        {products.data?.items.map((p) => {
          const held = waiting.has(p.id);
          const busy = act.isPending && act.variables?.productId === p.id;
          return (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <ProductThumb product={p} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{p.name}</p>
                {held && <p className="text-xs text-accent">Picked up, waiting for a scan</p>}
              </div>
              <Button
                size="sm"
                variant={held ? "outline" : "secondary"}
                className="h-11 shrink-0 px-3.5"
                loading={busy}
                disabled={act.isPending}
                onClick={() => act.mutate({ productId: p.id, type: held ? "RETURN" : "PICKUP" })}
              >
                {held ? "Put back" : "Pick up"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* --------------------------------------------------------------- Checkout */

function CheckoutView({ state, auth, onBack }: { state: CustomerState; auth: SessionAuth; onBack: () => void }) {
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
    <div className="pb-[max(2rem,env(safe-area-inset-bottom))]">
      <ShopHeader state={state} />
      <div className="space-y-4 px-4 py-3">
        <button onClick={onBack} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Back to cart
        </button>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Checkout</h1>
        {preview.isError ? (
          <div role="alert" className="rounded-xl border border-bad/30 px-4 py-3 text-sm">
            <p className="text-fg">{errorMessage(preview.error)}</p>
            <button onClick={() => preview.refetch()} className="mt-1 min-h-11 font-medium text-fg underline underline-offset-4">
              Try again
            </button>
          </div>
        ) : !p ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            {blockers.length > 0 && (
              <div className="rounded-xl bg-warn/10 p-4" role="alert">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-fg">
                  <Lock className="size-4 shrink-0 text-warn" /> A few checks are needed before you can pay
                </p>
                <ul className="mt-2 space-y-2">
                  {blockers.map((b, i) => (
                    <li key={i} className="text-sm">
                      <p className="text-fg">{b.message}</p>
                      <p className="text-[13px] text-muted">{b.action}</p>
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" size="lg" className="mt-3 h-12 w-full" onClick={onBack}>
                  Go back and resolve
                </Button>
              </div>
            )}
            {p.warnings.map((w, i) => (
              <p key={i} className="rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
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
              Pay {formatINR(p.total_paise)}
            </Button>
            <p className="text-center text-xs text-subtle">Simulated payment. No money is taken in this prototype.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Bill({ lines, total, count }: { lines: { name: string; quantity: number; unit: number; total: number }[]; total: number; count: number }) {
  return (
    <div className="rounded-xl border border-line">
      <ul className="divide-y divide-line px-4">
        {lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="text-fg">{l.name}</p>
              <p className="num text-[13px] text-muted">
                {l.quantity} × {formatINR(l.unit)}
              </p>
            </div>
            <span className="num shrink-0 font-medium text-fg">{formatINR(l.total)}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-line px-4 py-3.5">
        <span className="text-sm text-muted">
          Total · {count} item{count === 1 ? "" : "s"}, taxes included
        </span>
        <span className="num shrink-0 text-xl font-semibold text-fg">{formatINR(total)}</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Receipt */

function ReceiptView({ state, auth, onEnd }: { state: CustomerState; auth: SessionAuth; onEnd: () => void }) {
  const qc = useQueryClient();
  const r = state.checkout;
  const exit = useMutation({
    mutationFn: () => api.post<CheckoutRecord>(`/api/sessions/${state.session.id}/exit`, undefined, auth),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-state", state.session.id] }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!r) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[15px] text-fg">This session has ended.</p>
        <Button variant="primary" size="lg" className="h-12" onClick={onEnd}>
          Start a new session
        </Button>
      </div>
    );
  }
  const exited = !!r.exited_at;
  return (
    <div className="pb-[max(2rem,env(safe-area-inset-bottom))]">
      <ShopHeader state={state} />
      <div className="space-y-5 px-4 py-6">
        <div className="text-center">
          <div className={cn("mx-auto grid size-14 place-items-center rounded-full", exited ? "bg-surface-2 text-fg" : "bg-ok/12 text-ok")}>
            {exited ? <DoorOpen className="size-7" /> : <Check className="size-7" />}
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">{exited ? "Thanks for shopping" : "You’re all set"}</h1>
          <p className="mt-1 text-sm text-muted">{exited ? `You left at ${formatDateTime(r.exited_at)}.` : "Paid. Show this code at the exit gate."}</p>
        </div>
        {!exited && (
          <div className="rounded-xl bg-surface-2 px-4 py-5 text-center">
            <p className="text-xs text-subtle">Exit code</p>
            <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.2em] text-fg">{r.exit_code}</p>
          </div>
        )}
        <Bill lines={r.lines.map((l) => ({ name: l.name, quantity: l.quantity, unit: l.unit_price_paise, total: l.line_total_paise }))} total={r.total_paise} count={r.item_count} />
        <dl className="space-y-1.5 text-[13px] text-muted">
          <div className="flex justify-between gap-3">
            <dt>Receipt</dt>
            <dd className="font-mono text-fg">{r.id}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Payment</dt>
            <dd>
              <Badge tone="sim">Simulated</Badge>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Paid</dt>
            <dd className="text-fg">{formatDateTime(r.authorized_at)}</dd>
          </div>
        </dl>
        {!exited ? (
          <>
            <Button variant="primary" size="xl" className="w-full" loading={exit.isPending} onClick={() => exit.mutate()}>
              <DoorOpen /> Open the exit gate
            </Button>
            <p className="text-center text-xs text-subtle">Simulated gate. There is no physical gate in this prototype.</p>
          </>
        ) : (
          <Button variant="secondary" size="lg" className="h-12 w-full" onClick={onEnd}>
            Start a new session
          </Button>
        )}
      </div>
    </div>
  );
}
