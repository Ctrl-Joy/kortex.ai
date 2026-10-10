/** Formatting helpers. Money is always integer paise from the backend. */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return "—";
  // Totals are computed by the backend in integer paise; this only renders them.
  const abs = Math.abs(paise);
  const text = inr.format(Number(`${Math.trunc(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`));
  return paise < 0 ? `−${text}` : text;
}

/** Parse a user-typed rupee amount ("40", "40.5", "40.50") into integer paise. */
export function parseRupeesToPaise(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function paiseToRupeeString(paise: number): string {
  return `${Math.trunc(paise / 100)}.${(paise % 100).toString().padStart(2, "0")}`;
}

const dateTime = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" });

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : "—";
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? timeOnly.format(new Date(iso)) : "—";
}

export function formatDay(isoDate: string): string {
  // isoDate is a UTC calendar day (YYYY-MM-DD)
  return dayLabel.format(new Date(`${isoDate}T12:00:00Z`));
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function pct(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}
