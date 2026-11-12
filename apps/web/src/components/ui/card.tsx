import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({
  className,
  title,
  description,
  icon,
  actions,
  children,
}: {
  className?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="mt-0.5 shrink-0 text-subtle [&_svg]:size-4">{icon}</div>}
        <div className="min-w-0">
          {title && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
          {description && <p className="mt-0.5 text-[13px] text-subtle">{description}</p>}
          {children}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4 sm:px-5", className)} {...props} />;
}
