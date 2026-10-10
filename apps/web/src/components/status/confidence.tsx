import { Info } from "lucide-react";
import { Meter, Tooltip } from "@/components/ui/misc";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Factor } from "@/types/api";

function toneFor(v: number | null | undefined) {
  if (v == null) return "accent";
  if (v >= 0.8) return "ok";
  if (v >= 0.55) return "accent";
  if (v >= 0.2) return "warn";
  return "bad";
}

/** Shows model confidence (detector output) and reconciliation confidence
 * (all evidence combined) side by side — they are deliberately separate. */
export function ConfidencePair({
  model,
  reconciliation,
  className,
}: {
  model: number | null | undefined;
  reconciliation: number | null | undefined;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-4", className)}>
      <div>
        <div className="flex items-center gap-1.5">
          <span className="label-eyebrow">Model confidence</span>
          <Tooltip content="Raw score reported by the detector for this observation. Not a probability of wrongdoing.">
            <Info className="size-3 text-subtle" aria-label="About model confidence" />
          </Tooltip>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Meter value={model ?? 0} tone={toneFor(model)} />
          <span className="num w-9 text-right text-[13px] font-semibold">{pct(model)}</span>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <span className="label-eyebrow">Reconciliation</span>
          <Tooltip content="KORTEX's combined score after weighing tracking stability, weight sensor and other evidence.">
            <Info className="size-3 text-subtle" aria-label="About reconciliation confidence" />
          </Tooltip>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Meter value={reconciliation ?? 0} tone={toneFor(reconciliation)} />
          <span className="num w-9 text-right text-[13px] font-semibold">{pct(reconciliation)}</span>
        </div>
      </div>
    </div>
  );
}

export function FactorList({ factors }: { factors: Factor[] }) {
  if (!factors.length) return <p className="text-[13px] text-muted">No scored evidence for this decision.</p>;
  return (
    <ul className="divide-y divide-line/70 rounded-md border border-line">
      {factors.map((f, i) => (
        <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-fg">{f.label}</p>
            <p className="text-xs text-muted">{f.detail}</p>
          </div>
          <span
            className={cn(
              "num shrink-0 font-mono text-xs font-semibold",
              i === 0 ? "text-fg" : f.delta >= 0 ? "text-ok" : "text-bad",
            )}
          >
            {i === 0 ? f.delta.toFixed(2) : `${f.delta >= 0 ? "+" : "−"}${Math.abs(f.delta).toFixed(2)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
