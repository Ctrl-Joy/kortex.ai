import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Database, FlaskConical, Package, RotateCcw, Save, Server, SlidersHorizontal, Store, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useLive } from "@/app/live-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { ErrorState, KV, Skeleton, Switch, Tooltip } from "@/components/ui/misc";
import { useHealth, usePolicy, useProducts, useZones } from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { cn, humanize } from "@/lib/utils";
import type { PolicyInfo } from "@/types/api";

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <HealthGrid />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <PolicyCard />
        <div className="space-y-5">
          <StoreCard />
          <CameraPermissionCard />
        </div>
      </div>
    </div>
  );
}

function HealthTile({ icon, label, ok, warn, value, detail }: { icon: React.ReactNode; label: string; ok: boolean; warn?: boolean; value: string; detail?: string }) {
  const tone = warn ? "text-warn" : ok ? "text-ok" : "text-bad";
  const word = warn ? "Off" : ok ? "Healthy" : "Unavailable";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="grid size-8 place-items-center rounded-md border border-line bg-surface-2 text-muted [&_svg]:size-4">{icon}</span>
        <span className={cn("flex items-center gap-1.5 text-xs font-semibold", tone)}>
          <span className={cn("size-2 rounded-full", warn ? "bg-warn" : ok ? "bg-ok" : "bg-bad")} />
          {word}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-muted">{label}</p>
      <p className="text-sm font-semibold text-fg">{value}</p>
      {detail && <p className="mt-0.5 truncate text-xs text-subtle">{detail}</p>}
    </div>
  );
}

