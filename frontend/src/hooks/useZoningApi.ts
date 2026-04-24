// =============================================================================
// hooks/useZoningApi.ts — SWR data hooks + mutation helpers
// =============================================================================

import useSWR, { mutate as globalMutate } from "swr";
import {
  Switch, FcAlias, Zone, ZoneSet, ZoningSnapshot,
  CommitResult, AliasSyncResult,
} from "../types/api.types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";


// ---------------------------------------------------------------------------
// Auth token helper — reads from sessionStorage so hooks don't need context
// ---------------------------------------------------------------------------
function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("san-auth-token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res.json();
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function del(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE", headers: getAuthHeaders() });
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

// ---------------------------------------------------------------------------
export function useSwitches() {
  const { data, error, isLoading } = useSWR<Switch[]>(`${BASE}/switches`, fetcher, { refreshInterval: 30_000 });
  return { switches: data ?? [], error, isLoading };
}

// ---------------------------------------------------------------------------


export function useSwitch(switchId: string | null) {
  const url = switchId ? `${BASE}/switches/${switchId}` : null;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, { refreshInterval: 30_000 });
  return { switchDetail: data ?? null, error, isLoading, refresh: mutate };
}

export async function deleteSwitch(id: string): Promise<void> {
  // Delete the switch record (cascades all associated data in DB)
  const res = await fetch(`${BASE}/switches/${id}`, { method: "DELETE", headers: getAuthHeaders() });
  if (!res.ok && res.status !== 204) {
    throw new Error(await res.text());
  }
  // Clear any cached credentials for this switch
  await fetch(`${BASE}/switches/${id}/credentials`, { method: "DELETE", headers: getAuthHeaders() }).catch(() => {});
  // Invalidate all caches — everything is switch-scoped
  globalMutate(() => true, undefined, { revalidate: true });
}

export function useAliases(switchId: string | null, orphanedOnly = false) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), ...(orphanedOnly ? { orphanedOnly: "true" } : {}) });
  const url = switchId ? `${BASE}/aliases?${params}` : null;
  const { data, error, isLoading } = useSWR<FcAlias[]>(url, fetcher, { refreshInterval: 30_000 });
  return { aliases: data ?? [], error, isLoading };
}

export async function createAlias(body: {
  switchId: string; name: string; wwn: string; description?: string; pushToSwitch?: boolean;
}): Promise<FcAlias> {
  const result = await post<FcAlias>(`${BASE}/aliases`, body);
  globalMutate((k) => typeof k === "string" && k.includes("/aliases"), undefined, { revalidate: true });
  return result;
}

export async function deleteAlias(id: string): Promise<void> {
  await del(`${BASE}/aliases/${id}`);
  globalMutate((k) => typeof k === "string" && k.includes("/aliases"), undefined, { revalidate: true });
}

export async function syncAliases(switchId: string): Promise<AliasSyncResult> {
  const result = await post<AliasSyncResult>(`${BASE}/aliases/sync`, { switchId });
  globalMutate((k) => typeof k === "string" && k.includes("/aliases"), undefined, { revalidate: true });
  return result;
}

// ---------------------------------------------------------------------------
export function useZones(switchId: string | null, vsanId?: number) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), ...(vsanId ? { vsanId: String(vsanId) } : {}) });
  const url = switchId ? `${BASE}/zones?${params}` : null;
  const { data, error, isLoading } = useSWR<Zone[]>(url, fetcher, { refreshInterval: 15_000 });
  return { zones: data ?? [], error, isLoading };
}

export async function createZone(body: {
  switchId: string; name: string; vsanId: number; description?: string;
  members?: { memberType: string; value: string }[];
}): Promise<Zone> {
  const result = await post<Zone>(`${BASE}/zones`, body);
  globalMutate((k) => typeof k === "string" && k.includes("/zones"), undefined, { revalidate: true });
  return result;
}

export async function addZoneMember(zoneId: string, memberType: string, value: string): Promise<void> {
  await post(`${BASE}/zones/${zoneId}/members`, { memberType, value });
  globalMutate((k) => typeof k === "string" && k.includes("/zones"), undefined, { revalidate: true });
}

export async function removeZoneMember(zoneId: string, memberId: string): Promise<void> {
  await del(`${BASE}/zones/${zoneId}/members/${memberId}`);
  globalMutate((k) => typeof k === "string" && k.includes("/zones"), undefined, { revalidate: true });
}

export async function deleteZone(id: string): Promise<void> {
  await del(`${BASE}/zones/${id}`);
  globalMutate((k) => typeof k === "string" && k.includes("/zones"), undefined, { revalidate: true });
}

// ---------------------------------------------------------------------------
export function useZoneSets(switchId: string | null, vsanId?: number) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), ...(vsanId ? { vsanId: String(vsanId) } : {}) });
  const url = switchId ? `${BASE}/zonesets?${params}` : null;
  const { data, error, isLoading } = useSWR<ZoneSet[]>(url, fetcher, { refreshInterval: 15_000 });
  return { zoneSets: data ?? [], error, isLoading };
}

