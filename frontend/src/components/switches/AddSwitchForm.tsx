// =============================================================================
// components/switches/AddSwitchForm.tsx
// Modal for registering a switch.
// In simulation mode: shows a simplified form (IP only, credentials optional).
// In production mode: full form with credential verification.
// =============================================================================

import { useState, useEffect } from "react";
import { registerSwitch } from "../../hooks/useZoningApi";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function getAuthHeaders(): Record<string, string> {
  const token = sessionStorage.getItem("san-auth-token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

interface AddSwitchModalProps {
  onSuccess: () => void;
  onCancel:  () => void;
}

export function AddSwitchModal({ onSuccess, onCancel }: AddSwitchModalProps) {
  const [simMode, setSimMode] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    ipAddress: "",
    username:  "admin",
    password:  "",
    port:      "443",
    hostname:  "",
    model:     "",
  });
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  // Check if simulator is active
  useEffect(() => {
    fetch(`${BASE}/settings/simulate`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setSimMode(d.simulate === true))
      .catch(() => setSimMode(false));
  }, []);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ipAddress.trim()) { setError("IP address is required"); return; }
    setBusy(true); setError(null);
    try {
      await registerSwitch({
        ipAddress: form.ipAddress.trim(),
        username:  form.username.trim() || "admin",
        password:  form.password        || "simulated",
        port:      parseInt(form.port)  || 443,
        hostname:  form.hostname.trim() || undefined,
        model:     form.model.trim()    || undefined,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card border rounded-xl shadow-2xl w-full max-w-lg p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-medium">Add MDS switch</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {simMode === null
                ? "Checking mode…"
                : simMode
                ? "Simulator mode active — no real switch needed."
                : "Connects via NX-API (HTTPS) to verify credentials before saving."}
            </p>
          </div>
          <button onClick={onCancel}
            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Simulator banner */}
        {simMode === true && (
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"/>
              <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                MDS Simulator is active
              </span>
            </div>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              Enter any IP address to create a simulated switch. The simulator will respond to all
              NX-API commands with realistic data. Credentials are not verified.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {["192.168.1.10", "10.0.0.1", "172.16.0.1"].map(ip => (
                <button key={ip} type="button"
                  onClick={() => setForm(p => ({ ...p, ipAddress: ip }))}
                  className="h-7 px-2 text-xs rounded border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 font-mono">
                  {ip}
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {/* IP + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-foreground">
                Management IP address <span className="text-red-500">*</span>
              </label>
              <input
                value={form.ipAddress} onChange={set("ipAddress")}
                placeholder="192.168.1.100"
                autoFocus
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Port {simMode && <span className="text-muted-foreground">(ignored)</span>}
              </label>
              <input
                value={form.port} onChange={set("port")} type="number"
                disabled={simMode === true}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-40"
              />
            </div>
          </div>

          {/* Credentials — dimmed in sim mode */}
          <div className={cn("grid grid-cols-2 gap-3 transition-opacity", simMode === true && "opacity-40 pointer-events-none")}>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Username {!simMode && <span className="text-red-500">*</span>}
              </label>
              <input
                value={form.username} onChange={set("username")}
                placeholder="admin" disabled={simMode === true}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Password {!simMode && <span className="text-red-500">*</span>}
              </label>
              <input
                type="password" value={form.password} onChange={set("password")}
                placeholder={simMode ? "not required" : "••••••••"}
                disabled={simMode === true}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Optional fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Hostname (optional)</label>
              <input
                value={form.hostname} onChange={set("hostname")}
                placeholder={simMode ? "mds-sim-a" : "mds-core-a"}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Model (optional)</label>
              <input
                value={form.model} onChange={set("model")}
                placeholder="MDS 9396S"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* NX-API hint — only in real mode */}
          {simMode === false && (
            <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
              <p>Enable NX-API on the switch:</p>
              <p className="font-mono text-foreground text-[11px]">feature nxapi</p>
              <p className="font-mono text-foreground text-[11px]">nxapi http port 80 <span className="opacity-50 font-sans">(or)</span> nxapi https port 443</p>
              <p className="opacity-70">Endpoint used: <span className="font-mono">POST /ins</span> · Default port: 80 (HTTP)</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onCancel} disabled={busy}
              className="h-9 px-4 text-sm rounded-md border border-border bg-background hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || simMode === null}
              className={cn(
                "h-9 px-5 text-sm rounded-md font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "flex items-center gap-2"
              )}
            >
              {busy && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              )}
              {busy
                ? simMode ? "Adding…" : "Connecting…"
                : simMode ? "Add simulated switch" : "Add switch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Keep old name as alias
export { AddSwitchModal as AddSwitchForm };
