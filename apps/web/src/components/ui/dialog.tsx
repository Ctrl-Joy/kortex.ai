import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  className,
  children,
  title,
  description,
  side,
  ...props
}: React.ComponentProps<typeof D.Content> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  side?: "center" | "right";
}) {
  const isSheet = side === "right";
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col border border-line-strong bg-surface shadow-[var(--shadow-pop)] focus:outline-none",
          isSheet
            ? "inset-y-0 right-0 h-dvh w-full max-w-xl border-y-0 border-r-0 max-sm:border-l-0 data-[state=open]:animate-fade-in"
            : "left-1/2 top-1/2 max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl data-[state=open]:animate-fade-in",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <D.Title className="text-base font-semibold text-fg">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-[13px] text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</D.Description>
            )}
          </div>
          <D.Close className="-mr-1 grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-11" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 border-t border-line px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
