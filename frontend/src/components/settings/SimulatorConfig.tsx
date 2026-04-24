// =============================================================================
// components/settings/SimulatorConfig.tsx
// Configure MDS simulator ports: state, mode, speed, VSAN, SFP, and
// min/max ranges for throughput (Mbps) and optical power (dBm).
// =============================================================================

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("san-auth-token");
  return token
    ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export interface SimPort {
  name:       string;
  state:      "up" | "down";
  mode:       "F" | "E" | "TE" | "FL";
  speedGbps:  4 | 8 | 16 | 32 | 64;
  vsanId:     number;
  sfpPresent: boolean;
  degraded:   boolean;
  txMinMbps:  number;
  txMaxMbps:  number;
  rxMinMbps:  number;
  rxMaxMbps:  number;
  rxPwrMin:   number;
  rxPwrMax:   number;
  txPwrMin:   number;
  txPwrMax:   number;
}

interface SimState {
  switchId: string; ipAddress: string; pollCount: number;
  ports: SimPort[]; aliasCount: number; zoneCount: number; zoneSetCount: number;
}

const MODES  = ["F", "E", "TE", "FL"] as const;
const SPEEDS = [4, 8, 16, 32, 64]    as const;
type EditMode = "basic" | "throughput" | "sfp";

function Toggle({ checked, onChange, danger }: { checked: boolean; onChange: (v: boolean) => void; danger?: boolean }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={cn("h-5 w-9 rounded-full transition-colors relative flex-shrink-0",
        checked ? (danger ? "bg-red-500" : "bg-primary") : "bg-muted border border-border"
      )}>
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
        checked ? "translate-x-4" : "translate-x-0.5"
      )}/>
    </button>
  );
}

