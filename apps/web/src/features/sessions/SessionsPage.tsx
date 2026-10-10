import { ChevronRight, Search, ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CheckoutBadge, SessionStatusBadge, VerificationBadge } from "@/components/status/badges";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton, Switch } from "@/components/ui/misc";
import { Pagination, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useSessions } from "@/hooks/queries";
import { formatDateTime, formatINR, relativeTime } from "@/lib/format";

const LIMIT = 20;

export default function SessionsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const status = params.get("status") ?? "";
  const attention = params.get("attention") === "1";
  const demo = params.get("demo") ?? "";
  const offset = Number(params.get("offset") ?? 0);
  const [search, setSearch] = useState(params.get("q") ?? "");

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    if (!("offset" in patch)) next.delete("offset");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== search) set({ q: search });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const q = useSessions(
    {
      q: params.get("q") || undefined,
      status: status || undefined,
      attention: attention || undefined,
      demo: demo === "" ? undefined : demo === "1",
      limit: LIMIT,
      offset,
    },
    10_000,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search session ID or shopper"
            className="pl-9"
            aria-label="Search sessions"
          />
        </div>
        <NativeSelect aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value })} className="w-auto">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="CHECKOUT_AUTHORIZED">Checkout authorized</option>
          <option value="EXITED">Exited</option>
          <option value="CANCELLED">Cancelled</option>
        </NativeSelect>
        <NativeSelect aria-label="Data origin" value={demo} onChange={(e) => set({ demo: e.target.value })} className="w-auto">
          <option value="">Demo + real</option>
          <option value="0">Real sessions only</option>
          <option value="1">Demo / seeded only</option>
        </NativeSelect>
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-[13px] text-muted">
          <Switch checked={attention} onCheckedChange={(c) => set({ attention: c ? "1" : null })} aria-label="Needs attention only" />
          Needs attention
        </label>
      </div>

      <Card className="overflow-hidden">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<ShoppingCart />} title="No sessions match" description="Adjust the filters or start a session from the customer app." />
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Session</TH>
                    <TH>Started</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Scans</TH>
                    <TH className="text-right">Cart total</TH>
                    <TH className="text-right">Open</TH>
                    <TH>Verification</TH>
                    <TH>Checkout</TH>
                    <TH className="w-8" />
                  </TR>
                </THead>
                <TBody>
                  {q.data.items.map((s) => (
                    <TR key={s.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => navigate(`/sessions/${s.id}`)}>
                      <TD>
                        <Link to={`/sessions/${s.id}`} className="font-mono text-[13px] hover:text-accent" onClick={(e) => e.stopPropagation()}>
                          {s.id}
                        </Link>
                        <p className="flex items-center gap-1.5 text-xs text-subtle">
                          {s.customer_label}
                          {s.is_demo && <Badge tone="sim">DEMO{s.scenario_code ? ` ${s.scenario_code}` : ""}</Badge>}
                        </p>
                      </TD>
                      <TD>
                        <p className="text-[13px]">{formatDateTime(s.started_at)}</p>
                        <p className="text-xs text-subtle">{relativeTime(s.started_at)}</p>
                      </TD>
                      <TD>
                        <SessionStatusBadge status={s.status} />
                      </TD>
                      <TD className="num text-right">{s.scan_count}</TD>
                      <TD className="num text-right font-medium">{formatINR(s.subtotal_paise)}</TD>
                      <TD className="num text-right">
                        {s.open_discrepancies > 0 ? <span className="font-semibold text-warn">{s.open_discrepancies}</span> : <span className="text-subtle">0</span>}
                      </TD>
                      <TD>
                        <VerificationBadge status={s.verification_status} />
                      </TD>
                      <TD>
                        <CheckoutBadge status={s.checkout_status} />
                      </TD>
                      <TD>
                        <ChevronRight className="size-4 text-subtle" />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {q.data.items.map((s) => (
                <li key={s.id}>
                  <Link to={`/sessions/${s.id}`} className="block px-4 py-3 hover:bg-surface-2/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px]">{s.id}</span>
                      <span className="num text-[13px] font-semibold">{formatINR(s.subtotal_paise)}</span>
                    </div>
                    <p className="text-xs text-subtle">
                      {s.customer_label} · {relativeTime(s.started_at)} · {s.scan_count} scans
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <SessionStatusBadge status={s.status} />
                      <VerificationBadge status={s.verification_status} />
                      <CheckoutBadge status={s.checkout_status} />
                      {s.open_discrepancies > 0 && <Badge tone="warn">{s.open_discrepancies} open</Badge>}
                      {s.is_demo && <Badge tone="sim">DEMO</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination total={q.data.total} limit={LIMIT} offset={offset} onChange={(o) => set({ offset: String(o) })} />
          </>
        )}
      </Card>
    </div>
  );
}
