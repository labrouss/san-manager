// =============================================================================
// components/settings/SettingsPage.tsx
// Admin-only: toggle simulate/seed, view DB stats, backup & restore
// =============================================================================

import { useState, useRef } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useAuth } from "../../context/AuthContext";
import { SimulatorConfig } from "./SimulatorConfig";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("san-auth-token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

interface Settings {
  runtime: {
    simulate:    boolean;
    seedEnabled: boolean;
    nodeEnv:     string;
    jwtExpires:  string;
    version:     string;
    uptime:      number;
  };
  database: {
    switches:     number;
    aliases:      number;
    zones:        number;
    zoneSets:     number;
    snapshots:    number;
    users:        number;
    metrics:      number;
    oldestMetric: string | null;
    newestMetric: string | null;
  };
}

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Toggle row ───────────────────────────────────────────────────────────────
function ToggleRow({
  label, description, checked, onChange, disabled,
}: {
  label: string; description: string;
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          checked ? "bg-primary" : "bg-muted",
          disabled && "opacity-40 cursor-not-allowed"
        )}
      >
        <span className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0"
        )}/>
      </button>
    </div>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background p-3 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export function SettingsPage() {
  const { isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: settings, isLoading, mutate } = useSWR<Settings>(`${BASE}/settings`, fetcher, {
    refreshInterval: 10_000,
  });

  const [saving,       setSaving]       = useState(false);
  const [backingUp,    setBackingUp]    = useState(false);
  const [restoring,    setRestoring]    = useState(false);
  const [purging,      setPurging]      = useState(false);
  const [purgedays,    setPurgeDays]    = useState("90");
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [restoreError,  setRestoreError]  = useState<string | null>(null);
  const [toast,        setToast]        = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const updateSetting = async (key: "simulate" | "seedEnabled", value: boolean) => {
    setSaving(true);
    try {
      await fetch(`${BASE}/settings`, {
        method:  "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body:    JSON.stringify({ [key]: value }),
      });
      await mutate();
      showToast(`${key === "simulate" ? "Simulation" : "Seed"} mode ${value ? "enabled" : "disabled"}.`);
    } catch { showToast("Failed to update setting."); }
    finally { setSaving(false); }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const res = await fetch(`${BASE}/backup`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Backup failed");

      // Trigger browser download
      const blob = await res.blob();
      const cd   = res.headers.get("Content-Disposition") ?? "";
      const name = cd.match(/filename="([^"]+)"/)?.[1] ?? "san-backup.json";
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
      showToast("Backup downloaded successfully.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Backup failed");
    } finally { setBackingUp(false); }
  };

  const handleRestoreFile = async (file: File) => {
    setRestoring(true); setRestoreResult(null); setRestoreError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      const res = await fetch(`${BASE}/restore`, {
        method:  "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body:    JSON.stringify(json),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Restore failed");

      const r = data.restored;
      setRestoreResult(
        `Restored: ${r.switches} switch(es), ${r.aliases} alias(es), ${r.zones} zone(s), ` +
        `${r.zoneSets} zone set(s), ${r.snapshots} snapshot(s), ${r.users} user(s).` +
        (data.sourceExportedAt ? ` (from backup ${new Date(data.sourceExportedAt).toLocaleString()})` : "")
      );
      await mutate();
      globalMutate(() => true, undefined, { revalidate: true });
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Restore failed");
    } finally { setRestoring(false); }
  };

  const handlePurge = async () => {
    if (!confirm(`Delete all port metrics older than ${purgedays} days? This cannot be undone.`)) return;
    setPurging(true);
    try {
      const res = await fetch(`${BASE}/settings/metrics?olderThanDays=${purgedays}`, {
        method: "DELETE", headers: getAuthHeaders(),
      });
      const data = await res.json();
      showToast(`Purged ${data.deleted.toLocaleString()} metric rows older than ${purgedays} days.`);
      await mutate();
    } catch { showToast("Purge failed."); }
    finally { setPurging(false); }
  };

  if (!isAdmin) return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      Admin access required to view settings.
    </div>
  );

  const db = settings?.database;
  const rt = settings?.runtime;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Toast */}
      {toast && (
        <div className="fixed top-16 right-4 z-50 rounded-lg border bg-card shadow-lg px-4 py-3 text-sm flex items-center gap-2 animate-in fade-in">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-emerald-500">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {toast}
        </div>
      )}

      <div>
        <h2 className="text-base font-medium">Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Platform configuration, database management, and backup/restore.
        </p>
      </div>

      {/* Runtime info */}
      {rt && (
        <Section title="Runtime information">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              ["Version",    rt.version],
              ["Environment", rt.nodeEnv],
              ["JWT expiry", rt.jwtExpires],
              ["Uptime",     `${Math.floor(rt.uptime / 3600)}h ${Math.floor((rt.uptime % 3600) / 60)}m`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-background px-3 py-2">
                <p className="text-muted-foreground">{k}</p>
                <p className="font-mono font-medium mt-0.5">{v}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Feature flags */}
      <Section
        title="Feature flags"
        subtitle="Changes take effect immediately. Simulation mode restarts use the built-in MDS 9000 simulator."
      >
        <div className="divide-y divide-border">
          <div className="pb-3">
            <ToggleRow
              label="MDS 9000 Simulator"
              description="Use built-in simulator instead of real switch NX-API calls. Safe for development and testing. Aliases and zoning changes are stored in memory."
              checked={settings?.runtime.simulate ?? false}
              onChange={v => updateSetting("simulate", v)}
              disabled={saving || isLoading}
            />
            {settings?.runtime.simulate && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 ml-0 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded px-2 py-1">
                Simulator active — switch operations return simulated data. Disable for production.
              </p>
            )}
          </div>
          <div className="pt-3">
            <ToggleRow
              label="Demo seed data"
              description="Populate the database with a sample switch, zones, aliases, and metrics on next restart. Only effective if the database is empty."
              checked={settings?.runtime.seedEnabled ?? false}
              onChange={v => updateSetting("seedEnabled", v)}
              disabled={saving || isLoading}
            />
          </div>
        </div>
      </Section>

      {/* Simulator configuration — only when active */}
      {settings?.runtime.simulate && (
        <Section
          title="Simulator configuration"
          subtitle="Configure the built-in MDS 9000 simulator. Select a switch below to configure its ports."
        >
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded px-3 py-2">
            Simulator is active. Switch any port UP/DOWN, change mode, speed, or VSAN.
            Changes take effect immediately on the next poll or data query.
          </p>
        </Section>
      )}

      {/* Database statistics */}
      <Section title="Database statistics" subtitle="Live counts from the PostgreSQL database.">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="rounded-lg border bg-background p-3 h-16 animate-pulse"/>
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Switches"  value={db?.switches  ?? 0}/>
              <StatCard label="FC Aliases" value={db?.aliases  ?? 0}/>
              <StatCard label="Zones"     value={db?.zones     ?? 0}/>
              <StatCard label="Zone sets" value={db?.zoneSets  ?? 0}/>
              <StatCard label="Snapshots" value={db?.snapshots ?? 0}/>
              <StatCard label="Users"     value={db?.users     ?? 0}/>
              <StatCard
                label="Port metrics"
                value={db?.metrics ?? 0}
                sub={db?.oldestMetric
                  ? `${new Date(db.oldestMetric).toLocaleDateString()} → ${new Date(db.newestMetric!).toLocaleDateString()}`
                  : "No data"}
              />
            </div>
          </>
        )}
      </Section>

      {/* Backup & Restore */}
      <Section
        title="Backup & Restore"
        subtitle="Export all users, switches, aliases, zones, zone sets, and snapshots as a JSON file. Restore merges records using upsert — existing data is not deleted."
      >
        <div className="space-y-4">
          {/* Backup */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-background">
            <div>
              <p className="text-sm font-medium">Export backup</p>
              <p className="text-xs text-muted-foreground">
                Downloads a timestamped JSON file containing all application data
                (excludes port metrics time-series).
              </p>
            </div>
            <button
              onClick={handleBackup}
              disabled={backingUp}
              className="h-9 px-4 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 flex-shrink-0"
            >
              {backingUp ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 1v8M4.5 7l3 3 3-3M2 10v2.5A.5.5 0 0 0 2.5 13h10a.5.5 0 0 0 .5-.5V10"
                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {backingUp ? "Exporting…" : "Download backup"}
            </button>
          </div>

          {/* Restore */}
          <div className="p-3 rounded-lg border bg-background space-y-3">
            <div>
              <p className="text-sm font-medium">Restore from backup</p>
              <p className="text-xs text-muted-foreground">
                Select a JSON backup file. Records are upserted — existing data is preserved where IDs match.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleRestoreFile(file);
                e.target.value = "";
              }}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={restoring}
              className="h-9 px-4 text-sm rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 flex items-center gap-2"
            >
              {restoring ? (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 14V6M4.5 8l3-3 3 3M2 5V2.5A.5.5 0 0 1 2.5 2h10a.5.5 0 0 1 .5.5V5"
                    stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              {restoring ? "Restoring…" : "Select backup file…"}
            </button>

            {restoreResult && (
              <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                ✓ {restoreResult}
              </div>
            )}
            {restoreError && (
              <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                ✗ {restoreError}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Metrics purge */}
      <Section
        title="Maintenance"
        subtitle="Purge old port metrics data to reclaim database space. This is irreversible."
      >
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-sm">Delete port metrics older than</p>
          <div className="flex items-center gap-1.5">
            <input
              type="number" min={1} max={3650}
              value={purgedays}
              onChange={e => setPurgeDays(e.target.value)}
              className="h-8 w-20 rounded-md border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          <button
            onClick={handlePurge}
            disabled={purging}
            className="h-8 px-3 text-sm rounded-md border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/20 disabled:opacity-50"
          >
            {purging ? "Purging…" : "Purge metrics"}
          </button>
          {db && (
            <span className="text-xs text-muted-foreground">
              {db.metrics.toLocaleString()} rows currently stored
            </span>
          )}
        </div>
      </Section>
    </div>
  );
}
