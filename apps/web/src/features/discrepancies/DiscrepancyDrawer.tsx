import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Ban, CircleCheck, MessageSquareShare, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfidencePair, FactorList } from "@/components/status/confidence";
import { KindLabel, SourceBadge, StateBadge } from "@/components/status/badges";
import { ProductThumb } from "@/components/status/ProductThumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, NativeSelect, Textarea } from "@/components/ui/form";
import { ErrorState, KV, Skeleton } from "@/components/ui/misc";
import { useDiscrepancy } from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatINR } from "@/lib/format";
import { humanize } from "@/lib/utils";
import type { DiscrepancyDetail } from "@/types/api";

const OPEN = new Set(["AWAITING_CUSTOMER", "AWAITING_STAFF", "ESCALATED"]);

export function DiscrepancyDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useDiscrepancy(id);
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        side="right"
        title={q.data ? q.data.kind_label : "Discrepancy"}
        description={id ? `${id} · evidence review` : undefined}
      >
        {q.isLoading && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && <Review d={q.data} />}
      </DialogContent>
    </Dialog>
  );
}

function Review({ d }: { d: DiscrepancyDetail }) {
  const isOpen = OPEN.has(d.state);
  const [showFactors, setShowFactors] = useState(false);
  return (
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={d.state} />
        <SourceBadge source={d.source} isSimulated={d.is_simulated} />
        {isOpen && (d.blocking ? <Badge tone="bad">Blocks checkout</Badge> : <Badge tone="neutral">Advisory</Badge>)}
      </div>

      <div className="rounded-lg border border-warn/20 bg-warn/5 px-4 py-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold text-warn">
          <TriangleAlert className="size-4" /> Needs verification — not a finding of wrongdoing
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-fg">{d.explanation}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KV label="Session">
          <Link to={`/sessions/${d.session_id}`} className="font-mono text-accent hover:underline">
            {d.session_id}
          </Link>
        </KV>
        <KV label="Raised">{formatDateTime(d.created_at)}</KV>
        <KV label="Category">
          <KindLabel kind={d.kind} />
        </KV>
      </dl>

      <section>
        <h3 className="label-eyebrow mb-2">Evidence</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <EvidenceTile title="Associated scan" product={d.scanned_product} meta={d.scan_event ? `${d.scan_event.id} · ${humanize(d.scan_event.status)}` : "No scan associated"} />
          <EvidenceTile
            title="Observed candidate"
            product={d.observed_product}
            meta={
              d.vision_event
                ? `${d.vision_event.id} · ${humanize(d.vision_event.event_type)} · ${d.vision_event.recognition_level}-level`
                : "No single product identified"
            }
          />
        </div>
        {d.vision_event?.uncertainty_reason && (
          <p className="mt-2 text-xs text-warn">Uncertainty: {d.vision_event.uncertainty_reason}</p>
        )}
      </section>

      {(d.model_confidence != null || d.reconciliation_confidence != null) && (
        <section className="space-y-2">
          <ConfidencePair model={d.model_confidence} reconciliation={d.reconciliation_confidence} />
          {d.reconciliation && d.reconciliation.factors.length > 0 && (
            <button
              onClick={() => setShowFactors((v) => !v)}
              className="cursor-pointer text-xs font-medium text-accent hover:underline"
              aria-expanded={showFactors}
            >
              {showFactors ? "Hide" : "Why this score?"}
            </button>
          )}
          {showFactors && d.reconciliation && <FactorList factors={d.reconciliation.factors} />}
        </section>
      )}

      <dl className="space-y-2 rounded-lg border border-line bg-surface-2/50 p-3 text-[13px]">
        <div>
          <dt className="label-eyebrow">Next step</dt>
          <dd className="mt-0.5 text-fg">{d.recommended_action}</dd>
        </div>
        <div>
          <dt className="label-eyebrow">Customer sees</dt>
          <dd className="mt-0.5 italic text-muted">“{d.customer_message}”</dd>
        </div>
      </dl>

      {isOpen ? (
        <StaffActions d={d} />
      ) : (
        <div className="rounded-lg border border-ok/25 bg-ok/5 px-4 py-3 text-[13px]">
          <p className="font-semibold text-ok">
            {d.state === "DISMISSED" ? "Dismissed" : "Resolved"} · {humanize(d.resolution_code)}
          </p>
          {d.resolution_reason && <p className="mt-1 text-fg">{d.resolution_reason}</p>}
          <p className="mt-1 text-xs text-subtle">
            by {d.resolved_by} · {formatDateTime(d.resolved_at)}
          </p>
        </div>
      )}

      <section>
        <h3 className="label-eyebrow mb-2">Resolution history</h3>
        {d.actions.length === 0 ? (
          <p className="text-[13px] text-muted">No actions yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-4">
            {d.actions.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-surface bg-accent" />
                <p className="text-[13px] font-medium text-fg">
                  {humanize(a.action)}{" "}
                  <span className="font-normal text-subtle">
                    by {humanize(a.actor_type)} {a.actor_id ?? ""}
                  </span>
                </p>
                <p className="flex items-center gap-1 text-xs text-muted">
                  {humanize(a.state_before)} <ArrowRight className="size-3" /> {humanize(a.state_after)} ·{" "}
                  {formatDateTime(a.created_at)}
                </p>
                {a.reason && <p className="mt-0.5 text-xs text-fg">“{a.reason}”</p>}
                {a.cart_delta.length > 0 && (
                  <p className="mt-0.5 text-xs text-accent">
                    Cart:{" "}
                    {a.cart_delta
                      .map((c) => `${c.qty_delta > 0 ? "+" : ""}${c.qty_delta} ${c.name ?? c.product_id}`)
                      .join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function EvidenceTile({ title, product, meta }: { title: string; product: DiscrepancyDetail["observed_product"]; meta: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3">
      <p className="label-eyebrow">{title}</p>
      {product ? (
        <div className="mt-2 flex items-center gap-3">
          <ProductThumb product={product} />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-fg">{product.name}</p>
            <p className="num text-xs text-muted">
              {formatINR(product.price_paise)} · {product.sku}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted">—</p>
      )}
      <p className="mt-2 truncate font-mono text-[11px] text-subtle">{meta}</p>
    </div>
  );
}

type Action = "RESOLVE" | "DISMISS" | "REQUEST_CUSTOMER" | "ESCALATE";

function StaffActions({ d }: { d: DiscrepancyDetail }) {
  const [action, setAction] = useState<Action>("RESOLVE");
  const [reason, setReason] = useState("");
  const [correction, setCorrection] = useState("NONE");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.post(`/api/discrepancies/${d.id}/staff-resolution`, { action, reason: reason || null, correction }),
    onSuccess: () => {
      toast.success(
        action === "DISMISS" ? "Dismissed as false positive" : action === "ESCALATE" ? "Escalated" : action === "REQUEST_CUSTOMER" ? "Customer asked to confirm" : "Resolved",
      );
      setReason("");
      qc.invalidateQueries({ queryKey: ["discrepancies"] });
      qc.invalidateQueries({ queryKey: ["session", d.session_id] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const needsReason = action !== "REQUEST_CUSTOMER";
  const corrections = [
    { v: "NONE", label: "No cart change (verified as-is)" },
    ...(d.observed_product ? [{ v: "ADD_OBSERVED", label: `Add ${d.observed_product.name}` }] : []),
    ...(d.observed_product && d.scan_event
      ? [{ v: "REPLACE_WITH_OBSERVED", label: `Replace scanned item with ${d.observed_product.name}` }]
      : []),
    ...(d.scan_event ? [{ v: "REMOVE_SCANNED", label: "Remove the associated scanned unit" }] : []),
  ];

  const submit = () => {
    setError(null);
    if (needsReason && reason.trim().length < 5) {
      setError("Please document a reason (at least 5 characters). It is stored in the audit trail.");
      return;
    }
    mutation.mutate();
  };

  const buttons: { a: Action; label: string; icon: React.ReactNode }[] = [
    { a: "RESOLVE", label: "Resolve", icon: <CircleCheck /> },
    { a: "DISMISS", label: "Dismiss false positive", icon: <Ban /> },
    { a: "REQUEST_CUSTOMER", label: "Ask customer", icon: <MessageSquareShare /> },
    { a: "ESCALATE", label: "Escalate", icon: <ShieldAlert /> },
  ];

  return (
    <section className="rounded-lg border border-accent/25 bg-accent/[0.03] p-4">
      <h3 className="text-sm font-semibold text-fg">Staff decision</h3>
      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Action">
        {buttons.map((b) => (
          <button
            key={b.a}
            role="radio"
            aria-checked={action === b.a}
            onClick={() => setAction(b.a)}
            className={
              "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-left text-[13px] font-medium transition-colors [&_svg]:size-4 " +
              (action === b.a ? "border-accent/60 bg-accent/10 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg")
            }
          >
            {b.icon}
            {b.label}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        {action === "RESOLVE" && (
          <Field label="Cart correction" htmlFor="correction" hint="Prices always come from the catalogue.">
            <NativeSelect id="correction" value={correction} onChange={(e) => setCorrection(e.target.value)}>
              {corrections.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {action === "DISMISS" && (
          <p className="text-xs text-muted">Dismissing never changes the cart. Explain why the observation was a false positive.</p>
        )}
        <Field label={needsReason ? "Reason (required)" : "Note (optional)"} htmlFor="reason" error={error}>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              action === "DISMISS"
                ? "e.g. Reviewed shelf: item count unchanged; shopper only inspected the label."
                : "e.g. Basket checked at exit."
            }
            aria-invalid={!!error}
          />
        </Field>
        <Button variant="primary" className="w-full" loading={mutation.isPending} onClick={submit}>
          Confirm decision
        </Button>
      </div>
    </section>
  );
}