function HealthGrid() {
  const h = useHealth();
  const { status } = useLive();
  if (h.isError) return <ErrorState error={h.error} onRetry={() => h.refetch()} />;
  if (!h.data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  const d = h.data;
  return (
    <section aria-label="System health" className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HealthTile icon={<Server />} label="API" ok={d.api.ok} value={`v${d.api.version}`} detail={`Server time ${formatDateTime(d.time)}`} />
        <HealthTile icon={<Database />} label="Database" ok={d.database.ok} value="SQLite" detail={d.database.error ?? "Persistent local file"} />
        <HealthTile icon={<Wifi />} label="WebSocket" ok={status === "open"} warn={status === "connecting"} value={humanize(status)} detail="Real-time event stream" />
        <HealthTile
          icon={<Cpu />}
          label="Vision service"
          ok={d.vision.online}
          warn={!d.vision.online}
          value={d.vision.online ? "Online" : "Not running"}
          detail={d.vision.online ? "Heartbeat active" : "Start services/vision to enable"}
        />
      </div>
      <p className="flex items-center gap-2 text-xs text-muted">
        <FlaskConical className="size-3.5 text-sim" /> Simulation is always available and every simulated event is labelled.
      </p>
    </section>
  );
}

const POLICY_LABELS: Record<string, { label: string; unit?: string }> = {
  noise_floor: { label: "Ignore below" },
  uncertain_threshold: { label: "Ask to verify below" },
  mismatch_threshold: { label: "Suggest product swap from" },
  scan_grace_s: { label: "Wait for a scan", unit: "s" },
  scan_lead_s: { label: "Scan may come before pickup", unit: "s" },
  return_window_s: { label: "Return window", unit: "s" },
  scan_debounce_ms: { label: "Ignore repeat reads within", unit: "ms" },
  duplicate_scan_window_s: { label: "Confirm double scans within", unit: "s" },
  vision_dedupe_window_s: { label: "Merge duplicate camera events", unit: "s" },
  min_track_frames: { label: "Stable track after", unit: "frames" },
  sensor_window_s: { label: "Weight reading window", unit: "s" },
  sensor_noise_grams: { label: "Weight noise", unit: "g" },
  sensor_tolerance_ratio: { label: "Weight tolerance", unit: "×" },
  allow_customer_attestation_for_uncertain: { label: "Customers can self-confirm uncertain items" },
  coverage_gap_requires_staff_check: { label: "Camera outage needs a staff check" },
};

const POLICY_GROUPS: { title: string; keys: string[]; advanced?: boolean }[] = [
  { title: "Confidence", keys: ["noise_floor", "uncertain_threshold", "mismatch_threshold"] },
  { title: "Timing", keys: ["scan_grace_s", "scan_lead_s", "return_window_s"] },
  { title: "Workflow", keys: ["allow_customer_attestation_for_uncertain", "coverage_gap_requires_staff_check"] },
  {
    title: "Advanced",
    advanced: true,
    keys: ["scan_debounce_ms", "duplicate_scan_window_s", "vision_dedupe_window_s", "min_track_frames", "sensor_window_s", "sensor_noise_grams", "sensor_tolerance_ratio"],
  },
];

function PolicyCard() {
  const q = usePolicy();
  const auth = useAuth();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isManager = auth?.staff.role === "MANAGER";

  useEffect(() => {
    if (q.data) setDraft(Object.fromEntries(Object.entries(q.data.values).map(([k, v]) => [k, typeof v === "boolean" ? v : String(v)])));
  }, [q.data]);

  const save = useMutation({
    mutationFn: (values: Record<string, number | boolean>) => api.put<PolicyInfo>("/api/settings/policy", { values }),
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["policy"] });
    },
    onError: (e) => toast.error("Not saved", { description: errorMessage(e) }),
  });
  const reset = useMutation({
    mutationFn: () => api.post<PolicyInfo>("/api/settings/policy/reset"),
    onSuccess: () => {
      toast.success("Reset to defaults");
      qc.invalidateQueries({ queryKey: ["policy"] });
    },
  });

  if (q.isError) return <ErrorState error={q.error} />;
  const p = q.data;

  const changed = p
    ? Object.entries(draft).filter(([k, v]) => (typeof v === "boolean" ? v !== p.values[k] : Number(v) !== p.values[k]))
    : [];

  const submit = () => {
    const values: Record<string, number | boolean> = {};
    for (const [k, v] of changed) values[k] = typeof v === "boolean" ? v : Number(v);
    save.mutate(values);
  };

  return (
    <Card>
      <CardHeader
        icon={<SlidersHorizontal />}
        title="Reconciliation settings"
        description="Demo defaults — not scientifically validated."
        actions={
          isManager && (
            <>
              <Button size="sm" variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>
                <RotateCcw /> Defaults
              </Button>
              <Button size="sm" variant="primary" disabled={changed.length === 0} loading={save.isPending} onClick={submit}>
                <Save /> Save{changed.length ? ` (${changed.length})` : ""}
              </Button>
            </>
          )
        }
      />
      <CardBody className="space-y-5">
        {!isManager && <p className="text-xs text-muted">Read-only — only a store manager can change these.</p>}
        {!p ? (
          <Skeleton className="h-64" />
        ) : (
          POLICY_GROUPS.map((g) => {
            if (g.advanced && !showAdvanced) {
              return (
                <button
                  key={g.title}
                  onClick={() => setShowAdvanced(true)}
                  className="cursor-pointer text-[13px] font-medium text-accent hover:underline"
                >
                  Show advanced settings ({g.keys.length})
                </button>
              );
            }
            return (
              <fieldset key={g.title}>
                <legend className="label-eyebrow mb-1">{g.title}</legend>
                <div className="divide-y divide-line/60">
                  {g.keys.map((k) => {
                    const v = draft[k];
                    const meta = POLICY_LABELS[k] ?? { label: humanize(k) };
                    const isDefault = typeof v === "boolean" ? v === p.defaults[k] : Number(v) === p.defaults[k];
                    return (
                      <div key={k} className="flex items-center justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <Tooltip content={<span>{p.descriptions[k]}<br /><span className="font-mono text-subtle">{k}</span></span>}>
                            <label htmlFor={k} className="cursor-help text-[13px] text-fg">
                              {meta.label}
                            </label>
                          </Tooltip>
                          {!isDefault && <span className="ml-2 text-[11px] text-accent">default {String(p.defaults[k])}</span>}
                        </div>
                        {typeof v === "boolean" ? (
                          <Switch id={k} checked={v} disabled={!isManager} onCheckedChange={(c) => setDraft((d) => ({ ...d, [k]: c }))} />
                        ) : (
                          <div className="flex shrink-0 items-center gap-1.5">
                            <Input
                              id={k}
                              type="number"
                              step="any"
                              min={p.bounds[k]?.[0]}
                              max={p.bounds[k]?.[1]}
                              value={v ?? ""}
                              disabled={!isManager}
                              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                              className="h-8 w-24 text-right font-mono"
                            />
                            <span className="w-10 text-xs text-subtle">{meta.unit ?? ""}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            );
          })
        )}
      </CardBody>
    </Card>
  );
}

function StoreCard() {
  const zones = useZones();
  const products = useProducts({ includeInactive: true });
  return (
    <Card>
      <CardHeader icon={<Store />} title="Store, catalogue & demo sessions" />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-4">
          <KV label="Store">KORTEX Demo Store</KV>
          <KV label="Location">Bengaluru · Koramangala</KV>
          <KV label="Catalogue">
            {products.data ? `${products.data.items.filter((p) => p.active).length} active / ${products.data.total} total` : "…"}
          </KV>
          <KV label="Currency">INR (integer paise)</KV>
        </dl>
        <div>
          <p className="label-eyebrow mb-2">Camera zones</p>
          {zones.data?.map((z) => (
            <div key={z.zone_id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-[13px]">
              <div>
                <p className="font-medium text-fg">{z.zone_id}</p>
                <p className="text-xs text-subtle">{z.label}</p>
              </div>
              {z.session_id ? (
                <Link to={`/sessions/${z.session_id}`} className="font-mono text-xs text-accent hover:underline">
                  {z.session_id}
                </Link>
              ) : (
                <span className="text-xs text-subtle">No session bound</span>
              )}
            </div>
          ))}
          <p className="mt-2 text-xs text-subtle">
            The prototype attributes camera events to the session bound to a zone. Change it in Live Monitoring.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/products">
              <Package /> Manage catalogue
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/live">
              <FlaskConical /> Demo controls
            </Link>
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function CameraPermissionCard() {
  const [state, setState] = useState<string>("unknown");
  const secure = typeof window !== "undefined" && window.isSecureContext;
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((s) => {
        if (cancelled) return;
        setState(s.state);
        s.onchange = () => setState(s.state);
      })
      .catch(() => setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Card>
      <CardHeader icon={<Camera />} title="This browser’s camera access" description="Used by the customer barcode scanner." />
      <CardBody className="space-y-2 text-[13px]">
        <div className="flex justify-between">
          <span className="text-muted">Permission</span>
          <Badge tone={state === "granted" ? "ok" : state === "denied" ? "bad" : "neutral"}>{humanize(state)}</Badge>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Secure context (HTTPS / localhost)</span>
          <Badge tone={secure ? "ok" : "warn"}>{secure ? "Yes" : "No"}</Badge>
        </div>
        {!secure && <p className="text-xs text-warn">Browsers block cameras on plain HTTP LAN addresses. Use the HTTPS dev mode for phones (see README).</p>}
      </CardBody>
    </Card>
  );
}
