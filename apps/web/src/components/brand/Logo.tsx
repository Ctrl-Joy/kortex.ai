import { cn } from "@/lib/utils";

/** Original KORTEX mark: a geometric shield whose interior is a scan bracket
 * with a verification tick — "Scan It. Pick It. Verify It." */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden fill="none">
      <defs>
        <linearGradient id="kx-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5eead4" />
          <stop offset="1" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 27 6.6v8.7c0 6.6-4.5 11.9-11 14.2C9.5 27.2 5 21.9 5 15.3V6.6L16 2.5Z"
        fill="#0b1626"
        stroke="url(#kx-g)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10.5 11V9.5h2.5M21.5 11V9.5H19M10.5 18.5V20h2.5M21.5 18.5V20H19" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" />
      <path d="m12.6 14.9 2.4 2.4 4.6-4.8" stroke="url(#kx-g)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-[0.14em] text-fg">
            KORTEX<span className="ml-1 font-semibold tracking-normal text-accent">AI</span>
          </div>
          <div className="mt-1 text-[10px] font-medium tracking-[0.06em] text-subtle">Scan It. Pick It. Verify It.</div>
        </div>
      )}
    </div>
  );
}
