import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LiveConnection, useLiveInvalidation, useLiveStatus, type LiveStatus } from "@/lib/live";
import type { LiveMessage } from "@/types/api";

interface LiveCtx {
  conn: LiveConnection | null;
  status: LiveStatus;
  feed: LiveMessage[];
}

const Ctx = createContext<LiveCtx>({ conn: null, status: "closed", feed: [] });

const FEED_TYPES = new Set([
  "scan.created",
  "vision.created",
  "sensor.created",
  "reconciliation.created",
  "discrepancy.created",
  "discrepancy.updated",
  "checkout.updated",
  "session.created",
]);

export function LiveProvider({ query, children }: { query: string | null; children: ReactNode }) {
  const conn = useMemo(() => (query ? new LiveConnection(query) : null), [query]);
  const status = useLiveStatus(conn);
  const [feed, setFeed] = useState<LiveMessage[]>([]);
  useLiveInvalidation(conn);

  useEffect(() => {
    if (!conn) return;
    conn.start();
    const off = conn.onMessage((msg) => {
      if (FEED_TYPES.has(msg.type)) setFeed((prev) => [msg, ...prev].slice(0, 60));
    });
    return () => {
      off();
      conn.stop();
    };
  }, [conn]);

  return <Ctx.Provider value={{ conn, status, feed }}>{children}</Ctx.Provider>;
}

export function useLive() {
  return useContext(Ctx);
}
