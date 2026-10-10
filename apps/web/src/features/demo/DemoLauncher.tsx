import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/form";
import { Skeleton, Switch } from "@/components/ui/misc";
import { useScenarios } from "@/hooks/queries";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DemoRun } from "@/types/api";

export function DemoLauncher({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState("C");
  const [fast, setFast] = useState(false);
  const [auto, setAuto] = useState(false);
  const scenarios = useScenarios();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const run = useMutation({
    mutationFn: () =>
      api.post<DemoRun>("/api/demo/scenarios", { scenario, fast, auto_complete: auto, step_delay_s: 1.2 }),
    onSuccess: (r) => {
      toast.success(`Scenario ${r.scenario} started`, { description: "A new labelled demo session was created." });
      qc.invalidateQueries({ queryKey: ["demo-runs"] });
      setOpen(false);
      navigate(`/live?run=${r.run_id}`);
    },
    onError: (e) => toast.error("Could not start the scenario", { description: errorMessage(e) }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary" size={compact ? "icon-sm" : "sm"} aria-label="Start demo">
          <Play />
          {!compact && "Start Demo"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Start a jury demo scenario"
        description="Each scenario creates a NEW demo session and runs through the real API, database and reconciliation engine. Existing data is never reset."
        className="max-w-2xl"
      >
        <div className="space-y-4 p-5">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Scenario">
            {scenarios.isLoading &&
              Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[68px]" />)}
            {scenarios.data?.map((s) => (
              <button
                key={s.code}
                role="radio"
                aria-checked={scenario === s.code}
                onClick={() => setScenario(s.code)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  scenario === s.code
                    ? "border-accent/60 bg-accent/5 shadow-[var(--shadow-glow)]"
                    : "border-line hover:border-line-strong hover:bg-surface-2",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md font-mono text-xs font-bold",
                    scenario === s.code ? "bg-accent text-[#04121a]" : "bg-surface-3 text-muted",
                  )}
                >
                  {s.code}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-fg">{s.title}</span>
                  <span className="block text-xs leading-snug text-muted">{s.summary}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 rounded-lg border border-line bg-surface-2/50 p-3 sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <Switch id="fast" checked={fast} onCheckedChange={setFast} />
              <div>
                <Label htmlFor="fast">Fast-forward grace window</Label>
                <p className="text-xs text-muted">Skips the real ~15 s wait for a matching scan. Logged in the audit trail.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Switch id="auto" checked={auto} onCheckedChange={setAuto} />
              <div>
                <Label htmlFor="auto">Autoplay human steps</Label>
                <p className="text-xs text-muted">Otherwise the run pauses so you can act as customer or staff in the UI.</p>
              </div>
            </div>
          </div>
          <p className="flex items-center gap-2 text-xs text-sim">
            <FlaskConical className="size-3.5" /> All injected scans, camera and sensor events are labelled SIMULATED.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
            <Play /> Run scenario {scenario}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
