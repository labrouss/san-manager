// =============================================================================
// components/switches/SwitchSettings.tsx
// Per-switch settings: user-assigned display name, operator notes, and
// read-only hardware information pulled from the DB.
// =============================================================================

import { useState } from "react";
import { cn } from "../../lib/utils";
import { SimulatorConfig } from "../settings/SimulatorConfig";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("san-auth-token");
  return token ? { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

interface Switch {
  id:          string;
  ipAddress:   string;
  hostname:    string | null;
  displayName: string | null;
  notes:       string | null;
  model:       string | null;
  serialNumber: string | null;
  nxosVersion: string | null;
  isActive:    boolean;
  lastSeenAt:  string | null;
  createdAt:   string;
  _count?: {
    fcAliases:  number;
    zones:      number;
    zoneSets:   number;
    zoningSnapshots: number;
    portMetrics: number;
  };
}

interface SwitchSettingsProps {
  switchId:   string;
  switchData: Switch;
  onUpdated:  () => void;
  isOperator: boolean;
}

// ── Info row ─────────────────────────────────────────────────────────────────
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 border-b border-border last:border-0">
      <span className="text-xs text-muted-foreground w-32 flex-shrink-0">{label}</span>
      <span className="text-sm font-mono text-foreground">{value ?? <span className="text-muted-foreground italic">—</span>}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const BASE_S = (import.meta.env.VITE_API_URL ?? "http://localhost:3001/api");

function useSimActive() {
  const [active, setActive] = useState<boolean>(false);
  useState(() => {
    const token = sessionStorage.getItem("san-auth-token");
    fetch(`${BASE_S}/simulator/active`, { headers: token ? { "Authorization": `Bearer ${token}` } : {} })
      .then(r => r.json()).then(d => setActive(d.active === true)).catch(() => {});
  });
  return active;
}

// ── Credential update form ────────────────────────────────────────────────────
function CredentialForm({ switchId, ipAddress }: { switchId: string; ipAddress: string }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [port,     setPort]     = useState("443");
  const [busy,     setBusy]     = useState(false);
  const [msg,      setMsg]      = useState<{ text: string; ok: boolean } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) { setMsg({ text: "Password is required", ok: false }); return; }
    setBusy(true); setMsg(null);
    const token = sessionStorage.getItem("san-auth-token");
    const headers: Record<string,string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    try {
      const res = await fetch(`${BASE_S}/switches/${switchId}/credentials`, {
        method: "POST", headers, body: JSON.stringify({ username, password, port: parseInt(port) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg({ text: "Credentials updated and verified successfully.", ok: true });
      setPassword("");
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed", ok: false });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-muted-foreground">Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Port</label>
          <input value={port} onChange={e => setPort(e.target.value)} type="number"
            className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">New password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder="Enter new switch password"
          className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"/>
      </div>
      {msg && (
        <p className={`text-xs ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.text}
        </p>
      )}
      <button type="submit" disabled={busy || !password}
        className="h-8 px-4 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {busy ? "Verifying…" : "Update credentials"}
      </button>
    </form>
  );
}


export function SwitchSettings({ switchId, switchData, onUpdated, isOperator }: SwitchSettingsProps) {
  const simActive = useSimActive();
  const [displayName, setDisplayName] = useState(switchData.displayName ?? "");
  const [notes,       setNotes]       = useState(switchData.notes       ?? "");
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  const isDirty =
    displayName !== (switchData.displayName ?? "") ||
    notes       !== (switchData.notes       ?? "");

  const save = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const res = await fetch(`${BASE}/switches/${switchId}`, {
        method:  "PATCH",
        headers: getAuthHeaders(),
        body:    JSON.stringify({
          displayName: displayName.trim() || null,
          notes:       notes.trim()       || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  };

  const sw = switchData;

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium">Switch identity</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Display name and notes are stored locally — they don't affect the switch configuration.
          </p>
        </div>

        <div className="space-y-3">
          {/* Display name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Display name
              <span className="ml-1 font-normal opacity-60">(shown in the switch selector dropdown)</span>
            </label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder={sw.hostname ?? sw.ipAddress}
              disabled={!isOperator}
              maxLength={64}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-[11px] text-muted-foreground">
              e.g. "Upper Switch", "Cisco-01", "SAN-A Spine"
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Operator notes
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Free-text notes for operators — maintenance windows, rack location, connected storage, etc."
              disabled={!isOperator}
              rows={4}
              maxLength={1000}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            />
            <p className="text-[11px] text-muted-foreground text-right">{notes.length}/1000</p>
          </div>
        </div>

        {/* Actions */}
        {isOperator && (
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving || !isDirty}
              className={cn(
                "h-8 px-4 text-sm rounded-md font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {isDirty && !saving && (
              <button
                onClick={() => { setDisplayName(sw.displayName ?? ""); setNotes(sw.notes ?? ""); }}
                className="h-8 px-3 text-sm rounded-md border border-border hover:bg-muted"
              >
                Revert
              </button>
            )}
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
                  <path d="M4 6.5l2 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Saved
              </span>
            )}
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        )}
      </div>

      {/* ── Hardware information ──────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5 space-y-2">
        <h3 className="text-sm font-medium mb-3">Hardware information</h3>
        <InfoRow label="IP address"    value={sw.ipAddress} />
        <InfoRow label="Hostname"      value={sw.hostname} />
        <InfoRow label="Model"         value={sw.model} />
        <InfoRow label="Serial number" value={sw.serialNumber} />
        <InfoRow label="NX-OS version" value={sw.nxosVersion} />
        <InfoRow label="Status"        value={
          <span className={cn(
            "text-xs font-medium px-1.5 py-0.5 rounded border",
            sw.isActive
              ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-red-100 text-red-800 border-red-200"
          )}>
            {sw.isActive ? "Active" : "Inactive"}
          </span>
        } />
        <InfoRow label="Last seen"     value={sw.lastSeenAt ? new Date(sw.lastSeenAt).toLocaleString() : null} />
        <InfoRow label="Registered"    value={new Date(sw.createdAt).toLocaleString()} />
      </div>

      {/* ── Database counts ───────────────────────────────────────────────── */}
      {sw._count && (
        <div className="rounded-xl border bg-card p-5 space-y-2">
          <h3 className="text-sm font-medium mb-3">Stored data</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ["FC aliases",    sw._count.fcAliases],
              ["Zones",         sw._count.zones],
              ["Zone sets",     sw._count.zoneSets],
              ["Snapshots",     sw._count.zoningSnapshots],
              ["Metric rows",   sw._count.portMetrics],
            ].map(([label, count]) => (
              <div key={String(label)} className="rounded-lg border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold tabular-nums mt-0.5">
                  {Number(count).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Credentials (real switches only) ─────────────────────────────── */}
      {!simActive && isOperator && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-medium">NX-API credentials</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Update stored credentials if the switch password has changed. The new credentials
              are tested against the switch before saving.
            </p>
          </div>
          <CredentialForm switchId={switchId} ipAddress={switchData.ipAddress} />
        </div>
      )}

      {/* Simulator port configuration — only when MDS_SIMULATE=true */}
      {simActive && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"/>
              Simulator port configuration
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure simulated ports for this switch. Changes take effect on the next poll.
            </p>
          </div>
          <SimulatorConfig switchId={switchId} />
        </div>
      )}
    </div>
  );
}