export async function createZoneSet(body: { switchId: string; name: string; vsanId: number }): Promise<ZoneSet> {
  const result = await post<ZoneSet>(`${BASE}/zonesets`, body);
  globalMutate((k) => typeof k === "string" && k.includes("/zonesets"), undefined, { revalidate: true });
  return result;
}

export async function addZoneToSet(zoneSetId: string, zoneId: string): Promise<void> {
  await post(`${BASE}/zonesets/${zoneSetId}/zones`, { zoneId });
  globalMutate((k) => typeof k === "string" && k.includes("/zonesets"), undefined, { revalidate: true });
}

export async function removeZoneFromSet(zoneSetId: string, zoneId: string): Promise<void> {
  await del(`${BASE}/zonesets/${zoneSetId}/zones/${zoneId}`);
  globalMutate((k) => typeof k === "string" && k.includes("/zonesets"), undefined, { revalidate: true });
}

// ---------------------------------------------------------------------------
// THE critical mutation — POST /api/zoning/commit
// ---------------------------------------------------------------------------
export async function commitAndActivate(body: {
  switchId: string; vsanId: number; zoneSetId: string;
}): Promise<CommitResult> {
  const result = await post<CommitResult>(`${BASE}/zoning/commit`, body);
  // Revalidate everything after a commit
  globalMutate(() => true, undefined, { revalidate: true });
  return result;
}

// ---------------------------------------------------------------------------
export function useSnapshots(switchId: string | null, vsanId?: number) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), ...(vsanId ? { vsanId: String(vsanId) } : {}), limit: "30" });
  const url = switchId ? `${BASE}/snapshots?${params}` : null;
  const { data, error, isLoading } = useSWR<ZoningSnapshot[]>(url, fetcher, { refreshInterval: 60_000 });
  return { snapshots: data ?? [], error, isLoading };
}

export async function captureSnapshot(switchId: string, vsanId: number): Promise<{ snapshotId: string }> {
  const result = await post<{ snapshotId: string }>(`${BASE}/snapshots/capture`, { switchId, vsanId });
  globalMutate((k) => typeof k === "string" && k.includes("/snapshots"), undefined, { revalidate: true });
  return result;
}

// ---------------------------------------------------------------------------
// Fabric discovery hooks
// ---------------------------------------------------------------------------

export function useFcns(switchId: string | null, vsanId?: number) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), ...(vsanId ? { vsanId: String(vsanId) } : {}) });
  const url = switchId ? `${BASE}/fabric/fcns?${params}` : null;
  const { data, error, isLoading } = useSWR<import("../types/api.types").FcnsEntry[]>(url, fetcher, { refreshInterval: 60_000 });
  return { fcns: data ?? [], error, isLoading };
}

export function useKnownWwns(switchId: string | null, vsanId?: number) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), ...(vsanId ? { vsanId: String(vsanId) } : {}) });
  const url = switchId ? `${BASE}/fabric/wwns?${params}` : null;
  const { data, error, isLoading } = useSWR<import("../types/api.types").KnownWwn[]>(url, fetcher, { refreshInterval: 30_000 });
  return { wwns: data ?? [], error, isLoading };
}

export function useTopPorts(switchId: string | null, vsanId = 100, topN = 5) {
  const params = new URLSearchParams({ ...(switchId ? { switchId } : {}), vsanId: String(vsanId), topN: String(topN) });
  const url = switchId ? `${BASE}/performance/top?${params}` : null;
  const { data, error, isLoading } = useSWR<import("../types/api.types").TopPortsResult>(url, fetcher, { refreshInterval: 30_000 });
  return { topPorts: data ?? null, error, isLoading };
}

export function useInterfaceNames(switchId: string | null) {
  const url = switchId ? `${BASE}/fabric/interfaces?switchId=${switchId}` : null;
  const { data, error, isLoading } = useSWR<string[]>(url, fetcher, { refreshInterval: 60_000 });
  return { interfaceNames: data ?? [], error, isLoading };
}

export function useVsans(switchId: string | null) {
  const url = switchId ? `${BASE}/fabric/vsans?switchId=${switchId}` : null;
  const { data, isLoading } = useSWR<number[]>(url, fetcher, { refreshInterval: 60_000 });
  return { vsanIds: data ?? [100], isLoading };
}

export async function registerSwitch(body: import("../types/api.types").SwitchRegistration) {
  const res = await fetch(`${BASE}/switches/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Registration failed");
  globalMutate((k) => typeof k === "string" && k.includes("/switches"), undefined, { revalidate: true });
  return json;
}

export async function discoverFabric(switchId: string, vsanId: number) {
  const res = await fetch(`${BASE}/fabric/discover?switchId=${switchId}&vsanId=${vsanId}`, { headers: getAuthHeaders() });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Discovery failed");
  globalMutate((k) => typeof k === "string" && k.includes("/fabric"), undefined, { revalidate: true });
  return json;
}

export async function syncZonesFromSwitch(switchId: string, vsanId: number): Promise<{
  zonesImported: number; zoneSetsImported: number; aliasesImported: number;
}> {
  const result = await post<{ zonesImported: number; zoneSetsImported: number; aliasesImported: number }>(
    `${BASE}/zoning/sync`,
    { switchId, vsanId }
  );
  globalMutate(() => true, undefined, { revalidate: true });
  return result;
}
