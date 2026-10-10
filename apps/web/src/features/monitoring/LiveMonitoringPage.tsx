import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CameraOff,
  ChevronDown,
  CircleDot,
  Copy,
  ExternalLink,
  FastForward,
  FlaskConical,
  Play,
  Plus,
  ScanBarcode,
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
import { EmptyState, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/misc";
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
// The webcam preview is served by the vision service on the demo laptop. In local
// development Vite proxies it at /vision; a hosted build (e.g. Vercel) has no
// such proxy unless VITE_VISION_BASE_URL points at a reachable vision service.
const VISION_BASE: string | null =
  (import.meta.env.VITE_VISION_BASE_URL as string | undefined)?.replace(/\/$/, "") || (import.meta.env.DEV ? "/vision" : null);

export default function LiveMonitoringPage() {
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const zones = useZones();
  const sessionId = zones.data?.find((z) => z.zone_id === ZONE)?.session_id ?? null;

  return (
    <div className="space-y-5">
      {runId && <DemoRunPanel runId={runId} onClose={() => setParams({}, { replace: true })} />}
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <CameraPanel sessionId={sessionId} />
        <SimulationPanel sessionId={sessionId} />
      </div>
      <ActivityPanel sessionId={sessionId} />
    </div>
  );
}

/* ------------------------------------------------------------------ Camera */

function CameraPanel({ sessionId }: { sessionId: string | null }) {
  const vision = useVisionStatus();
  const v = vision.data;
  const online = !!v?.online;
  const camLive = online && v?.status?.camera_status === "ONLINE";
  const paused = online && v?.status?.camera_status === "PAUSED";
  const [streamError, setStreamError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const qc = useQueryClient();

  useEffect(() => {
    if (camLive) setStreamError(false);
  }, [camLive]);

  const toggle = useMutation({
    mutationFn: (action: "pause" | "resume") => api.post(`${VISION_BASE}/camera/${action}`, undefined, "none"),
    onSuccess: (_r, action) => {
      toast.success(action === "pause" ? "Webcam released — the barcode scanner can use it now" : "Webcam resumed");
      setTimeout(() => qc.invalidateQueries({ queryKey: ["vision-status"] }), 800);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const mapped = Object.entries(v?.status?.mapped_classes ?? {});

  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={camLive ? <Camera /> : <CameraOff />}
        title="Shelf camera"
        description={`Zone ${ZONE}`}
        actions={
          <>
            {camLive && VISION_BASE && (
              <Tooltip content="Free the webcam so the customer barcode scanner on this laptop can use it">
                <Button size="sm" variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate("pause")}>
                  <CameraOff /> <span className="hidden sm:inline">Release webcam</span>
                </Button>
              </Tooltip>
            )}
            {paused && VISION_BASE && (
              <Button size="sm" variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate("resume")}>
                <Camera /> Resume
              </Button>
            )}
            {camLive ? (
              <Badge tone="accent" size="md">
                <CircleDot className="animate-pulse" /> LIVE
              </Badge>
            ) : (
              <Badge tone="neutral" size="md">
                {paused ? "Released" : "Offline"}
              </Badge>
            )}
          </>
        }
      />
      <div className="relative aspect-video w-full bg-canvas">
        {camLive && !VISION_BASE ? (
          <div className="grid-bg flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Camera className="size-6 text-accent" />
            <p className="text-sm font-medium text-fg">Camera is live on the demo laptop</p>
            <p className="mx-auto max-w-sm text-[13px] text-muted">
              Its detections reach this site as LIVE CAMERA events. The video preview itself is only shown on the laptop running the vision service.
            </p>
          </div>
        ) : camLive && !streamError ? (
          <img
            key={nonce}
            src={`${VISION_BASE}/stream.mjpg?n=${nonce}`}
            alt="Live shelf camera with detector overlay"
            className="h-full w-full object-contain"
            onError={() => setStreamError(true)}
          />
        ) : (
          <div className="grid-bg flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="size-6 text-subtle" />
            <div>
              <p className="text-sm font-medium text-fg">
                {paused
                  ? "Webcam released"
                  : online
                    ? streamError
                      ? "Stream unavailable"
                      : `Camera ${humanize(v?.status?.camera_status)}`
                    : "Vision service not running"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">
                {paused
                  ? "The barcode scanner can use it now. Nothing on the shelf is observed until you resume."
                  : online
                    ? (v?.status?.message ?? "Check that no other app is using the webcam.")
                    : "Simulation still works. Start the service to use the real camera:"}
              </p>
            </div>
            {!online && (
              <code className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 font-mono text-xs text-muted">
                <Terminal className="size-3.5" /> scripts\start-vision.ps1
              </code>
            )}
            {online && streamError && (
              <Button size="sm" variant="outline" onClick={() => { setStreamError(false); setNonce((n) => n + 1); }}>
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-muted sm:px-5">
        {camLive ? (
          <>
            <span>
              {v?.status?.model_name} · <span className="num">{v?.status?.fps?.toFixed(1)}</span> detections/s
            </span>
            <Tooltip content={mapped.length ? mapped.map(([c, sku]) => `${c} → ${sku}`).join(", ") : "No catalogue products are mapped to detector classes"}>
              <span className="cursor-help underline decoration-dotted underline-offset-2">Generic classes, not SKUs</span>
            </Tooltip>
            <span>Boxes = real model output · no frames stored</span>
          </>
        ) : (
          <span>Real camera events appear as LIVE CAMERA; simulated ones as SIMULATED.</span>
        )}
      </div>
      <SessionBinder sessionId={sessionId} />
    </Card>
  );
}

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
      toast.success(`Demo session ${r.session.id} is now monitored`, { description: "Customer link copied to clipboard." });
      qc.invalidateQueries({ queryKey: ["zones"] });
      qc.invalidateQueries({ queryKey: ["sessions"] });
      navigator.clipboard?.writeText(`${window.location.origin}/shop?session=${r.session.id}&token=${r.customer_token}`).catch(() => {});
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-4 py-3 sm:px-5">
      <label htmlFor="bind" className="text-[13px] text-muted">
        Watching
      </label>
      <NativeSelect
        id="bind"
        value={sessionId ?? ""}
        onChange={(e) => bind.mutate(e.target.value || null)}
        disabled={bind.isPending}
        className="h-8 min-w-0 flex-1 basis-48"
      >
        <option value="">No session — events are logged as unassigned</option>
        {sessions.data?.items.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id} · {s.customer_label}
            {s.is_demo ? " (demo)" : ""}
          </option>
        ))}
      </NativeSelect>
      <Button size="sm" variant="outline" loading={create.isPending} onClick={() => create.mutate()}>
        <Plus /> New demo session
      </Button>
      {sessionId && (
        <Button asChild size="sm" variant="ghost">
          <Link to={`/sessions/${sessionId}`}>
            Open <ExternalLink />
          </Link>
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Simulation */

function SimulationPanel({ sessionId }: { sessionId: string | null }) {
  const products = useProducts();
  const qc = useQueryClient();
  const [productId, setProductId] = useState("");
  const [eventType, setEventType] = useState<"PICKUP" | "RETURN">("PICKUP");
  const [confidence, setConfidence] = useState(0.86);
  const [more, setMore] = useState(false);
  const [frames, setFrames] = useState(10);
  const [track, setTrack] = useState("trk-sim-1");
  const [reason, setReason] = useState("");
  const [contradictory, setContradictory] = useState(false);
  const [weight, setWeight] = useState("-540");

  useEffect(() => {
    if (!productId && products.data?.length) setProductId(products.data[0].id);
  }, [products.data, productId]);

  const refresh = () => {
    for (const key of ["vision-events", "session", "audit", "discrepancies"]) qc.invalidateQueries({ queryKey: [key] });
  };
  const onError = (e: unknown) => toast.error(errorMessage(e));

  const inject = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ event: { state: string } }>("/api/demo/vision-events", { zone_id: ZONE, ...body }),
    onSuccess: (r) => {
      toast.success(`Simulated event → ${humanize(r.event.state)}`);
      refresh();
    },
    onError,
  });
  const sensor = useMutation({
    mutationFn: () => api.post("/api/demo/sensor-events", { zone_id: ZONE, delta_grams: Number(weight), calibration: { device: "simulated-hx711" } }),
    onSuccess: () => {
      toast.success(`Simulated weight change ${weight} g`);
      refresh();
    },
    onError,
  });
  const scan = useMutation({
    mutationFn: () => {
      const p = products.data?.find((x) => x.id === productId);
      return api.post<{ message: string }>(`/api/demo/sessions/${sessionId}/scans`, {
        barcode: p?.barcode,
        method: "CAMERA_BARCODE",
        client_scan_id: uid("sim"),
      });
    },
    onSuccess: (r) => {
      toast.success(`Simulated scan: ${r.message}`);
      refresh();
    },
    onError,
  });
  const finalize = useMutation({
    mutationFn: () => api.post<{ finalized: number }>(`/api/sessions/${sessionId}/reconcile`),
    onSuccess: (r) => {
      toast.success(`Decided ${r.finalized} pending observation(s)`);
      refresh();
    },
    onError,
  });

  const disabled = !sessionId;

  return (
    <Card className="border-sim/30">
      <CardHeader
        icon={<FlaskConical />}
        title={
          <span className="flex items-center gap-2">
            Simulate <Badge tone="sim">SIMULATED</Badge>
          </span>
        }
        description="Labelled test events through the real pipeline."
      />
      <CardBody className="space-y-4">
        {disabled && (
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            Choose a session to watch (camera card) to enable simulation.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product" htmlFor="sim-product">
            <NativeSelect id="sim-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Camera sees" htmlFor="sim-type">
            <NativeSelect id="sim-type" value={eventType} onChange={(e) => setEventType(e.target.value as "PICKUP" | "RETURN")}>
              <option value="PICKUP">Pickup</option>
              <option value="RETURN">Return</option>
            </NativeSelect>
          </Field>
        </div>
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
            <Play /> Send camera event
          </Button>
          <Button variant="secondary" disabled={disabled} loading={scan.isPending} onClick={() => scan.mutate()}>
            <ScanBarcode /> Scan it
          </Button>
        </div>

        <button
          className="flex w-full cursor-pointer items-center justify-between border-t border-line pt-3 text-[13px] font-medium text-muted hover:text-fg"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
        >
          More options
          <ChevronDown className={cn("size-4 transition-transform", more && "rotate-180")} />
        </button>
        {more && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Track frames" htmlFor="sim-frames">
                <Input id="sim-frames" type="number" min={0} value={frames} onChange={(e) => setFrames(Number(e.target.value))} />
              </Field>
              <Field label="Track ID" htmlFor="sim-track" hint="Same ID links pickup ↔ return">
                <Input id="sim-track" value={track} onChange={(e) => setTrack(e.target.value)} className="font-mono" />
              </Field>
            </div>
            <Field label="Uncertainty reason" htmlFor="sim-reason">
              <Input id="sim-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Hand covers the item" />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <Switch checked={contradictory} onCheckedChange={setContradictory} /> Contradictory observations
            </label>
            <div className="flex items-end gap-2">
              <Field label="Shelf weight change (g)" htmlFor="sim-weight" className="flex-1" hint="Supporting evidence only">
                <Input id="sim-weight" value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="numeric" className="font-mono" />
              </Field>
              <Button variant="secondary" className="mb-5" disabled={!/^-?\d+$/.test(weight)} loading={sensor.isPending} onClick={() => sensor.mutate()}>
                Send
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => inject.mutate({ event_type: "CAMERA_OFFLINE" })}>
                <CameraOff /> Camera drop
              </Button>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => inject.mutate({ event_type: "CAMERA_ONLINE" })}>
                <Camera /> Reconnect
              </Button>
              <Tooltip content="Decide pending pickups now instead of waiting for the scan grace window">
                <Button size="sm" variant="outline" disabled={disabled} loading={finalize.isPending} onClick={() => finalize.mutate()}>
                  <FastForward /> Decide now
                </Button>
              </Tooltip>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/* --------------------------------------------------------------- Activity */

function useNames() {
  const p = useProducts({ includeInactive: true });
  return useMemo(() => {
    const m = new Map(p.data?.map((x) => [x.id, x.name]) ?? []);
    return (id: string | null | undefined) => (id ? (m.get(id) ?? id) : "—");
  }, [p.data]);
}

function ActivityPanel({ sessionId }: { sessionId: string | null }) {
  const alerts = useDiscrepancies({ session_id: sessionId ?? "__none__", limit: 20, offset: 0 });
  const open = alerts.data?.items.filter((d) => ["AWAITING_CUSTOMER", "AWAITING_STAFF", "ESCALATED"].includes(d.state)).length ?? 0;

  return (
    <Card className="overflow-hidden">
      <Tabs defaultValue="timeline">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pl-1 pr-4">
          <TabsList className="w-auto border-0">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="camera">Camera events</TabsTrigger>
            <TabsTrigger value="scans">Scans</TabsTrigger>
            <TabsTrigger value="alerts">
              Alerts {open > 0 && <span className="num rounded-sm bg-warn/15 px-1.5 text-[11px] font-semibold text-warn">{open}</span>}
            </TabsTrigger>
          </TabsList>
          {sessionId && (
            <Link to={`/sessions/${sessionId}`} className="font-mono text-xs text-accent hover:underline">
              {sessionId}
            </Link>
          )}
        </div>
        <TabsContent value="timeline">
          {sessionId ? <Timeline sessionId={sessionId} /> : <NoSession />}
        </TabsContent>
        <TabsContent value="camera">
          <CameraEvents sessionId={sessionId} />
        </TabsContent>
        <TabsContent value="scans">{sessionId ? <Scans sessionId={sessionId} /> : <NoSession />}</TabsContent>
        <TabsContent value="alerts">
          {!sessionId ? (
            <NoSession />
          ) : !alerts.data ? (
            <Skeleton className="m-4 h-16" />
          ) : alerts.data.items.length === 0 ? (
            <EmptyState title="No alerts" description="Everything the camera saw is explained by the cart." />
          ) : (
            <ul className="divide-y divide-line/60">
              {alerts.data.items.map((d) => (
                <li key={d.id}>
                  <Link to={`/discrepancies?state=ALL&id=${d.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-surface-2/60">
                    <KindLabel kind={d.kind} />
                    <StateBadge state={d.state} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}

function NoSession() {
  return <EmptyState title="No session being watched" description="Pick one in the camera card, or start a demo." />;
}

function Timeline({ sessionId }: { sessionId: string }) {
  const q = useAudit({ session_id: sessionId, limit: 30, offset: 0 });
  if (!q.data) return <Skeleton className="m-4 h-32" />;
  if (!q.data.items.length) return <EmptyState title="Nothing yet" />;
  return (
    <ol className="max-h-[420px] overflow-y-auto px-5 py-3">
      {q.data.items.map((a) => (
        <li key={a.id} className="flex gap-3 py-1.5">
          <span className="num w-[68px] shrink-0 pt-px text-[11px] text-subtle">{formatTime(a.occurred_at)}</span>
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              a.event_type === "BARCODE_SCAN"
                ? "bg-info"
                : a.event_type === "CAMERA_EVENT"
                  ? a.is_simulated
                    ? "bg-sim"
                    : "bg-accent"
                  : a.event_type.includes("DISCREPANCY") || a.event_type.includes("DENIED")
                    ? "bg-warn"
                    : a.event_type.includes("AUTHORIZED") || a.event_type.includes("EXIT")
                      ? "bg-ok"
                      : "bg-subtle",
            )}
            aria-hidden
          />
          <span className="min-w-0 text-[13px] leading-snug text-fg">{a.summary}</span>
        </li>
      ))}
    </ol>
  );
}

function Scans({ sessionId }: { sessionId: string }) {
  const q = useSessionScans(sessionId);
  const name = useNames();
  if (!q.data) return <Skeleton className="m-4 h-24" />;
  if (!q.data.length) return <EmptyState title="No scans yet" description="Scans from the customer app appear instantly." />;
  return (
    <ul className="max-h-[420px] divide-y divide-line/60 overflow-y-auto">
      {q.data.slice(0, 30).map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-fg">{name(s.product_id)}</p>
            <p className="num text-xs text-subtle">
              {formatTime(s.occurred_at)} · {humanize(s.status)}
              {s.matched_vision_event_id && <span className="text-ok"> · seen by camera</span>}
            </p>
          </div>
          <SourceBadge source={s.source} isSimulated={s.is_simulated} />
        </li>
      ))}
    </ul>
  );
}

function CameraEvents({ sessionId }: { sessionId: string | null }) {
  const q = useVisionEvents({ session_id: sessionId ?? undefined, limit: 30 });
  const name = useNames();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!q.data) return <Skeleton className="m-4 h-24" />;
  if (!q.data.length) return <EmptyState title="No camera events yet" description="Real detections and simulated events appear here." />;
  return (
    <ul className="max-h-[420px] divide-y divide-line/60 overflow-y-auto">
      {q.data.map((v) => {
        const remaining =
          v.state === "OBSERVED" && v.finalize_after ? Math.max(0, Math.ceil((new Date(v.finalize_after).getTime() - Date.now()) / 1000)) : null;
        return (
          <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-fg">
                {humanize(v.event_type)} · {v.product_id ? name(v.product_id) : v.class_label ? `“${v.class_label}”` : "unidentified"}
              </p>
              <p className="num text-xs text-subtle">
                {formatTime(v.occurred_at)}
                {v.model_confidence != null && ` · model ${pct(v.model_confidence)}`}
                {remaining != null && <span className="text-accent"> · waiting for scan {remaining}s</span>}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <VisionStateBadge state={v.state} />
              <SourceBadge source={v.source} isSimulated={v.is_simulated} />
            </div>
          </li>
        );
      })}
    </ul>
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
  if (!r) return <Skeleton className="h-32" />;

  const link = r.customer_link ? `${window.location.origin}${r.customer_link}` : null;
  const done = r.steps.filter((s) => s.status === "DONE").length;

  return (
    <Card className="border-sim/40 bg-gradient-to-br from-sim/[0.06] to-transparent">
      <CardHeader
        icon={<FlaskConical />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            Scenario {r.scenario} · {r.title}
            <Badge tone={r.status === "COMPLETED" ? "ok" : r.status === "FAILED" ? "bad" : r.status === "RUNNING" ? "accent" : "warn"}>
              {r.status === "WAITING_FOR_PRESENTER" ? "Your turn" : humanize(r.status)}
            </Badge>
          </span>
        }
        description={
          <span className="num">
            Step {done}/{r.steps.length}
            {r.session_id && (
              <>
                {" · "}
                <Link className="font-mono text-accent hover:underline" to={`/sessions/${r.session_id}`}>
                  {r.session_id}
                </Link>
              </>
            )}
          </span>
        }
        actions={
          <>
            {link && (
              <>
                <Button asChild size="sm" variant="primary">
                  <a href={link} target="_blank" rel="noreferrer">
                    Customer app <ExternalLink />
                  </a>
                </Button>
                <Tooltip content="Copy the customer link (contains this session’s token)">
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    aria-label="Copy customer link"
                    onClick={() => navigator.clipboard?.writeText(link).then(() => toast.success("Customer link copied"))}
                  >
                    <Copy />
                  </Button>
                </Tooltip>
              </>
            )}
            {r.status === "WAITING_FOR_PRESENTER" && (
              <Button size="sm" variant="secondary" loading={autoplay.isPending} onClick={() => autoplay.mutate()}>
                <Play /> Autoplay
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        }
      />
      <CardBody className="space-y-3">
        {r.status === "WAITING_FOR_PRESENTER" && <p className="text-[13px] text-warn">{r.hint}</p>}
        <ol className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {r.steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
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
                  {s.human && s.status !== "DONE" && <span className="ml-1.5 text-[11px] text-warn">you</span>}
                </p>
                {s.detail && <p className="line-clamp-2 text-xs text-muted">{s.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
