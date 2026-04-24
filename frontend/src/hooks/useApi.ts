// =============================================================================
// hooks/useApi.ts
// Compatibility bridge: re-exports shared hooks from useZoningApi and adds
// interface-level hooks used by PortInventoryTable, SfpHealthView, PerformanceGraph.
// =============================================================================

import useSWR, { mutate as globalMutate } from "swr";
export { useSwitches } from "./useZoningApi";
import type { Interface, SfpDiagnostics, MetricPoint } from "../types/api.types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";


function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("san-auth-token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Interface list  (used by PortInventoryTable)
// Backed by GET /api/switches/:switchId/interfaces?search=&status=&vsan=
// ---------------------------------------------------------------------------
export function useInterfaces(
  switchId: string | null,
  filters?: { search?: string; status?: string; vsan?: number }
) {
  const params = new URLSearchParams();
  if (filters?.search) params.set("search", filters.search);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.vsan)   params.set("vsan", String(filters.vsan));

  const url = switchId ? `${BASE}/switches/${switchId}/interfaces?${params}` : null;
  const { data, error, isLoading, mutate } = useSWR<Interface[]>(url, fetcher, {
    refreshInterval: 15_000,
  });
  return { interfaces: data ?? [], error, isLoading, refresh: mutate };
}

export async function updateAlias(interfaceId: string, alias: string): Promise<void> {
  await fetch(`${BASE}/interfaces/${interfaceId}/alias`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ alias }),
  });
  globalMutate(
    (key) => typeof key === "string" && key.includes("/interfaces"),
    undefined,
    { revalidate: true }
  );
}

// ---------------------------------------------------------------------------
// SFP latest diagnostics  (used by SfpHealthView)
// Backed by GET /api/metrics/latest?switchId=&interface=
// ---------------------------------------------------------------------------
export function useSfpDiagnostics(
  switchId: string | null,
  interfaceName: string | null
) {
  const url =
    switchId && interfaceName
      ? `${BASE}/metrics/latest?switchId=${switchId}&interface=${encodeURIComponent(interfaceName)}`
      : null;

  const { data, error, isLoading } = useSWR<SfpDiagnostics | null>(url, fetcher, {
    refreshInterval: 60_000,
  });
  return { sfp: data ?? null, error, isLoading };
}

// ---------------------------------------------------------------------------
// Time-bucketed metrics  (used by PerformanceGraph)
// Backed by GET /api/metrics?switchId=&interface=&window=
// ---------------------------------------------------------------------------
export function useMetrics(
  switchId: string | null,
  interfaceName: string | null,
  window = "24h"
) {
  const url =
    switchId && interfaceName
      ? `${BASE}/metrics?switchId=${switchId}&interface=${encodeURIComponent(interfaceName)}&window=${window}`
      : null;

  const { data, error, isLoading } = useSWR<MetricPoint[]>(url, fetcher, {
    refreshInterval: 60_000,
  });
  return { metrics: data ?? [], error, isLoading };
}
