import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium leading-none whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-surface-3 text-muted",
        accent: "bg-accent/12 text-accent",
        ok: "bg-ok/12 text-ok",
        warn: "bg-warn/12 text-warn",
        bad: "bg-bad/12 text-bad",
        info: "bg-surface-3 text-fg",
        sim: "bg-sim/14 text-sim",
      },
      size: {
        sm: "",
        md: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