function NumInput({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <input type="number" min={min} max={max} step={step ?? 1} value={value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="h-7 w-20 rounded border border-border bg-background px-1.5 text-xs text-right font-mono focus:outline-none focus:ring-1 focus:ring-ring"/>
  );
}

export function SimulatorConfig({ switchId }: { switchId: string }) {
  const url = `${BASE}/simulator/${switchId}`;
  const { data, isLoading, error } = useSWR<SimState>(url, fetcher, { refreshInterval: 10_000 });

  const [ports,     setPorts]     = useState<SimPort[] | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [polling,   setPolling]   = useState(false);
  const [resetting, setResetting] = useState(false);
  const [toast,     setToast]     = useState<{ msg: string; ok: boolean } | null>(null);
  const [editMode,  setEditMode]  = useState<EditMode>("basic");

  const pollNow = async () => {
    setPolling(true);
    try {
      await fetch(`${url}/poll`, { method: "POST", headers: getAuthHeaders() });
      showToast("Poll triggered — data will appear within 60 seconds.", true);
    } catch { showToast("Poll trigger failed.", false); }
    finally { setPolling(false); }
  };

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 5000);
  };

  const displayPorts = ports ?? data?.ports ?? [];
  const isDirty = ports !== null;

  const setPort = (idx: number, patch: Partial<SimPort>) =>
    setPorts((ports ?? data?.ports ?? []).map((p, i) => i === idx ? { ...p, ...patch } : p));

  const save = async () => {
    if (!ports) return;
    setSaving(true);
    try {
      const res = await fetch(`${url}/ports`, {
        method: "PUT", headers: getAuthHeaders(), body: JSON.stringify({ ports }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      await mutate(url);
      setPorts(null);
      showToast("Port configuration saved. Changes take effect on the next poll (60s).", true);
    } catch (err) { showToast(err instanceof Error ? err.message : "Save failed", false); }
    finally { setSaving(false); }
  };

  const reset = async () => {
    if (!confirm("Reset simulator state to defaults? All alias/zone changes will be lost.")) return;
    setResetting(true);
    try {
      const res = await fetch(`${url}/reset`, { method: "POST", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json()).error ?? "Reset failed");
      await mutate(url); setPorts(null);
      showToast("Simulator state reset to defaults.", true);
    } catch (err) { showToast(err instanceof Error ? err.message : "Reset failed", false); }
    finally { setResetting(false); }
  };

  if (isLoading) return <div className="text-sm text-muted-foreground py-4">Loading simulator state…</div>;
  if (error)     return <div className="text-sm text-red-600 py-4">Simulator not active or switch not found.</div>;
  if (!data)     return null;

  return (
    <div className="space-y-4">
      {toast && (
        <div className={cn("rounded-md px-3 py-2 text-sm border",
          toast.ok
            ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 text-emerald-800 dark:text-emerald-300"
            : "bg-red-50 dark:bg-red-950/20 border-red-200 text-red-700 dark:text-red-400"
        )}>{toast.msg}</div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["IP", data.ipAddress],["Poll cycles", String(data.pollCount)],
          ["Aliases", String(data.aliasCount)],["Zones", String(data.zoneCount)]].map(([l,v]) => (
          <div key={l} className="rounded-lg border bg-background px-3 py-2">
            <p className="text-[11px] text-muted-foreground">{l}</p>
            <p className="text-sm font-semibold font-mono mt-0.5">{v}</p>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Port configuration</h3>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["basic","throughput","sfp"] as EditMode[]).map(m => (
              <button key={m} onClick={() => setEditMode(m)}
                className={cn("px-2.5 py-1 transition-colors",
                  editMode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                )}>
                {m === "basic" ? "Basic" : m === "throughput" ? "Throughput" : "SFP power"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {isDirty && <>
            <button onClick={() => setPorts(null)}
              className="h-7 px-3 text-xs rounded-md border border-border hover:bg-muted">Revert</button>
            <button onClick={save} disabled={saving}
              className="h-7 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {saving ? "Saving…" : "Apply"}
            </button>
          </>}
          <button onClick={pollNow} disabled={polling}
            className="h-7 px-3 text-xs rounded-md border border-border bg-background hover:bg-muted flex items-center gap-1.5 disabled:opacity-50">
            {polling ? (
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1.5 5.5A4 4 0 1 1 5.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                <path d="M1.5 3v2.5H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {polling ? "Polling…" : "Poll now"}
          </button>
          <button onClick={reset} disabled={resetting}
            className="h-7 px-3 text-xs rounded-md border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50">
            {resetting ? "…" : "Reset defaults"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-3 py-2 font-medium sticky left-0 bg-muted/50">Port</th>
              {editMode === "basic" && <>
                <th className="text-left px-3 py-2 font-medium">State</th>
                <th className="text-left px-3 py-2 font-medium">Mode</th>
                <th className="text-left px-3 py-2 font-medium">Speed</th>
                <th className="text-left px-3 py-2 font-medium">VSAN</th>
                <th className="text-left px-3 py-2 font-medium">SFP</th>
                <th className="text-left px-3 py-2 font-medium">Degraded</th>
              </>}
              {editMode === "throughput" && <>
                <th className="text-right px-3 py-2 font-medium">Tx Min</th>
                <th className="text-right px-3 py-2 font-medium">Tx Max</th>
                <th className="text-right px-3 py-2 font-medium">Rx Min</th>
                <th className="text-right px-3 py-2 font-medium">Rx Max</th>
                <th className="px-3 py-2 text-muted-foreground font-normal normal-case">(Mbps — 0 = auto)</th>
              </>}
              {editMode === "sfp" && <>
                <th className="text-right px-3 py-2 font-medium">RX Min</th>
                <th className="text-right px-3 py-2 font-medium">RX Max</th>
                <th className="text-right px-3 py-2 font-medium">TX Min</th>
                <th className="text-right px-3 py-2 font-medium">TX Max</th>
                <th className="px-3 py-2 text-muted-foreground font-normal normal-case">(dBm)</th>
              </>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayPorts.map((port, idx) => (
              <tr key={port.name} className={cn("hover:bg-muted/20", port.state === "down" && "opacity-60")}>
                <td className="px-3 py-2 font-mono font-medium sticky left-0 bg-card">{port.name}</td>

                {editMode === "basic" && <>
                  <td className="px-3 py-2">
                    <button onClick={() => setPort(idx, { state: port.state === "up" ? "down" : "up" })}
                      className={cn("text-xs font-medium px-2 py-0.5 rounded-full border",
                        port.state === "up"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-200"
                          : "bg-red-100 text-red-800 border-red-200 hover:bg-red-200"
                      )}>{port.state.toUpperCase()}</button>
                  </td>
                  <td className="px-3 py-2">
                    <select value={port.mode} onChange={e => setPort(idx, { mode: e.target.value as any })}
                      className="h-7 rounded border border-border bg-background px-1.5 text-xs font-mono">
                      {MODES.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select value={port.speedGbps} onChange={e => setPort(idx, { speedGbps: Number(e.target.value) as any })}
                      className="h-7 rounded border border-border bg-background px-1.5 text-xs">
                      {SPEEDS.map(s => <option key={s} value={s}>{s}G</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={1} max={4094} value={port.vsanId}
                      onChange={e => setPort(idx, { vsanId: parseInt(e.target.value) || 100 })}
                      className="h-7 w-16 rounded border border-border bg-background px-1.5 text-xs font-mono"/>
                  </td>
                  <td className="px-3 py-2"><Toggle checked={port.sfpPresent} onChange={v => setPort(idx, { sfpPresent: v })}/></td>
                  <td className="px-3 py-2"><Toggle checked={port.degraded} onChange={v => setPort(idx, { degraded: v })} danger/></td>
                </>}

                {editMode === "throughput" && <>
                  <td className="px-3 py-2 text-right"><NumInput value={port.txMinMbps} min={0} max={port.speedGbps*1000} onChange={v => setPort(idx, {txMinMbps: v})}/></td>
                  <td className="px-3 py-2 text-right"><NumInput value={port.txMaxMbps} min={0} max={port.speedGbps*1000} onChange={v => setPort(idx, {txMaxMbps: v})}/></td>
                  <td className="px-3 py-2 text-right"><NumInput value={port.rxMinMbps} min={0} max={port.speedGbps*1000} onChange={v => setPort(idx, {rxMinMbps: v})}/></td>
                  <td className="px-3 py-2 text-right"><NumInput value={port.rxMaxMbps} min={0} max={port.speedGbps*1000} onChange={v => setPort(idx, {rxMaxMbps: v})}/></td>
                  <td/>
                </>}

                {editMode === "sfp" && <>
                  <td className="px-3 py-2 text-right"><NumInput value={port.rxPwrMin} min={-20} max={5} step={0.1} onChange={v => setPort(idx, {rxPwrMin: v})}/></td>
                  <td className="px-3 py-2 text-right"><NumInput value={port.rxPwrMax} min={-20} max={5} step={0.1} onChange={v => setPort(idx, {rxPwrMax: v})}/></td>
                  <td className="px-3 py-2 text-right"><NumInput value={port.txPwrMin} min={-20} max={5} step={0.1} onChange={v => setPort(idx, {txPwrMin: v})}/></td>
                  <td className="px-3 py-2 text-right"><NumInput value={port.txPwrMax} min={-20} max={5} step={0.1} onChange={v => setPort(idx, {txPwrMax: v})}/></td>
                  <td/>
                </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {editMode === "basic" && "Click state badge to toggle. Degraded simulates critically low RX power (−11 dBm) for SFP health testing."}
        {editMode === "throughput" && "Tx/Rx values oscillate between min and max each poll cycle. Set both to 0 to auto-derive from port speed."}
        {editMode === "sfp" && "RX/TX optical power oscillates between min and max each poll. Typical: −4.5 to −2.0 dBm. Critical threshold: −10 dBm."}
      </p>
    </div>
  );
}
