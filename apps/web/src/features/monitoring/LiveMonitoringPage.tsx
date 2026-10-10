import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CameraOff,
  CheckCheck,
  CircleDot,
  Copy,
  ExternalLink,
  FastForward,
  FlaskConical,
  Link2,
  Play,
  Plus,
  Radio,
  ScanBarcode,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { KindLabel, SourceBadge, StateBadge, VisionStateBadge } from "@/components/status/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/form";
import { EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import {
  useAudit,
  useDemoRuns,
  useDiscrepancies,
  useProducts,
  useSessionScans,
  useSessions,
  useVisionEvents,
  useVisionStatus,
  useZones,
} from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { formatTime, pct } from "@/lib/format";
import { cn, humanize, uid } from "@/lib/utils";
import type { DemoRun } from "@/types/api";

const ZONE = "SHELF-A1";

export default function LiveMonitoringPage() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const zones = useZones();
  const zone = zones.data?.find((z) => z.zone_id === ZONE);
  const sessionId = zone?.session_id ?? null;

  return (
    <div className="space-y-5">
      {runId && <DemoRunPanel runId={runId} onClose={() => setParams({}, { replace: true })} />}
      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <CameraPanel />
          <SessionBinder sessionId={sessionId} />
          <div className="grid gap-5 lg:grid-cols-2">
            <RecentScans sessionId={sessionId} />
            <RecentVision sessionId={sessionId} />
          </div>
        </div>
        <div className="space-y-5">
          <SimulationPanel sessionId={sessionId} />
          <SessionDiscrepancyStatus sessionId={sessionId} />
          <Timeline sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Camera */

function CameraPanel() {
  const vision = useVisionStatus();
  const v = vision.data;
  const online = !!v?.online;
  const camLive = online && v?.status?.camera_status === "ONLINE";
  const [streamError, setStreamError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (camLive) setStreamError(false);
  }, [camLive]);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={camLive ? <Camera /> : <CameraOff />}
        title="Shelf camera · zone SHELF-A1"
        description={
          camLive
            ? `Model: ${v?.status?.model_name ?? "—"} · ${v?.status?.recognition_mode ?? ""}`
            : "The vision service runs separately on this laptop (services/vision)."
        }
        actions={
          camLive ? (
            <Badge tone="accent" size="md">
              <CircleDot className="animate-pulse" /> LIVE CAMERA
            </Badge>
          ) : (
            <Badge tone="neutral" size="md">
              Camera offline
            </Badge>
          )
        }
      />
      <div className="relative aspect-video w-full bg-canvas">
        {camLive && !streamError ? (
          <>
            <img
              key={nonce}
              src={`/vision/stream.mjpg?n=${nonce}`}
              alt="Live shelf camera with detector overlay"
              className="h-full w-full object-contain"
              onError={() => setStreamError(true)}
            />
            <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-fg backdrop-blur">
              Boxes are drawn by the vision service from real model output only. No frames are stored.
            </div>
          </>
        ) : (
          <div className="grid-bg flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="grid size-12 place-items-center rounded-xl border border-line bg-surface-2 text-subtle">
              <CameraOff className="size-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-fg">
                {online ? (streamError ? "Camera stream unavailable" : `Camera ${humanize(v?.status?.camera_status)}`) : "Vision service not running"}
              </p>
              <p className="mt-1 max-w-md text-[13px] text-muted">
                {online
                  ? (v?.status?.message ?? "Check that no other application is using the webcam.")
                  : "Start it to stream real detections. Until then, use the clearly labelled simulation controls on the right."}
              </p>
            </div>
            {!online && (
              <code className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-xs text-muted">
                <Terminal className="size-3.5" /> scripts\start-vision.ps1
              </code>
            )}
            {online && streamError && (
              <Button size="sm" variant="outline" onClick={() => { setStreamError(false); setNonce((n) => n + 1); }}>
                Retry stream
              </Button>
            )}
          </div>
        )}
      </div>
      {online && v?.status && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-2.5 text-xs text-muted">
          <span>FPS: <span className="num text-fg">{v.status.fps?.toFixed(1) ?? "—"}</span></span>
          <span>Device: <span className="text-fg">{v.status.camera_index ?? "—"}</span></span>
          <span>
            Mapped classes:{" "}
            <span className="text-fg">
              {Object.keys(v.status.mapped_classes ?? {}).length ? Object.entries(v.status.mapped_classes).map(([c, sku]) => `${c}→${sku}`).join(", ") : "none"}
            </span>
          </span>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------- Session binder */

function SessionBinder({ sessionId }: { sessionId: string | null }) {
  const sessions = useSessions({ status: "ACTIVE", limit: 50, offset: 0 }, 10_000);
  const qc = useQueryClient();
  const bind = useMutation({
    mutationFn: (id: string | null) => api.put(`/api/zones/${ZONE}`, { session_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zones"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => api.post<{ session: { id: string }; customer_token: string }>("/api/demo/sessions"),
    onSuccess: (r) => {
      toast.success(`Demo session ${r.session.id} created and bound to ${ZONE}`);
      qc.invalidateQueries({ queryKey: ["zones"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      navigator.clipboard?.writeText(`${window.location.origin}/shop?session=${r.session.id}&token=${r.customer_token}`).catch(() => {});
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const current = sessions.data?.items.find((s) => s.id === sessionId);

  return (
    <Card>
      <CardBody className="flex flex-wrap items-end gap-3">
        <Field label="Session monitored by this camera zone" htmlFor="bind" className="min-w-[240px] flex-1" hint="Attributing a camera event to a shopper is explicit in the prototype.">
          <NativeSelect id="bind" value={sessionId ?? ""} onChange={(e) => bind.mutate(e.target.value || null)} disabled={bind.isPending}>
            <option value="">— No session (events are logged as unassigned) —</option>
            {sessions.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} · {s.customer_label} {s.is_demo ? "(demo)" : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button variant="outline" loading={create.isPending} onClick={() => create.mutate()}>
          <Plus /> New demo session
        </Button>
        {current && (
          <Button asChild variant="ghost">
            <Link to={`/sessions/${current.id}`}>
              Open session <ExternalLink />
            </Link>
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------- Simulation */

function SimulationPanel({ sessionId }: { sessionId: string | null }) {
  const products = useProducts();
  const qc = useQueryClient();
  const [productId, setProductId] = useState("");
  const [eventType, setEventType] = useState<"PICKUP" | "RETURN">("PICKUP");
  const [confidence, setConfidence] = useState(0.86);
  const [frames, setFrames] = useState(10);
  const [track, setTrack] = useState("trk-sim-1");
  const [reason, setReason] = useState("");
  const [contradictory, setContradictory] = useState(false);
  const [weight, setWeight] = useState("-540");

  useEffect(() => {
    if (!productId && products.data?.length) setProductId(products.data[0].id);
  }, [products.data, productId]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["vision-events"] });
    qc.invalidateQueries({ queryKey: ["session"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
  };

  const inject = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ event: { state: string } }>("/api/demo/vision-events", { zone_id: ZONE, ...body }),
    onSuccess: (r) => {
      toast.success(`Simulated event → ${humanize(r.event.state)}`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sensor = useMutation({
    mutationFn: () => api.post("/api/demo/sensor-events", { zone_id: ZONE, delta_grams: Number(weight), calibration: { device: "simulated-hx711" } }),
    onSuccess: () => {
      toast.success(`Simulated weight change ${weight} g`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const scan = useMutation({
    mutationFn: () => {
      const p = products.data?.find((x) => x.id === productId);
      return api.post<{ status: string; message: string }>(`/api/demo/sessions/${sessionId}/scans`, {
        barcode: p?.barcode,
        method: "CAMERA_BARCODE",
        client_scan_id: uid("sim"),
      });
    },
    onSuccess: (r) => {
      toast.success(`Simulated scan: ${r.message}`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const finalize = useMutation({
    mutationFn: () => api.post<{ finalized: number }>(`/api/sessions/${sessionId}/reconcile`),
    onSuccess: (r) => {
      toast.success(`Finalised ${r.finalized} pending observation(s)`);
      refresh();
      qc.invalidateQueries({ queryKey: ["discrepancies"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const disabled = !sessionId;

  return (
    <Card className="border-sim/30">
      <CardHeader
        icon={<FlaskConical />}
        title={
          <span className="flex items-center gap-2">
            Simulation controls <Badge tone="sim">SIMULATED</Badge>
          </span>
        }
        description="Injects labelled events into the same reconciliation pipeline as the real camera."
      />
      <CardBody className="space-y-4">
        {disabled && <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">Bind a session to zone {ZONE} first (left).</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product" htmlFor="sim-product">
            <NativeSelect id="sim-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Camera event" htmlFor="sim-type">
            <NativeSelect id="sim-type" value={eventType} onChange={(e) => setEventType(e.target.value as "PICKUP" | "RETURN")}>
              <option value="PICKUP">Candidate pickup</option>
              <option value="RETURN">Candidate return</option>
            </NativeSelect>
          </Field>
          <Field label={`Model confidence · ${confidence.toFixed(2)}`} htmlFor="sim-conf">
            <input
              id="sim-conf"
              type="range"
              min={0.05}
              max={0.99}
              step={0.01}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-full accent-[#a78bfa]"
            />
          </Field>
          <Field label="Track frames / track ID" htmlFor="sim-frames">
            <div className="flex gap-2">
              <Input id="sim-frames" type="number" min={0} value={frames} onChange={(e) => setFrames(Number(e.target.value))} className="w-20" />
              <Input aria-label="Track ID" value={track} onChange={(e) => setTrack(e.target.value)} className="font-mono" />
            </div>
          </Field>
          <Field label="Uncertainty reason (optional)" htmlFor="sim-reason" className="sm:col-span-2">
            <Input id="sim-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Hand occludes most of the object" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <Switch checked={contradictory} onCheckedChange={setContradictory} /> Mark observations as contradictory
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={disabled}
            loading={inject.isPending}
            onClick={() =>
              inject.mutate({
                event_type: eventType,
                product_id: productId,
                model_confidence: confidence,
                track_frames: frames,
                track_id: track || null,
                uncertainty_reason: reason || null,
                contradictory,
              })
            }
          >
            <Play /> Inject camera event
          </Button>
          <Button variant="secondary" disabled={disabled} loading={scan.isPending} onClick={() => scan.mutate()}>
            <ScanBarcode /> Simulate scan
          </Button>
        </div>
        <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_auto]">
          <Field label="Shelf weight change (g)" htmlFor="sim-weight" hint="Supporting evidence only — weight cannot identify a product.">
            <Input id="sim-weight" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" className="font-mono" />
          </Field>
          <Button variant="secondary" className="self-start sm:mt-6" disabled={!/^-?\d+$/.test(weight)} loading={sensor.isPending} onClick={() => sensor.mutate()}>
            Send reading
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => inject.mutate({ event_type: "CAMERA_OFFLINE" })}>
            <CameraOff /> Simulate camera drop
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => inject.mutate({ event_type: "CAMERA_ONLINE" })}>
            <Camera /> Reconnect
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} loading={finalize.isPending} onClick={() => finalize.mutate()}>
            <FastForward /> Finalise pending now
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* --------------------------------------------------------- Lists & status */

function useNames() {
  const p = useProducts({ includeInactive: true });
  return useMemo(() => {
    const m = new Map(p.data?.map((x) => [x.id, x.name]) ?? []);
    return (id: string | null | undefined) => (id ? (m.get(id) ?? id) : "—");
  }, [p.data]);
}

function RecentScans({ sessionId }: { sessionId: string | null }) {
  const q = useSessionScans(sessionId ?? undefined);
  const name = useNames();
  return (
    <Card>
      <CardHeader icon={<ScanBarcode />} title="Recent barcode scans" />
      {!sessionId ? (
        <EmptyState title="No session selected" />
      ) : !q.data ? (
        <Skeleton className="m-4 h-24" />
      ) : q.data.length === 0 ? (
        <EmptyState title="No scans yet" description="Scans from the customer app appear instantly." />
      ) : (
        <ul className="max-h-[300px] divide-y divide-line/60 overflow-y-auto">
          {q.data.slice(0, 15).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[13px] text-fg">{name(s.product_id)}</p>
                <p className="num text-xs text-subtle">
                  {formatTime(s.occurred_at)} · {humanize(s.status)}
                  {s.matched_vision_event_id && <span className="text-ok"> · camera-verified</span>}
                </p>
              </div>
              <SourceBadge source={s.source} isSimulated={s.is_simulated} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentVision({ sessionId }: { sessionId: string | null }) {
  const q = useVisionEvents({ session_id: sessionId ?? undefined, limit: 20 });
  const name = useNames();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card>
      <CardHeader icon={<Radio />} title="Candidate camera events" description={sessionId ? undefined : "All zones (no session bound)"} />
      {!q.data ? (
        <Skeleton className="m-4 h-24" />
      ) : q.data.length === 0 ? (
        <EmptyState title="No camera events" description="Real detections or simulated events appear here." />
      ) : (
        <ul className="max-h-[300px] divide-y divide-line/60 overflow-y-auto">
          {q.data.map((v) => {
            const remaining = v.state === "OBSERVED" && v.finalize_after ? Math.max(0, Math.ceil((new Date(v.finalize_after).getTime() - Date.now()) / 1000)) : null;
            return (
              <li key={v.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] text-fg">
                    {humanize(v.event_type)} · {v.product_id ? name(v.product_id) : v.class_label ? `“${v.class_label}”` : "unidentified"}
                  </p>
                  <SourceBadge source={v.source} isSimulated={v.is_simulated} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-subtle">
                  <span className="num">{formatTime(v.occurred_at)}</span>
                  {v.model_confidence != null && <span className="num">model {pct(v.model_confidence)}</span>}
                  <VisionStateBadge state={v.state} />
                  {remaining != null && <span className="num text-accent">grace {remaining}s</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SessionDiscrepancyStatus({ sessionId }: { sessionId: string | null }) {
  const q = useDiscrepancies({ session_id: sessionId ?? "__none__", limit: 10, offset: 0 });
  return (
    <Card>
      <CardHeader
        icon={<ShieldAlert />}
        title="Discrepancy status"
        actions={
          sessionId && (
            <Link to={`/discrepancies?state=ALL`} className="text-xs text-accent hover:underline">
              Manage
            </Link>
          )
        }
      />
      {!sessionId ? (
        <EmptyState title="No session selected" />
      ) : !q.data ? (
        <Skeleton className="m-4 h-16" />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={<CheckCheck />} title="No discrepancies" description="Everything observed so far is explained by the cart." />
      ) : (
        <ul className="divide-y divide-line/60">
          {q.data.items.map((d) => (
            <li key={d.id}>
              <Link to={`/discrepancies?state=ALL&id=${d.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-2/60">
                <KindLabel kind={d.kind} />
                <StateBadge state={d.state} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Timeline({ sessionId }: { sessionId: string | null }) {
  const q = useAudit({ session_id: sessionId ?? "__none__", limit: 25, offset: 0 });
  return (
    <Card>
      <CardHeader icon={<Radio />} title="Synchronised event timeline" description="Scans, camera events and decisions in order." />
      {!sessionId ? (
        <EmptyState title="No session selected" />
      ) : !q.data ? (
        <Skeleton className="m-4 h-32" />
      ) : (
        <ol className="max-h-[420px] space-y-0 overflow-y-auto px-4 py-3">
          {q.data.items.map((a) => (
            <li key={a.id} className="relative flex gap-3 pb-3 last:pb-0">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "mt-1 size-2 rounded-full",
                    a.event_type === "BARCODE_SCAN" ? "bg-info" : a.event_type === "CAMERA_EVENT" ? (a.is_simulated ? "bg-sim" : "bg-accent") : a.event_type.includes("DISCREPANCY") ? "bg-warn" : a.event_type.includes("CHECKOUT_AUTHORIZED") ? "bg-ok" : "bg-subtle",
                  )}
                />
                <span className="w-px flex-1 bg-line" />
              </div>
              <div className="min-w-0 pb-1">
                <p className="text-[13px] leading-snug text-fg">{a.summary}</p>
                <p className="num text-[11px] text-subtle">
                  {formatTime(a.occurred_at)} · {humanize(a.event_type)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------- Demo run panel */

function DemoRunPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  useDemoRuns();
  const qc = useQueryClient();
  const run = useQuery({
    queryKey: ["demo-runs", runId],
    queryFn: () => api.get<DemoRun>(`/api/demo/runs/${runId}`),
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 800 : 4000),
  });
  const zones = useZones();
  const autoplay = useMutation({
    mutationFn: () => api.post<DemoRun>(`/api/demo/runs/${runId}/autoplay`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["demo-runs", runId] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const r = run.data;

  useEffect(() => {
    if (r?.session_id) qc.invalidateQueries({ queryKey: ["zones"] });
  }, [r?.session_id, qc]);

  if (run.isError)
    return (
      <Card className="border-warn/30">
        <CardBody className="flex items-center justify-between text-[13px] text-warn">
          {errorMessage(run.error)}
          <Button size="sm" variant="ghost" onClick={onClose}>
            Dismiss
          </Button>
        </CardBody>
      </Card>
    );
  if (!r) return <Skeleton className="h-40" />;

  const link = r.customer_link ? `${window.location.origin}${r.customer_link}` : null;
  const bound = zones.data?.find((z) => z.zone_id === ZONE)?.session_id === r.session_id;

  return (
    <Card className="border-sim/40 bg-gradient-to-br from-sim/[0.06] to-transparent">
      <CardHeader
        icon={<FlaskConical />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Scenario {r.scenario}: {r.title}
            <Badge tone={r.status === "COMPLETED" ? "ok" : r.status === "FAILED" ? "bad" : r.status === "RUNNING" ? "accent" : "warn"}>
              {humanize(r.status)}
            </Badge>
            <Badge tone="sim">SIMULATED</Badge>
          </span>
        }
        description={r.session_id ? <span>Session <Link className="font-mono text-accent hover:underline" to={`/sessions/${r.session_id}`}>{r.session_id}</Link>{bound ? " · monitored by this zone" : ""}</span> : "Starting…"}
        actions={
          <>
            {r.status === "WAITING_FOR_PRESENTER" && (
              <Button size="sm" variant="secondary" loading={autoplay.isPending} onClick={() => autoplay.mutate()}>
                <Play /> Autoplay rest
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        }
      />
      <CardBody className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <ol className="space-y-2">
          {r.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold",
                  s.status === "DONE" && "border-ok/40 bg-ok/15 text-ok",
                  s.status === "RUNNING" && "border-accent/50 bg-accent/15 text-accent",
                  s.status === "FAILED" && "border-bad/40 bg-bad/15 text-bad",
                  s.status === "AWAITING_PRESENTER" && "border-warn/50 bg-warn/15 text-warn",
                  (s.status === "PENDING" || s.status === "MANUAL") && "border-line-strong text-subtle",
                )}
              >
                {s.status === "DONE" ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <p className={cn("text-[13px]", s.status === "PENDING" || s.status === "MANUAL" ? "text-muted" : "text-fg")}>
                  {s.label}
                  {s.human && <span className="ml-2 text-[11px] text-warn">presenter step</span>}
                </p>
                {s.detail && <p className="text-xs text-muted">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
        <div className="space-y-3">
          <div className="rounded-lg border border-line bg-surface-2/60 p-3 text-[13px]">
            <p className="label-eyebrow mb-1">Presenter hint</p>
            <p className="text-fg">{r.hint}</p>
          </div>
          {link && (
            <div className="rounded-lg border border-line bg-surface-2/60 p-3">
              <p className="label-eyebrow mb-2 flex items-center gap-1.5">
                <Link2 className="size-3" /> Customer app for this session
              </p>
              <div className="flex gap-2">
                <Button asChild size="sm" variant="primary" className="flex-1">
                  <a href={link} target="_blank" rel="noreferrer">
                    Open <ExternalLink />
                  </a>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success("Customer link copied"))}
                >
                  <Copy /> Copy
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-subtle">Contains this session’s customer token — share only with the demo device.</p>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

