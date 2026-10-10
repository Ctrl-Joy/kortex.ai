import { ChevronRight, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router";
import { KindLabel, SourceBadge, StateBadge } from "@/components/status/badges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { Pagination, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDiscrepancies } from "@/hooks/queries";
import { formatDateTime, pct, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DiscrepancyDrawer } from "./DiscrepancyDrawer";

const LIMIT = 20;

const STATE_TABS = [
  { v: "OPEN", label: "Open" },
  { v: "AWAITING_STAFF", label: "Awaiting staff" },
  { v: "AWAITING_CUSTOMER", label: "Awaiting customer" },
  { v: "ESCALATED", label: "Escalated" },
  { v: "CLOSED", label: "Closed" },
  { v: "", label: "All" },
];

export default function DiscrepanciesPage() {
  const [params, setParams] = useSearchParams();
  const state = params.get("state") ?? "OPEN";
  const kind = params.get("kind") ?? "";
  const source = params.get("source") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const selected = params.get("id");

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next, { replace: true });
  };

  const q = useDiscrepancies({
    state: state && state !== "ALL" ? state : undefined,
    kind: kind || undefined,
    simulated: source === "" ? undefined : source === "simulated",
    limit: LIMIT,
    offset,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1" role="tablist" aria-label="State filter">
          {STATE_TABS.map((t) => (
            <button
              key={t.v}
              role="tab"
              aria-selected={state === t.v}
              onClick={() => set({ state: t.v === "" ? "ALL" : t.v })}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                (state === t.v || (t.v === "" && state === "ALL")) ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <NativeSelect aria-label="Category" value={kind} onChange={(e) => set({ kind: e.target.value })} className="w-auto">
            <option value="">All categories</option>
            <option value="MISSED_SCAN">Potential missed scan</option>
            <option value="WRONG_PRODUCT">Possible wrong-product scan</option>
            <option value="DUPLICATE_SCAN">Duplicate scan</option>
            <option value="UNCERTAIN_OBSERVATION">Uncertain observation</option>
            <option value="PICKUP_RETURN">Pickup followed by return</option>
            <option value="CONFLICTING_EVIDENCE">Conflicting / incomplete evidence</option>
          </NativeSelect>
          <NativeSelect aria-label="Source" value={source} onChange={(e) => set({ source: e.target.value })} className="w-auto">
            <option value="">All sources</option>
            <option value="real">Real events only</option>
            <option value="simulated">Simulated only</option>
          </NativeSelect>
        </div>
      </div>

      <Card className="overflow-hidden">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck />}
            title={state === "OPEN" ? "No open discrepancies" : "Nothing matches these filters"}
            description="When the camera observes something the cart doesn't explain, it appears here for a decision."
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Event</TH>
                    <TH>Category</TH>
                    <TH>Observed / scanned</TH>
                    <TH>Confidence</TH>
                    <TH>Source</TH>
                    <TH>State</TH>
                    <TH className="w-8" />
                  </TR>
                </THead>
                <TBody>
                  {q.data.items.map((d) => (
                    <TR
                      key={d.id}
                      className={cn("cursor-pointer hover:bg-surface-2/60", selected === d.id && "bg-surface-2")}
                      onClick={() => set({ id: d.id, offset: String(offset) })}
                    >
                      <TD>
                        <p className="font-mono text-[13px]">{d.id}</p>
                        <p className="text-xs text-subtle">
                          <span className="font-mono">{d.session_id}</span> · {relativeTime(d.created_at)}
                        </p>
                      </TD>
                      <TD>
                        <KindLabel kind={d.kind} />
                        {!d.blocking && <p className="pl-4 text-xs text-subtle">Advisory</p>}
                      </TD>
                      <TD className="max-w-[220px]">
                        <p className="truncate">{d.observed_product?.name ?? "—"}</p>
                        <p className="truncate text-xs text-subtle">{d.scanned_product ? `Scanned: ${d.scanned_product.name}` : "No associated scan"}</p>
                      </TD>
                      <TD className="num">
                        <p>{pct(d.reconciliation_confidence)}</p>
                        <p className="text-xs text-subtle">model {pct(d.model_confidence)}</p>
                      </TD>
                      <TD>
                        <SourceBadge source={d.source} isSimulated={d.is_simulated} />
                      </TD>
                      <TD>
                        <StateBadge state={d.state} />
                      </TD>
                      <TD>
                        <ChevronRight className="size-4 text-subtle" />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* Mobile cards */}
            <ul className="divide-y divide-line md:hidden">
              {q.data.items.map((d) => (
                <li key={d.id}>
                  <button className="w-full cursor-pointer px-4 py-3 text-left hover:bg-surface-2/60" onClick={() => set({ id: d.id })}>
                    <div className="flex items-center justify-between gap-2">
                      <KindLabel kind={d.kind} />
                      <StateBadge state={d.state} />
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{d.observed_product?.name ?? "Unidentified item"}</p>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-subtle">
                      <span className="font-mono">{d.id}</span>
                      <SourceBadge source={d.source} isSimulated={d.is_simulated} />
                      <span>{formatDateTime(d.created_at)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination total={q.data.total} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) })} />
          </>
        )}
      </Card>

      <p className="flex items-center gap-2 text-xs text-subtle">
        <Badge tone="neutral">Policy</Badge> KORTEX never labels an uncertain observation as theft. Each item is a request for
        verification with a documented outcome.
      </p>

      <DiscrepancyDrawer id={selected} onClose={() => set({ id: null, offset: String(offset) })} />
    </div>
  );
}
