import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LiveMessage } from "@/types/api";

/**
 * WebSocket client with exponential-backoff reconnection.
 *
 * Messages are treated as *invalidation hints*: the UI re-fetches persisted
 * state through REST, so a refresh or reconnect always shows the truth.
 */

export type LiveStatus = "connecting" | "open" | "closed";

type Listener = (msg: LiveMessage) => void;

function wsUrl(query: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
  if (base) return `${base.replace(/^http/, "ws")}/ws?${query}`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws?${query}`;
}

export class LiveConnection {
  status: LiveStatus = "closed";
  lastMessageAt: number | null = null;
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private statusListeners = new Set<() => void>();
  private messageListeners = new Set<Listener>();
  private query: string;

  constructor(query: string) {
    this.query = query;
  }

  start() {
    this.stopped = false;
    // Deferred one tick so React StrictMode's mount→unmount→mount cycle
    // cancels the first attempt instead of closing a half-open socket.
    this.timer = setTimeout(() => this.open(), 0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
    this.setStatus("closed");
  }

  onStatus(fn: () => void) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  onMessage(fn: Listener) {
    this.messageListeners.add(fn);
    return () => {
      this.messageListeners.delete(fn);
    };
  }

  private setStatus(s: LiveStatus) {
    this.status = s;
    this.statusListeners.forEach((l) => l());
  }

  private open() {
    this.setStatus("connecting");
    const ws = new WebSocket(wsUrl(this.query));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus("open");
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as LiveMessage;
        this.lastMessageAt = Date.now();
        this.messageListeners.forEach((l) => l(msg));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = (ev) => {
      this.ws = null;
      this.setStatus("closed");
      if (this.stopped || ev.code === 4401) return;
      const delay = Math.min(15000, 500 * 2 ** this.retry) + Math.random() * 300;
      this.retry += 1;
      this.timer = setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => ws.close();
  }
}

const noopSubscribe = () => () => {};

export function useLiveStatus(conn: LiveConnection | null): LiveStatus {
  return useSyncExternalStore(
    conn ? (fn) => conn.onStatus(fn) : noopSubscribe,
    () => conn?.status ?? "closed",
    () => "closed",
  );
}

/** Maps a live message to the query keys that must be refreshed. */
export function keysFor(msg: LiveMessage): string[][] {
  const t = msg.type;
  const keys: string[][] = [];
  if (t.startsWith("discrepancy")) keys.push(["discrepancies"], ["overview"], ["sessions"]);
  if (t.startsWith("scan") || t.startsWith("cart")) keys.push(["sessions"], ["overview"]);
  if (t.startsWith("vision") || t.startsWith("reconciliation") || t.startsWith("sensor")) keys.push(["vision-events"], ["sessions"]);
  if (t.startsWith("checkout") || t.startsWith("session")) keys.push(["sessions"], ["overview"]);
  if (t === "audit.created") keys.push(["audit"]);
  if (t === "service.status") keys.push(["vision-status"], ["health"]);
  if (t === "zone.updated") keys.push(["zones"]);
  if (t === "demo.progress") keys.push(["demo-runs"]);
  if (msg.session_id) keys.push(["session", msg.session_id], ["customer-state", msg.session_id]);
  return keys;
}

/** Subscribe a connection to TanStack Query invalidation with light batching. */
export function useLiveInvalidation(conn: LiveConnection | null) {
  const qc = useQueryClient();
  const pending = useRef(new Map<string, string[]>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!conn) return;
    const flush = () => {
      timer.current = null;
      const keys = [...pending.current.values()];
      pending.current.clear();
      keys.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
    };
    const off = conn.onMessage((msg) => {
      for (const key of keysFor(msg)) pending.current.set(key.join("|"), key);
      if (!timer.current) timer.current = setTimeout(flush, 150);
    });
    // After a reconnect, refetch everything so the UI reflects persisted state.
    let wasOpen = conn.status === "open";
    const offStatus = conn.onStatus(() => {
      if (conn.status === "open" && !wasOpen) qc.invalidateQueries();
      wasOpen = conn.status === "open";
    });
    return () => {
      off();
      offStatus();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [conn, qc]);
}
