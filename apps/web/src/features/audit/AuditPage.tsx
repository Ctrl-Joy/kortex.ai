import { ChevronDown, ScrollText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/table";
import { useAudit, useAuditEventTypes } from "@/hooks/queries";
import { formatDateTime } from "@/lib/format";
import { cn, humanize } from "@/lib/utils";

const LIMIT = 30;

export default function AuditPage() {
  const [filters, setFilters] = useState({ event_type: "", actor_type: "", simulated: "", q: "" });
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const types = useAuditEventTypes();

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, q: search }));
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const q = useAudit({
    event_type: filters.event_type || undefined,
    actor_type: filters.actor_type || undefined,
    simulated: filters.simulated === "" ? undefined : filters.simulated === "1",
    q: filters.q || undefined,
    limit: LIMIT,
    offset,
  });

  const update = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setOffset(0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search summary or entity ID" className="pl-9" aria-label="Search audit" />
        </div>
        <NativeSelect aria-label="Event type" value={filters.event_type} onChange={(e) => update("event_type", e.target.value)} className="w-auto">
          <option value="">All event types</option>
          {types.data?.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Actor" value={filters.actor_type} onChange={(e) => update("actor_type", e.target.value)} className="w-auto">
          <option value="">All actors</option>
          {["CUSTOMER", "STAFF", "SYSTEM", "VISION", "SIMULATOR", "SENSOR"].map((a) => (
            <option key={a} value={a}>
              {humanize(a)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Origin" value={filters.simulated} onChange={(e) => update("simulated", e.target.value)} className="w-auto">
          <option value="">Real + simulated</option>
          <option value="0">Real only</option>
          <option value="1">Simulated only</option>
        </NativeSelect>
      </div>

      <Card className="overflow-hidden">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No audit records match" />
        ) : (
          <>
            <ul className="divide-y divide-line/70">
              {q.data.items.map((a) => {
                const isOpen = expanded === a.id;
                return (
                  <li key={a.id}>
                    <button
                      className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/50 sm:px-5"
                      onClick={() => setExpanded(isOpen ? null : a.id)}
                      aria-expanded={isOpen}
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          a.actor_type === "STAFF" ? "bg-info" : a.actor_type === "CUSTOMER" ? "bg-teal" : a.actor_type === "SIMULATOR" ? "bg-sim" : a.actor_type === "VISION" ? "bg-accent" : "bg-subtle",
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] text-fg">{a.summary}</span>
                          {a.is_simulated && <Badge tone="sim">SIMULATED</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-subtle">
                          <span className="num">{formatDateTime(a.occurred_at)}</span> · {humanize(a.event_type)} · {humanize(a.actor_type)}
                          {a.actor_id ? ` (${a.actor_id})` : ""}
                          {a.session_id && (
                            <>
                              {" · "}
                              <Link to={`/sessions/${a.session_id}`} className="font-mono text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                                {a.session_id}
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3 sm:px-5 sm:pl-10">
                        <dl className="mb-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                          <div>
                            <dt className="text-subtle">Record</dt>
                            <dd className="font-mono">{a.id}</dd>
                          </div>
                          <div>
                            <dt className="text-subtle">Entity</dt>
                            <dd className="font-mono">{a.entity_type ? `${a.entity_type}:${a.entity_id}` : "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-subtle">Source</dt>
                            <dd>{humanize(a.source)}</dd>
                          </div>
                          <div>
                            <dt className="text-subtle">Sequence</dt>
                            <dd className="num">#{a.seq}</dd>
                          </div>
                        </dl>
                        <pre className="max-h-64 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-muted">
                          {JSON.stringify(a.details, null, 2)}
                        </pre>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination total={q.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          </>
        )}
      </Card>
      <p className="text-xs text-subtle">The audit trail is append-only. Corrections add new records; original evidence is never modified.</p>
    </div>
  );
}
