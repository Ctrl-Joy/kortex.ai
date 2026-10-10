import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import type {
  AuditEvent,
  CustomerState,
  DemoRun,
  DemoScenario,
  Discrepancy,
  DiscrepancyDetail,
  Health,
  Overview,
  Page,
  PolicyInfo,
  Product,
  Reconciliation,
  ScanEvent,
  SensorEvent,
  SessionDetail,
  SessionSummary,
  VisionEvent,
  VisionStatus,
  Zone,
} from "@/types/api";

export function useOverview() {
  return useQuery({ queryKey: ["overview"], queryFn: () => api.get<Overview>("/api/stats/overview"), refetchInterval: 30_000 });
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/api/health", "none"), refetchInterval: 10_000 });
}

export function useVisionStatus() {
  return useQuery({
    queryKey: ["vision-status"],
    queryFn: () => api.get<VisionStatus>("/api/vision/status", "none"),
    refetchInterval: 5_000,
  });
}

export function useProducts(opts: { q?: string; includeInactive?: boolean } = {}) {
  return useQuery({
    queryKey: ["products", opts],
    queryFn: () => api.get<Product[]>(`/api/products${qs({ q: opts.q, include_inactive: opts.includeInactive })}`, "none"),
    placeholderData: keepPreviousData,
  });
}

export interface SessionFilters {
  q?: string;
  status?: string;
  attention?: boolean;
  demo?: boolean;
  limit: number;
  offset: number;
}

export function useSessions(filters: SessionFilters, refetchInterval?: number) {
  return useQuery({
    queryKey: ["sessions", filters],
    queryFn: () => api.get<Page<SessionSummary>>(`/api/sessions${qs({ ...filters })}`),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
}

export function useSessionDetail(id: string | undefined) {
  return useQuery({
    queryKey: ["session", id, "detail"],
    queryFn: () => api.get<SessionDetail>(`/api/sessions/${id}`),
    enabled: !!id,
  });
}

export function useSessionScans(id: string | undefined) {
  return useQuery({
    queryKey: ["session", id, "scans"],
    queryFn: () => api.get<ScanEvent[]>(`/api/sessions/${id}/scans?limit=100`),
    enabled: !!id,
  });
}

export function useSessionVision(id: string | undefined) {
  return useQuery({
    queryKey: ["session", id, "vision"],
    queryFn: () => api.get<VisionEvent[]>(`/api/sessions/${id}/vision-events?limit=100`),
    enabled: !!id,
  });
}

export function useSessionSensors(id: string | undefined) {
  return useQuery({
    queryKey: ["session", id, "sensors"],
    queryFn: () => api.get<SensorEvent[]>(`/api/sessions/${id}/sensor-events?limit=100`),
    enabled: !!id,
  });
}

export function useSessionReconciliations(id: string | undefined) {
  return useQuery({
    queryKey: ["session", id, "reconciliations"],
    queryFn: () => api.get<Reconciliation[]>(`/api/sessions/${id}/reconciliations?limit=100`),
    enabled: !!id,
  });
}

export interface DiscrepancyFilters {
  state?: string;
  kind?: string;
  session_id?: string;
  simulated?: boolean;
  limit: number;
  offset: number;
}

export function useDiscrepancies(filters: DiscrepancyFilters) {
  return useQuery({
    queryKey: ["discrepancies", filters],
    queryFn: () => api.get<Page<Discrepancy>>(`/api/discrepancies${qs({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

export function useDiscrepancy(id: string | null) {
  return useQuery({
    queryKey: ["discrepancies", "detail", id],
    queryFn: () => api.get<DiscrepancyDetail>(`/api/discrepancies/${id}`),
    enabled: !!id,
  });
}

export interface AuditFilters {
  session_id?: string;
  event_type?: string;
  actor_type?: string;
  simulated?: boolean;
  q?: string;
  limit: number;
  offset: number;
}

export function useAudit(filters: AuditFilters) {
  return useQuery({
    queryKey: ["audit", filters],
    queryFn: () => api.get<Page<AuditEvent>>(`/api/audit${qs({ ...filters })}`),
    placeholderData: keepPreviousData,
  });
}

export function useAuditEventTypes() {
  return useQuery({ queryKey: ["audit", "types"], queryFn: () => api.get<string[]>("/api/audit/event-types") });
}

export function useVisionEvents(params: { session_id?: string; limit?: number }) {
  return useQuery({
    queryKey: ["vision-events", params],
    queryFn: () => api.get<VisionEvent[]>(`/api/vision/events${qs({ ...params })}`),
  });
}

export function useZones() {
  return useQuery({ queryKey: ["zones"], queryFn: () => api.get<Zone[]>("/api/zones", "none") });
}

export function usePolicy() {
  return useQuery({ queryKey: ["policy"], queryFn: () => api.get<PolicyInfo>("/api/settings/policy") });
}

export function useScenarios() {
  return useQuery({
    queryKey: ["demo-scenarios"],
    queryFn: () => api.get<DemoScenario[]>("/api/demo/scenarios"),
    staleTime: Infinity,
  });
}

export function useDemoRuns() {
  return useQuery({
    queryKey: ["demo-runs"],
    queryFn: () => api.get<DemoRun[]>("/api/demo/runs"),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "RUNNING") ? 1500 : false),
  });
}

export function useCustomerState(sessionId: string | undefined, token: string | undefined) {
  return useQuery({
    queryKey: ["customer-state", sessionId],
    queryFn: () => api.get<CustomerState>(`/api/sessions/${sessionId}/state`, { sessionToken: token! }),
    enabled: !!sessionId && !!token,
    refetchInterval: 15_000,
  });
}
