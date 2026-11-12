import { cn } from "@/lib/utils";

/** Original KORTEX mark: a scan bracket closing around a verification tick. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden fill="none">
      <rect width="32" height="32" rx="8" fill="#ececee" />
      <path
        d="M9 13V10.5A1.5 1.5 0 0 1 10.5 9H13M19 9h2.5A1.5 1.5 0 0 1 23 10.5V13M23 19v2.5a1.5 1.5 0 0 1-1.5 1.5H19M13 23h-2.5A1.5 1.5 0 0 1 9 21.5V19"
        stroke="#0b0c0e"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="m12.6 16.2 2.4 2.4 4.6-4.9" stroke="#1597ab" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && <span className="text-[15px] font-semibold tracking-[0.08em] text-fg">KORTEX</span>}
    </div>
  );
}
