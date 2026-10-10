import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/misc";

export function renderWithProviders(ui: ReactNode, { route = "/" }: { route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

type Handler = (url: string, init: RequestInit) => { status?: number; body: unknown } | undefined;

/** Minimal fetch mock: routes by "METHOD path" prefix and records calls. */
export function mockFetch(handler: Handler) {
  const calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init.method ?? "GET";
    calls.push({
      method,
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers as Record<string, string>) ?? {},
    });
    const res = handler(`${method} ${url}`, init) ?? { status: 404, body: { error: { code: "not_found", message: "no mock" } } };
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
