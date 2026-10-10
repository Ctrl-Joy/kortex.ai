import {
  Bot,
  Camera,
  CircleCheck,
  CircleDashed,
  Clock,
  FlaskConical,
  Hand,
  Scale,
  ShieldAlert,
  Smartphone,
  UserCheck,
  XCircle,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/misc";
import { humanize } from "@/lib/utils";
import type { DiscrepancyKind, DiscrepancyState } from "@/types/api";

/** Event provenance. Real camera output and simulated events are never styled alike. */
export function SourceBadge({ source, isSimulated }: { source: string | null | undefined; isSimulated?: boolean }) {
  if (isSimulated || source === "SIMULATED" || source === "SENSOR_SIMULATED") {
    return (
      <Tooltip content="Injected by the deterministic demo simulator — not real sensor or camera output.">
        <Badge tone="sim">
          <FlaskConical /> SIMULATED
        </Badge>
      </Tooltip>
    );
  }
  switch (source) {
    case "CAMERA_LIVE":
      return (
        <Tooltip content="Produced by the KORTEX vision service from the live webcam.">
          <Badge tone="accent">
            <Camera /> LIVE CAMERA
          </Badge>
        </Tooltip>
      );
    case "SENSOR_LIVE":
      return (
        <Badge tone="accent">
          <Scale /> LIVE SENSOR
        </Badge>
      );
    case "MANUAL":
      return (
        <Badge tone="neutral">
          <Hand /> MANUAL
        </Badge>
      );
    case "CUSTOMER_APP":
      return (
        <Badge tone="info">
          <Smartphone /> CUSTOMER APP
        </Badge>
      );
    case "SYSTEM":
      return (
        <Badge tone="neutral">
          <Bot /> SYSTEM
        </Badge>
      );
    default:
      return <Badge tone="neutral">{humanize(source)}</Badge>;
  }
}

const STATE_TONE: Record<DiscrepancyState, BadgeTone> = {
  AWAITING_CUSTOMER: "warn",
  AWAITING_STAFF: "bad",
  ESCALATED: "bad",
  RESOLVED: "ok",
  DISMISSED: "neutral",
};

const STATE_LABEL: Record<DiscrepancyState, string> = {
  AWAITING_CUSTOMER: "Awaiting customer",
  AWAITING_STAFF: "Awaiting staff",
  ESCALATED: "Escalated",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export function StateBadge({ state }: { state: DiscrepancyState }) {
  const Icon =
    state === "RESOLVED" ? CircleCheck : state === "DISMISSED" ? XCircle : state === "AWAITING_CUSTOMER" ? Clock : ShieldAlert;
  return (
    <Badge tone={STATE_TONE[state]}>
      <Icon /> {STATE_LABEL[state]}
    </Badge>
  );
}

export const KIND_LABEL: Record<DiscrepancyKind, string> = {
  MISSED_SCAN: "Potential missed scan",
  WRONG_PRODUCT: "Possible wrong-product scan",
  DUPLICATE_SCAN: "Duplicate scan",
  UNCERTAIN_OBSERVATION: "Uncertain observation",
  PICKUP_RETURN: "Pickup followed by return",
  CONFLICTING_EVIDENCE: "Conflicting / incomplete evidence",
};

// Categorical identity colours in fixed order (validated for CVD separation on
// the dark surface). Always paired with a text label — never colour alone.
export const KIND_COLOR: Record<DiscrepancyKind, string> = {
  MISSED_SCAN: "#3987e5",
  WRONG_PRODUCT: "#d95926",
  DUPLICATE_SCAN: "#199e70",
  UNCERTAIN_OBSERVATION: "#c98500",
  PICKUP_RETURN: "#d55181",
  CONFLICTING_EVIDENCE: "#9085e9",
};

export function KindLabel({ kind }: { kind: DiscrepancyKind }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-fg">
      <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[kind] }} aria-hidden />
      {KIND_LABEL[kind]}
    </span>
  );
}

const VERIFICATION: Record<string, { tone: BadgeTone; label: string; icon: typeof CircleCheck }> = {
  VERIFIED: { tone: "ok", label: "Verified", icon: CircleCheck },
  VERIFYING: { tone: "accent", label: "Verifying", icon: CircleDashed },
  NEEDS_ATTENTION: { tone: "warn", label: "Needs attention", icon: ShieldAlert },
  CHECKED_OUT: { tone: "info", label: "Checked out", icon: UserCheck },
  CANCELLED: { tone: "neutral", label: "Cancelled", icon: XCircle },
};

export function VerificationBadge({ status }: { status: string }) {
  const v = VERIFICATION[status] ?? { tone: "neutral" as BadgeTone, label: humanize(status), icon: CircleDashed };
  const Icon = v.icon;
  return (
    <Badge tone={v.tone}>
      <Icon /> {v.label}
    </Badge>
  );
}

const CHECKOUT: Record<string, { tone: BadgeTone; label: string }> = {
  ELIGIBLE: { tone: "ok", label: "Eligible" },
  BLOCKED: { tone: "bad", label: "Blocked" },
  EMPTY_CART: { tone: "neutral", label: "Empty cart" },
  AUTHORIZED: { tone: "info", label: "Authorized" },
  EXITED: { tone: "info", label: "Exited" },
  NOT_STARTED: { tone: "neutral", label: "Not started" },
};

export function CheckoutBadge({ status }: { status: string }) {
  const c = CHECKOUT[status] ?? { tone: "neutral" as BadgeTone, label: humanize(status) };
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

export function SessionStatusBadge({ status }: { status: string }) {
  const tone: BadgeTone =
    status === "ACTIVE" ? "accent" : status === "CHECKOUT_AUTHORIZED" ? "ok" : status === "EXITED" ? "info" : "neutral";
  return (
    <Badge tone={tone} dot={status === "ACTIVE"}>
      {humanize(status)}
    </Badge>
  );
}

export function VisionStateBadge({ state }: { state: string }) {
  const tone: BadgeTone =
    state === "MATCHED" || state === "RESOLVED" || state === "RETURN_MATCHED" || state === "RETURNED"
      ? "ok"
      : state === "CANDIDATE_DISCREPANCY"
        ? "warn"
        : state === "OBSERVED"
          ? "accent"
          : "neutral";
  const label = state === "OBSERVED" ? "Pending scan" : humanize(state);
  return <Badge tone={tone}>{label}</Badge>;
}
