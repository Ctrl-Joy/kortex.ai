import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  CircleCheck,
  FastForward,
  GitCompareArrows,
  History,
  Lock,
  Receipt,
  ScanBarcode,
  ShieldAlert,
  Scale,
} from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";
import { FactorList } from "@/components/status/confidence";
import {
  CheckoutBadge,
  KindLabel,
  SessionStatusBadge,
  SourceBadge,
  StateBadge,
  VerificationBadge,
  VisionStateBadge,
} from "@/components/status/badges";
import { ProductThumb } from "@/components/status/ProductThumb";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, KV, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DiscrepancyDrawer } from "@/features/discrepancies/DiscrepancyDrawer";
import {
  useAudit,
  useDiscrepancies,
  useProducts,
  useSessionDetail,
  useSessionReconciliations,
  useSessionScans,
  useSessionSensors,
  useSessionVision,
} from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatINR, formatTime, pct } from "@/lib/format";
import { cn, humanize } from "@/lib/utils";

export default function SessionDetailPage() {
  const { id } = useParams();
  const detail = useSessionDetail(id);
  const [drawer, setDrawer] = useState<string | null>(null);
  const qc = useQueryClient();

  const force = useMutation({
    mutationFn: () => api.post<{ finalized: number }>(`/api/sessions/${id}/reconcile`),
    onSuccess: (r) => {
      toast.success(`Finalised ${r.finalized} pending observation(s)`);
      qc.invalidateQueries({ queryKey: ["session", id] });
      qc.invalidateQueries({ queryKey: ["discrepancies"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  const d = detail.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/sessions" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Sessions
        </Link>
        <span className="text-subtle">/</span>
        <span className="font-mono text-[13px] text-fg">{id}</span>
        {d?.session.is_demo && <Badge tone="sim">DEMO{d.session.scenario_code ? ` · scenario ${d.session.scenario_code}` : ""}</Badge>}
        <div className="ml-auto flex gap-2">
          {d && d.verification.pending_observations > 0 && d.session.status === "ACTIVE" && (
            <Button size="sm" variant="outline" loading={force.isPending} onClick={() => force.mutate()}>
              <FastForward /> Finalise pending now
            </Button>
          )}
        </div>
      </div>

      {!d ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardBody>
                <dl className="grid grid-cols-2 gap-4">
                  <KV label="Status">
                    <SessionStatusBadge status={d.session.status} />
                  </KV>
                  <KV label="Shopper">{d.session.customer_label}</KV>
                  <KV label="Started">{formatDateTime(d.session.started_at)}</KV>
                  <KV label="Camera zone">{d.session.zone_id ?? "—"}</KV>
                  <KV label="Cart total">
                    <span className="num text-base font-semibold">{formatINR(d.subtotal_paise)}</span>
                  </KV>
                  <KV label="Items">{d.item_count}</KV>
                </dl>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="label-eyebrow">Verification</span>
                  <VerificationBadge status={d.verification.status} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="Units" value={d.verification.accepted_units} />
                  <Stat label="Camera-verified" value={d.verification.visually_verified_units} tone="ok" />
                  <Stat label="Pending" value={d.verification.pending_observations} tone="accent" />
                </div>
                <p className="text-xs leading-relaxed text-subtle">{d.verification.note}</p>
              </CardBody>
            </Card>
            <EligibilityCard d={d} />
          </div>

          <CartComparison d={d} />

          <Card className="overflow-hidden">
            <Tabs defaultValue="discrepancies">
              <TabsList>
                <TabsTrigger value="discrepancies">
                  <ShieldAlert /> Discrepancies
                </TabsTrigger>
                <TabsTrigger value="scans">
                  <ScanBarcode /> Scans
                </TabsTrigger>
                <TabsTrigger value="vision">
                  <Camera /> Camera events
                </TabsTrigger>
                <TabsTrigger value="recon">
                  <GitCompareArrows /> Reconciliation
                </TabsTrigger>
                <TabsTrigger value="sensors">
                  <Scale /> Sensors
                </TabsTrigger>
                <TabsTrigger value="audit">
                  <History /> Timeline & audit
                </TabsTrigger>
              </TabsList>
              <TabsContent value="discrepancies">
                <SessionDiscrepancies id={id!} onOpen={setDrawer} />
              </TabsContent>
              <TabsContent value="scans">
                <ScansTab id={id!} />
              </TabsContent>
              <TabsContent value="vision">
                <VisionTab id={id!} />
              </TabsContent>
              <TabsContent value="recon">
                <ReconTab id={id!} />
              </TabsContent>
              <TabsContent value="sensors">
                <SensorsTab id={id!} />
              </TabsContent>
              <TabsContent value="audit">
                <AuditTab id={id!} />
              </TabsContent>
            </Tabs>
          </Card>
        </>
      )}
      <DiscrepancyDrawer id={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "accent" }) {
  return (
    <div className="rounded-md border border-line bg-surface-2/50 px-2 py-2">
      <p className={cn("num text-xl font-semibold", tone === "ok" ? "text-ok" : tone === "accent" ? "text-accent" : "text-fg")}>{value}</p>
      <p className="text-[11px] text-subtle">{label}</p>
    </div>
  );
}

function EligibilityCard({ d }: { d: NonNullable<ReturnType<typeof useSessionDetail>["data"]> }) {
  const e = d.eligibility;
  return (
    <Card className={cn(d.checkout ? "border-info/30" : e.eligible ? "border-ok/30" : "border-bad/30")}>
      <CardBody className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="label-eyebrow">Checkout eligibility</span>
          {d.checkout ? <CheckoutBadge status={d.checkout.status} /> : <CheckoutBadge status={e.eligible ? "ELIGIBLE" : "BLOCKED"} />}
        </div>
        {d.checkout ? (
          <div className="text-[13px]">
            <p className="flex items-center gap-2 text-fg">
              <Receipt className="size-4 text-info" /> {d.checkout.id} · <span className="num font-semibold">{formatINR(d.checkout.total_paise)}</span>
            </p>
            <p className="mt-1 text-xs text-subtle">
              Authorized {formatDateTime(d.checkout.authorized_at)} · payment {d.checkout.payment_mode} · exit code{" "}
              <span className="font-mono text-fg">{d.checkout.exit_code}</span>
              {d.checkout.exited_at && ` · exited ${formatTime(d.checkout.exited_at)} (simulated gate)`}
            </p>
          </div>
        ) : e.eligible ? (
          <p className="flex items-center gap-2 text-[13px] text-ok">
            <CircleCheck className="size-4" /> All required checks complete. Totals recalculated from catalogue prices.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {e.blockers.map((b, i) => (
              <li key={i} className="text-[13px]">
                <p className="flex items-start gap-2 text-fg">
                  <Lock className="mt-0.5 size-3.5 shrink-0 text-bad" /> {b.message}
                </p>
                <p className="pl-5 text-xs text-muted">{b.action}</p>
              </li>
            ))}
          </ul>
        )}
        {e.warnings.length > 0 && <p className="text-xs text-warn">{e.warnings.length} advisory notice(s) for the customer.</p>}
      </CardBody>
    </Card>
  );
}

function CartComparison({ d }: { d: NonNullable<ReturnType<typeof useSessionDetail>["data"]> }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.1fr]">
      <Card>
        <CardHeader title="Original cart" description={d.scanned_cart.label} />
        <CardBody className="space-y-2">
          {d.scanned_cart.lines.length === 0 ? (
            <p className="text-[13px] text-muted">No scans.</p>
          ) : (
            d.scanned_cart.lines.map((l) => (
              <div key={l.product_id} className="flex justify-between text-[13px]">
                <span className="text-muted">
                  {l.quantity} × {l.name}
                </span>
                <span className="num">{formatINR(l.line_total_paise)}</span>
              </div>
            ))
          )}
          <div className="flex justify-between border-t border-line pt-2 text-[13px] font-semibold">
            <span>Total</span>
            <span className="num">{formatINR(d.scanned_cart.subtotal_paise)}</span>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Current (corrected) cart" description="Authoritative catalogue prices" />
        <CardBody className="space-y-2">
          {d.lines.length === 0 ? (
            <p className="text-[13px] text-muted">Cart is empty.</p>
          ) : (
            d.lines.map((l) => (
              <div key={l.product.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="flex min-w-0 items-center gap-2">
                  <ProductThumb product={l.product} className="size-7" />
                  <span className="truncate text-fg">
                    {l.quantity} × {l.product.name}
                  </span>
                </span>
                <span className="num">{formatINR(l.line_total_paise)}</span>
              </div>
            ))
          )}
          <div className="flex justify-between border-t border-line pt-2 text-[13px] font-semibold">
            <span>Total</span>
            <span className="num">{formatINR(d.subtotal_paise)}</span>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Corrections & decisions" description="Original evidence is never overwritten." />
        <CardBody>
          {d.corrections.length === 0 ? (
            <p className="text-[13px] text-muted">No resolution actions yet.</p>
          ) : (
            <ol className="space-y-2.5">
              {d.corrections.map((a) => (
                <li key={a.id} className="text-[13px]">
                  <p className="text-fg">
                    {humanize(a.action)} <span className="text-subtle">· {formatTime(a.created_at)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {a.discrepancy_id} · {humanize(a.actor_type)} {a.actor_id ?? ""}
                  </p>
                  {a.cart_delta.length > 0 && (
                    <p className="text-xs text-accent">
                      {a.cart_delta.map((c) => `${c.qty_delta > 0 ? "+" : ""}${c.qty_delta} ${c.name ?? c.product_id}`).join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function useProductNames() {
  const p = useProducts({ includeInactive: true });
  return (id: string | null | undefined) => (id ? (p.data?.find((x) => x.id === id)?.name ?? id) : "—");
}

function Loading() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  );
}

function SessionDiscrepancies({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const q = useDiscrepancies({ session_id: id, limit: 50, offset: 0 });
  if (q.isError) return <ErrorState error={q.error} />;
  if (!q.data) return <Loading />;
  if (!q.data.items.length) return <EmptyState icon={<CircleCheck />} title="No discrepancies in this session" />;
  return (
    <ul className="divide-y divide-line/70">
      {q.data.items.map((d) => (
        <li key={d.id}>
          <button onClick={() => onOpen(d.id)} className="flex w-full cursor-pointer flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-surface-2/60">
            <div className="min-w-0 flex-1">
              <KindLabel kind={d.kind} />
              <p className="mt-0.5 line-clamp-1 pl-4 text-xs text-muted">{d.explanation}</p>
            </div>
            <SourceBadge source={d.source} isSimulated={d.is_simulated} />
            <StateBadge state={d.state} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ScansTab({ id }: { id: string }) {
  const q = useSessionScans(id);
  const name = useProductNames();
  if (!q.data) return <Loading />;
  if (!q.data.length) return <EmptyState icon={<ScanBarcode />} title="No scans yet" />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Time</TH>
          <TH>Product</TH>
          <TH>Method</TH>
          <TH>Source</TH>
          <TH>Status</TH>
          <TH>Camera match</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.map((s) => (
          <TR key={s.id}>
            <TD className="num whitespace-nowrap text-muted">{formatTime(s.occurred_at)}</TD>
            <TD>
              <p>{name(s.product_id)}</p>
              <p className="font-mono text-xs text-subtle">{s.barcode}</p>
            </TD>
            <TD className="text-muted">{humanize(s.method)}</TD>
            <TD>
              <SourceBadge source={s.source} isSimulated={s.is_simulated} />
            </TD>
            <TD>
              <Badge tone={s.status === "ACCEPTED" ? "ok" : s.status === "VOIDED" ? "neutral" : "warn"}>{humanize(s.status)}</Badge>
              {s.void_reason && <p className="mt-0.5 text-xs text-subtle">{s.void_reason}</p>}
            </TD>
            <TD className="font-mono text-xs text-muted">{s.matched_vision_event_id ?? "—"}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function VisionTab({ id }: { id: string }) {
  const q = useSessionVision(id);
  const name = useProductNames();
  if (!q.data) return <Loading />;
  if (!q.data.length)
    return <EmptyState icon={<Camera />} title="No camera events" description="No candidate interactions were observed for this session." />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Time</TH>
          <TH>Event</TH>
          <TH>Candidate</TH>
          <TH>Model / recon.</TH>
          <TH>Source</TH>
          <TH>State</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.map((v) => (
          <TR key={v.id}>
            <TD className="num whitespace-nowrap text-muted">{formatTime(v.occurred_at)}</TD>
            <TD>
              <p>{humanize(v.event_type)}</p>
              <p className="font-mono text-xs text-subtle">
                {v.id}
                {v.track_id ? ` · track ${v.track_id}` : ""}
              </p>
            </TD>
            <TD>
              <p>{v.product_id ? name(v.product_id) : v.class_label ? `class “${v.class_label}”` : "—"}</p>
              <p className="text-xs text-subtle">
                {v.recognition_level}-level{v.uncertainty_reason ? ` · ${v.uncertainty_reason}` : ""}
              </p>
            </TD>
            <TD className="num">
              {pct(v.model_confidence)} <span className="text-subtle">/ {pct(v.reconciliation_confidence)}</span>
            </TD>
            <TD>
              <SourceBadge source={v.source} isSimulated={v.is_simulated} />
            </TD>
            <TD>
              <VisionStateBadge state={v.state} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function ReconTab({ id }: { id: string }) {
  const q = useSessionReconciliations(id);
  const [open, setOpen] = useState<string | null>(null);
  if (!q.data) return <Loading />;
  if (!q.data.length) return <EmptyState icon={<GitCompareArrows />} title="No reconciliation decisions yet" />;
  return (
    <ul className="divide-y divide-line/70">
      {q.data.map((r) => (
        <li key={r.id} className="px-5 py-3">
          <button className="flex w-full cursor-pointer items-start justify-between gap-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-fg">{humanize(r.outcome)}</p>
              <p className="text-xs text-muted">{r.explanation}</p>
            </div>
            <div className="num shrink-0 text-right text-xs text-subtle">
              <p>{formatTime(r.created_at)}</p>
              {r.reconciliation_confidence != null && <p>recon. {pct(r.reconciliation_confidence)}</p>}
            </div>
          </button>
          {open === r.id && r.factors.length > 0 && (
            <div className="mt-3">
              <FactorList factors={r.factors} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function SensorsTab({ id }: { id: string }) {
  const q = useSessionSensors(id);
  if (!q.data) return <Loading />;
  if (!q.data.length)
    return <EmptyState icon={<Scale />} title="No shelf-weight readings" description="Weight is optional supporting evidence only." />;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Time</TH>
          <TH>Zone</TH>
          <TH className="text-right">Δ weight</TH>
          <TH>Source</TH>
        </TR>
      </THead>
      <TBody>
        {q.data.map((s) => (
          <TR key={s.id}>
            <TD className="num text-muted">{formatTime(s.occurred_at)}</TD>
            <TD>{s.zone_id}</TD>
            <TD className="num text-right">{s.delta_grams > 0 ? "+" : ""}{s.delta_grams} g</TD>
            <TD>
              <SourceBadge source={s.source} isSimulated={s.is_simulated} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function AuditTab({ id }: { id: string }) {
  const [limit, setLimit] = useState(50);
  const q = useAudit({ session_id: id, limit, offset: 0 });
  if (!q.data) return <Loading />;
  return (
    <div className="px-5 py-4">
      <ol className="relative space-y-3 border-l border-line pl-5">
        {q.data.items.map((a) => (
          <li key={a.id} className="relative">
            <span
              className={cn(
                "absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-surface",
                a.event_type.includes("DENIED") || a.event_type.includes("DISCREPANCY_CREATED")
                  ? "bg-warn"
                  : a.event_type.includes("AUTHORIZED") || a.event_type.includes("EXIT")
                    ? "bg-ok"
                    : "bg-accent",
              )}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-fg">{a.summary}</span>
              {a.is_simulated && <Badge tone="sim">SIMULATED</Badge>}
            </div>
            <p className="text-xs text-subtle">
              {formatDateTime(a.occurred_at)} · {humanize(a.event_type)} · {humanize(a.actor_type)} {a.actor_id ?? ""}
            </p>
          </li>
        ))}
      </ol>
      {q.data.total > q.data.items.length && (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setLimit((l) => Math.min(200, l + 50))}>
          Show older ({q.data.total - q.data.items.length} more)
        </Button>
      )}
    </div>
  );
}
