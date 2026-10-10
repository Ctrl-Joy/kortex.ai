import { DropdownMenu as DM, Switch as RSwitch, Tabs as RTabs, Tooltip as RTooltip } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- Skeleton */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-3/70", className)} aria-hidden />;
}

/* ----------------------------------------------------------------- Switch */
export function Switch({ className, ...props }: React.ComponentProps<typeof RSwitch.Root>) {
  return (
    <RSwitch.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-accent/50 data-[state=checked]:bg-accent/30 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RSwitch.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-muted transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent" />
    </RSwitch.Root>
  );
}

/* ------------------------------------------------------------------- Tabs */
export const Tabs = RTabs.Root;
export const TabsContent = RTabs.Content;

export function TabsList({ className, ...props }: React.ComponentProps<typeof RTabs.List>) {
  return (
    <RTabs.List
      className={cn(
        "flex w-full gap-1 overflow-x-auto border-b border-line px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof RTabs.Trigger>) {
  return (
    <RTabs.Trigger
      className={cn(
        "relative -mb-px flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------------------------------------------- Tooltip */
export const TooltipProvider = RTooltip.Provider;

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          sideOffset={6}
          className="z-[60] max-w-xs rounded-md border border-line-strong bg-surface-3 px-2.5 py-1.5 text-xs text-fg shadow-[var(--shadow-pop)] data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* ---------------------------------------------------------- Dropdown menu */
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={6}
        className={cn(
          "z-50 min-w-[200px] rounded-lg border border-line-strong bg-surface-2 p-1 shadow-[var(--shadow-pop)] data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-3 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2.5 py-1.5 text-xs text-subtle", className)} {...props} />;
}

export function DropdownMenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}

/* ------------------------------------------------------------ Empty state */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && (
        <div className="mb-3 grid size-11 place-items-center rounded-xl border border-line bg-surface-2 text-subtle [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Error state */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className="m-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm">
      <p className="font-medium text-bad">Couldn’t load this data</p>
      <p className="mt-0.5 text-muted">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 cursor-pointer text-[13px] font-medium text-accent hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Progress */
export function Meter({ value, tone = "accent", className }: { value: number; tone?: string; className?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const color =
    tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : tone === "bad" ? "bg-bad" : tone === "sim" ? "bg-sim" : "bg-accent";
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------- Key/Value */
export function KV({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-1 truncate text-[13px] text-fg">{children}</dd>
    </div>
  );
}
