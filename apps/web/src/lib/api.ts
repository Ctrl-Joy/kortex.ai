import { authStore } from "@/lib/auth";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Auth = "staff" | { sessionToken: string } | "none";

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: Auth;
  signal?: AbortSignal;
}

export async function request<T>(path: string, { method = "GET", body, auth = "staff", signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth === "staff") {
    const token = authStore.get()?.token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } else if (typeof auth === "object") {
    headers["X-Session-Token"] = auth.sessionToken;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Cannot reach the KORTEX API. Is the backend running?");
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null)?.error;
    if (res.status === 401 && auth === "staff") authStore.expire();
    throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? res.statusText, err?.details ?? {});
  }
  return json as T;
}

export const api = {
  get: <T>(path: string, auth?: Auth) => request<T>(path, { auth }),
  post: <T>(path: string, body?: unknown, auth?: Auth) => request<T>(path, { method: "POST", body, auth }),
  put: <T>(path: string, body?: unknown, auth?: Auth) => request<T>(path, { method: "PUT", body, auth }),
  patch: <T>(path: string, body?: unknown, auth?: Auth) => request<T>(path, { method: "PATCH", body, auth }),
  del: <T>(path: string, auth?: Auth) => request<T>(path, { method: "DELETE", auth }),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}
