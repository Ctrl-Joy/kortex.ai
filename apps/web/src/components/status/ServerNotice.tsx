import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, ServerOff } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { Health } from "@/types/api";

export type ServerState = "checking" | "waking" | "ready" | "unreachable" | "not-configured";

/**
 * Whether the KORTEX API behind this site can be reached.
 *
 * Free hosting puts the API to sleep when idle, so the first request can take
 * up to a minute. Instead of a spinner that looks broken, the entry screens
 * say what is happening and when there is nothing the visitor can do.
 */
export function useServerState() {
  const q = useQuery({
    queryKey: ["server-state"],
    queryFn: () => api.get<Health>("/api/health", "none"),
    retry: (count, err) => !(err instanceof ApiError && err.code === "api_not_configured") && count < 8,
    retryDelay: 5_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const [slow, setSlow] = useState(false);
  const pending = q.isPending || (q.isFetching && !q.data);
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(t);
  }, [pending]);

  let state: ServerState;
  if (q.data) state = "ready";
  else if (q.error instanceof ApiError && q.error.code === "api_not_configured") state = "not-configured";
  else if (q.isError) state = "unreachable";
  else state = slow || q.failureCount > 0 ? "waking" : "checking";
  return { state, retry: () => void q.refetch() };
}

export function ServerNotice({ state, onRetry }: { state: ServerState; onRetry: () => void }) {
  if (state === "ready" || state === "checking") return null;
  if (state === "waking") {
    return (
      <div role="status" className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
        <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-accent" aria-hidden />
        <div>
          <p className="font-medium text-fg">Waking the demo server</p>
          <p className="mt-0.5 text-muted">It sleeps when idle. This can take up to a minute, then everything is fast.</p>
        </div>
      </div>
    );
  }
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-[13px]">
      <ServerOff className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-fg">{state === "not-configured" ? "No server connected" : "Server unreachable"}</p>
        <p className="mt-0.5 text-muted">
          {state === "not-configured"
            ? "This site was built without an API address, so nothing can be loaded or saved. The site owner needs to set VITE_API_BASE_URL and redeploy."
            : "The KORTEX server did not answer. It may be restarting, or your connection dropped."}
        </p>
        {state === "unreachable" && (
          <button
            onClick={onRetry}
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg text-[13px] font-medium text-fg underline-offset-4 hover:underline pointer-coarse:min-h-11"
          >
            <RefreshCw className="size-3.5" /> Try again
          </button>
        )}
      </div>
    </div>
  );
}
