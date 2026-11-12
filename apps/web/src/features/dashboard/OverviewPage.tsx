import { ChevronRight, CircleCheck } from "lucide-react";
import { Link } from "react-router";
import { CheckoutBadge, KindLabel, StateBadge } from "@/components/status/badges";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useDiscrepancies, useOverview } from "@/hooks/queries";
import { formatDay, formatINR, relativeTime } from "@/lib/format";
import type { Overview } from "@/types/api";

export default function OverviewPage() {
  const q = useOverview();
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <div className="space-y-8">
      <NeedsAttention />

      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-line py-5 lg:grid-cols-4">
        <Stat label="Active sessions" value={d?.kpis.active_sessions} to="/sessions?status=ACTIVE" />
        <Stat label="Waiting on shoppers" value={d?.kpis.awaiting_customer} to="/discrepancies?state=AWAITING_CUSTOMER" />
        <Stat label="Checkouts" value={d?.kpis.checkouts_authorized} to="/sessions?status=EXITED" />
        <Stat label="Billed" value={d ? formatINR(d.kpis.revenue_paise) : undefined} />
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <ActivityChart data={d} />
        <RecentSessions data={d} />
      </div>
    </div>
  );
}

/** What a staff member should act on first. Everything else on the page is context. */
function NeedsAttention() {
  const q = useDiscrepancies({ state: "AWAITING_STAFF", limit: 5, offset: 0 });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  return (
    <section aria-labelledby="attention-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attention-title" className="page-title">
          {!q.data ? "Checking for alerts" : total === 0 ? "Nothing needs you right now" : `${total} ${total === 1 ? "alert needs" : "alerts need"} a staff decision`}
        </h2>
        {total > items.length && (
          <Link to="/discrepancies?state=AWAITING_STAFF" className="tap shrink-0 py-2 text-[13px] font-medium text-muted hover:text-fg">
            View all
          </Link>
        )}
      </div>
      {q.isError && !q.data ? (
        <div className="mt-3">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : !q.data ? (
        <Skeleton className="mt-3 h-24" />
      ) : total === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <CircleCheck className="size-4 shrink-0 text-ok" /> Shoppers are resolving their own alerts. New ones appear here as they come in.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {items.map((x) => (
            <li key={x.id}>
              <Link to={`/discrepancies?state=ALL&id=${x.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <KindLabel kind={x.kind} />
                  <p className="mt-0.5 truncate text-xs text-subtle">
                    <span className="font-mono">{x.session_id}</span> · {relativeTime(x.created_at)}
                  </p>
                </div>
                <span className="hidden sm:inline">
                  <StateBadge state={x.state} />
                </span>
                <ChevronRight className="size-4 shrink-0 text-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, to }: { label: string; value: number | string | undefined; to?: string }) {
  const body = (
    <>
      <p className="text-[13px] text-subtle">{label}</p>
      {value === undefined ? <Skeleton className="mt-1.5 h-8 w-16" /> : <p className="num mt-1 truncate text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{value}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="block min-w-0 rounded-lg outline-offset-4 hover:opacity-80">
      {body}
    </Link>
  ) : (
    <div className="min-w-0">{body}</div>
  );
}

const SERIES = [
  { key: "sessions", label: "Sessions", className: "bg-muted" },
  { key: "discrepancies", label: "Alerts raised", className: "bg-warn" },
  { key: "checkouts", label: "Checkouts", className: "bg-ok" },
] as const;

/** Seven days, three series. Small enough to draw with plain elements. */
function ActivityChart({ data }: { data: Overview | undefined }) {
  const rows = data?.activity ?? [];
  const max = Math.max(1, ...rows.flatMap((r) => SERIES.map((s) => r[s.key])));
  const empty = rows.length > 0 && rows.every((r) => SERIES.every((s) => r[s.key] === 0));
  return (
    <section aria-labelledby="activity-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="activity-title" className="text-[15px] font-semibold text-fg">
          Last 7 days
        </h2>
        <div className="flex gap-3" aria-hidden>
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-subtle">
              <span className={`size-2 rounded-sm ${s.className}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {!data ? (
        <Skeleton className="mt-3 h-44" />
      ) : empty ? (
        <EmptyState className="mt-3 h-44 rounded-xl border border-line" title="No activity this week" description="Run a demo scenario or open the customer app to create some." />
      ) : (
        <>
          <div className="mt-3 flex h-44 items-end gap-2 border-b border-line" aria-hidden>
            {rows.map((r) => (
              <div key={r.date} className="flex h-full flex-1 items-end justify-center gap-[3px]">
                {SERIES.map((s) => (
                  <div
                    key={s.key}
                    title={`${s.label}: ${r[s.key]}`}
                    className={`w-full max-w-3 rounded-t-sm ${s.className}`}
                    style={{ height: r[s.key] ? `${Math.max(3, (r[s.key] / max) * 100)}%` : 0 }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2" aria-hidden>
            {rows.map((r) => (
              <span key={r.date} className="flex-1 truncate text-center text-[11px] text-subtle">
                {formatDay(r.date)}
              </span>
            ))}
          </div>
          <div className="sr-only">
          <table>
            <caption>Daily sessions, alerts raised and checkouts for the last 7 days</caption>
            <thead>
              <tr>
                <th>Day</th>
                {SERIES.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <td>{formatDay(r.date)}</td>
                  {SERIES.map((s) => (
                    <td key={s.key}>{r[s.key]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}

function RecentSessions({ data }: { data: Overview | undefined }) {
  return (
    <section aria-labelledby="recent-title">
      <div className="flex items-baseline justify-between">
        <h2 id="recent-title" className="text-[15px] font-semibold text-fg">
          Recent sessions
        </h2>
        <Link to="/sessions" className="tap py-1 text-[13px] font-medium text-muted hover:text-fg">
          View all
        </Link>
      </div>
      {!data ? (
        <Skeleton className="mt-3 h-44" />
      ) : data.recent_sessions.length === 0 ? (
        <EmptyState className="mt-3 rounded-xl border border-line" title="No sessions yet" description="Open the customer app or run a demo." />
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
          {data.recent_sessions.slice(0, 5).map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-surface">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium text-fg">
                    {s.customer_label}
                    {s.is_demo && <Badge tone="sim">Demo{s.scenario_code ? ` ${s.scenario_code}` : ""}</Badge>}
                  </p>
                  <p className="num truncate text-xs text-subtle">
                    {relativeTime(s.started_at)} · {s.item_count} item{s.item_count === 1 ? "" : "s"} · {formatINR(s.subtotal_paise)}
                  </p>
                </div>
                {s.open_discrepancies > 0 ? <Badge tone="warn">{s.open_discrepancies} open</Badge> : <CheckoutBadge status={s.checkout_status} />}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
