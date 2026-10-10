import {
  Activity,
  ArrowUpRight,
  Camera,
  CameraOff,
  CircleCheck,
  FlaskConical,
  Receipt,
  ShieldAlert,
  ShoppingCart,
  Table2,
  ChartLine,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useLive } from "@/app/live-context";
import { CheckoutBadge, KindLabel, SourceBadge, VerificationBadge } from "@/components/status/badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { useOverview } from "@/hooks/queries";
import { formatDay, formatINR, formatTime, relativeTime } from "@/lib/format";
import { cn, humanize } from "@/lib/utils";
import type { LiveMessage, Overview } from "@/types/api";

const SERIES = [
  { key: "sessions", label: "Sessions started", color: "#3987e5" },
  { key: "discrepancies", label: "Discrepancies raised", color: "#d95926" },
  { key: "checkouts", label: "Checkouts authorized", color: "#199e70" },
] as const;

export default function OverviewPage() {
  const q = useOverview();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        <Kpi
          loading={!d}
          icon={<ShoppingCart />}
          label="Active sessions"
          value={d?.kpis.active_sessions}
          foot={d ? `${d.kpis.sessions_blocked_now} currently blocked from checkout` : ""}
          to="/sessions?status=ACTIVE"
        />
        <Kpi
          loading={!d}
          icon={<ShieldAlert />}
          tone="bad"
          label="Sessions awaiting staff review"
          value={d?.kpis.sessions_awaiting_review}
          foot={d ? `${d.kpis.awaiting_customer} alerts waiting on customers` : ""}
          to="/discrepancies?state=AWAITING_STAFF"
        />
        <Kpi
          loading={!d}
          icon={<CircleCheck />}
          tone="ok"
          label="Resolved discrepancies"
          value={d ? d.kpis.resolved_discrepancies + d.kpis.dismissed_discrepancies : undefined}
          foot={d ? `${d.kpis.resolved_discrepancies} resolved · ${d.kpis.dismissed_discrepancies} dismissed as false positives` : ""}
          to="/discrepancies?state=CLOSED"
        />
        <Kpi
          loading={!d}
          icon={<Receipt />}
          tone="info"
          label="Checkouts authorized"
          value={d?.kpis.checkouts_authorized}
          foot={d ? `${d.kpis.checkouts_denied} blocked attempts · ${formatINR(d.kpis.revenue_paise)} billed` : ""}
          to="/sessions?status=EXITED"
        />
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <ActivityChart data={d} />
        <DistributionChart data={d} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <RecentSessions data={d} />
        <div className="space-y-5">
          <VisionCard data={d} />
          <LiveFeed />
        </div>
      </div>

      {d && (
        <p className="flex items-center gap-2 text-xs text-subtle">
          <FlaskConical className="size-3.5 text-sim" /> {d.data_note} Updated {formatTime(d.generated_at)}.
        </p>
      )}
    </div>
  );
}

function Kpi({
  loading,
  icon,
  label,
  value,
  foot,
  tone = "accent",
  to,
}: {
  loading: boolean;
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  foot: string;
  tone?: "accent" | "ok" | "bad" | "info";
  to: string;
}) {
  const toneCls = { accent: "text-accent", ok: "text-ok", bad: "text-bad", info: "text-info" }[tone];
  return (
    <Link to={to} className="card group block p-4 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between">
        <span className={cn("grid size-8 place-items-center rounded-md border border-line bg-surface-2 [&_svg]:size-4", toneCls)}>
          {icon}
        </span>
        <ArrowUpRight className="size-4 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="mt-3 text-[13px] text-muted">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-8 w-16" />
      ) : (
        <p className="num mt-0.5 text-3xl font-semibold tracking-tight text-fg">{value ?? 0}</p>
      )}
      <p className="mt-1.5 truncate text-xs text-subtle">{loading ? " " : foot}</p>
    </Link>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-xs shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-medium text-fg">{label ? formatDay(label) : ""}</p>
      {payload.map((p) => {
        const s = SERIES.find((x) => x.key === p.dataKey);
        return (
          <p key={p.dataKey} className="flex items-center gap-2 text-muted">
            <span className="size-2 rounded-full" style={{ background: p.color }} />
            {s?.label ?? p.dataKey}
            <span className="num ml-auto pl-3 font-semibold text-fg">{p.value}</span>
          </p>
        );
      })}
    </div>
  );
}

function ActivityChart({ data }: { data: Overview | undefined }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        icon={<Activity />}
        title="Session activity — last 7 days"
        description="Daily counts from the database (UTC days). Includes seeded demo history."
        actions={
          <button
            onClick={() => setAsTable((t) => !t)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"
            aria-pressed={asTable}
          >
            {asTable ? <ChartLine className="size-3.5" /> : <Table2 className="size-3.5" />}
            {asTable ? "Chart" : "Table"}
          </button>
        }
      />
      <CardBody>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1" aria-label="Legend">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-2 text-xs text-muted">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
        {!data ? (
          <Skeleton className="h-[240px]" />
        ) : asTable ? (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th className="py-1.5 font-medium">Day</th>
                {SERIES.map((s) => (
                  <th key={s.key} className="py-1.5 text-right font-medium">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.activity.map((r) => (
                <tr key={r.date} className="border-t border-line/60">
                  <td className="py-1.5 text-muted">{formatDay(r.date)}</td>
                  <td className="num py-1.5 text-right">{r.sessions}</td>
                  <td className="num py-1.5 text-right">{r.discrepancies}</td>
                  <td className="num py-1.5 text-right">{r.checkouts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="h-[240px]" role="img" aria-label="Line chart of daily sessions, discrepancies and checkouts">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.activity} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#1b2740" strokeDasharray="0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDay}
                  tick={{ fill: "#66748c", fontSize: 11 }}
                  axisLine={{ stroke: "#1b2740" }}
                  tickLine={false}
                />
                <YAxis allowDecimals={false} tick={{ fill: "#66748c", fontSize: 11 }} axisLine={false} tickLine={false} />
                <RTooltip content={<ChartTooltip />} cursor={{ stroke: "#283a5a", strokeWidth: 1 }} />
                {SERIES.map((s) => (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={{ r: 3, fill: s.color, stroke: "#0b1220", strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: "#0b1220", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function DistributionChart({ data }: { data: Overview | undefined }) {
  const rows = data?.discrepancy_distribution ?? [];
  return (
    <Card>
      <CardHeader icon={<ShieldAlert />} title="Discrepancy distribution" description="All-time count by category." />
      <CardBody>
        {!data ? (
          <Skeleton className="h-[240px]" />
        ) : rows.length === 0 ? (
          <EmptyState icon={<CircleCheck />} title="No discrepancies yet" description="Run a demo scenario to see KORTEX raise and resolve one." />
        ) : (
          <div style={{ height: Math.max(160, rows.length * 40) }} role="img" aria-label="Bar chart of discrepancies by category">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 32, bottom: 0, left: 0 }} barCategoryGap={8}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={176}
                  tick={{ fill: "#9aa8bf", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RTooltip
                  cursor={{ fill: "rgb(148 163 184 / 0.06)" }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-md border border-line-strong bg-surface-3 px-3 py-2 text-xs">
                        <span className="text-muted">{payload[0].payload.label}: </span>
                        <span className="num font-semibold text-fg">{payload[0].value}</span>
                      </div>
                    ) : null
                  }
                />
                <Bar dataKey="count" fill="#3987e5" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
                  <LabelList dataKey="count" position="right" fill="#e7edf7" fontSize={11} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RecentSessions({ data }: { data: Overview | undefined }) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        icon={<ShoppingCart />}
        title="Recent shopping sessions"
        actions={
          <Link to="/sessions" className="text-xs font-medium text-accent hover:underline">
            View all
          </Link>
        }
      />
      {!data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : data.recent_sessions.length === 0 ? (
        <EmptyState icon={<ShoppingCart />} title="No sessions yet" description="Open the customer app or start a demo." />
      ) : (
        <ul className="divide-y divide-line/70">
          {data.recent_sessions.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-surface-2/60 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-mono text-[13px] text-fg">
                    {s.id}
                    {s.is_demo && <Badge tone="sim">DEMO{s.scenario_code ? ` ${s.scenario_code}` : ""}</Badge>}
                  </p>
                  <p className="text-xs text-subtle">
                    {s.customer_label} · started {relativeTime(s.started_at)}
                  </p>
                </div>
                <div className="num text-right text-[13px]">
                  <p className="font-semibold text-fg">{formatINR(s.subtotal_paise)}</p>
                  <p className="text-xs text-subtle">{s.item_count} items</p>
                </div>
                <div className="flex w-full items-center gap-1.5 sm:w-auto">
                  <VerificationBadge status={s.verification_status} />
                  <CheckoutBadge status={s.checkout_status} />
                  {s.open_discrepancies > 0 && <Badge tone="warn">{s.open_discrepancies} open</Badge>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function VisionCard({ data }: { data: Overview | undefined }) {
  const v = data?.vision;
  const camOnline = v?.online && v.status?.camera_status === "ONLINE";
  const sources = data?.event_sources.vision ?? {};
  return (
    <Card>
      <CardHeader icon={camOnline ? <Camera /> : <CameraOff />} title="Camera & vision service" />
      <CardBody className="space-y-3">
        {!data ? (
          <Skeleton className="h-20" />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted">Status</span>
              {camOnline ? (
                <Badge tone="ok" dot>
                  Camera live · {v?.status?.model_name ?? "model"}
                </Badge>
              ) : v?.online ? (
                <Badge tone="warn" dot>
                  Service up · camera {humanize(v.status?.camera_status)}
                </Badge>
              ) : (
                <Badge tone="neutral">Not running</Badge>
              )}
            </div>
            {!v?.online && <p className="text-xs text-subtle">{v?.message} Simulation mode remains available.</p>}
            <div>
              <p className="label-eyebrow mb-1.5">Camera events by source (all-time)</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(sources).length === 0 && <span className="text-xs text-subtle">No camera events yet.</span>}
                {Object.entries(sources).map(([src, n]) => (
                  <span key={src} className="flex items-center gap-1.5">
                    <SourceBadge source={src} />
                    <span className="num text-[13px] font-semibold">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

const FEED_LABEL: Record<string, string> = {
  "scan.created": "Barcode scanned",
  "vision.created": "Camera event received",
  "sensor.created": "Shelf weight reading",
  "reconciliation.created": "Reconciliation decision",
  "discrepancy.created": "Discrepancy raised",
  "discrepancy.updated": "Discrepancy updated",
  "checkout.updated": "Checkout status changed",
  "session.created": "Session started",
};

function LiveFeed() {
  const { feed, status } = useLive();
  return (
    <Card>
      <CardHeader
        icon={<Activity />}
        title="Live event feed"
        description="Real-time WebSocket notifications."
        actions={<Badge tone={status === "open" ? "ok" : "warn"} dot>{status === "open" ? "Live" : "Offline"}</Badge>}
      />
      {feed.length === 0 ? (
        <EmptyState title="Waiting for activity" description="Scans, camera events and decisions appear here as they happen." />
      ) : (
        <ul className="max-h-[260px] divide-y divide-line/60 overflow-y-auto">
          {feed.slice(0, 25).map((m, i) => (
            <FeedItem key={`${m.ts}-${i}`} m={m} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function FeedItem({ m }: { m: LiveMessage }) {
  const kind = typeof m.data.kind === "string" ? (m.data.kind as Parameters<typeof KindLabel>[0]["kind"]) : null;
  return (
    <li className="animate-fade-in px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-fg">{FEED_LABEL[m.type] ?? m.type}</span>
        <span className="num shrink-0 text-[11px] text-subtle">{formatTime(m.ts)}</span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        {m.session_id && <span className="font-mono">{m.session_id}</span>}
        {kind && <KindLabel kind={kind} />}
        {typeof m.data.outcome === "string" && <span>{humanize(m.data.outcome)}</span>}
        {typeof m.data.state === "string" && <span>{humanize(m.data.state)}</span>}
        {m.data.is_simulated === true && <Badge tone="sim">SIMULATED</Badge>}
      </div>
    </li>
  );
}
