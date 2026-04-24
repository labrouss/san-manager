// =============================================================================
// components/aliases/AliasManager.tsx
// Brocade-style FC alias management + Alias Bridge (new device detection)
// =============================================================================

import { useState } from "react";
import { useAliases, createAlias, deleteAlias, syncAliases } from "../../hooks/useZoningApi";
import { FcAlias, AliasSyncResult } from "../../types/api.types";
import { WWN_REGEX } from "../../lib/validation";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Inline form for creating a new alias
// ---------------------------------------------------------------------------
function CreateAliasForm({
  switchId,
  onCreated,
}: {
  switchId: string;
  onCreated: () => void;
}) {
  const [name, setName]           = useState("");
  const [wwn, setWwn]             = useState("");
  const [desc, setDesc]           = useState("");
  const [push, setPush]           = useState(false);
  const [busy, setBusy]           = useState(false);
  const [errors, setErrors]       = useState<Partial<{ name: string; wwn: string; general: string }>>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!name.trim())            e.name = "Alias name is required";
    if (!wwn.trim())             e.wwn  = "WWN is required";
    else if (!WWN_REGEX.test(wwn.trim())) e.wwn = "Invalid format — expected xx:xx:xx:xx:xx:xx:xx:xx";
    return e;
  };

  const submit = async () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setBusy(true);
    try {
      await createAlias({ switchId, name: name.trim(), wwn: wwn.trim().toLowerCase(), description: desc.trim() || undefined, pushToSwitch: push });
      setName(""); setWwn(""); setDesc(""); setErrors({});
      onCreated();
    } catch (err) {
      setErrors({ general: err instanceof Error ? err.message : "Failed to create alias" });
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <h3 className="text-sm font-medium">New FC alias</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Alias name</label>
          <input
            className={cn(
              "h-8 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring",
              errors.name ? "border-red-400" : "border-border"
            )}
            placeholder="DB_Server_01_HBA_A"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: undefined })); }}
          />
          {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Port WWN</label>
          <input
            className={cn(
              "h-8 w-full rounded-md border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring",
              errors.wwn ? "border-red-400" : "border-border"
            )}
            placeholder="21:00:00:24:ff:8a:1b:2c"
            value={wwn}
            onChange={(e) => { setWwn(e.target.value); setErrors((p) => ({ ...p, wwn: undefined })); }}
          />
          {errors.wwn && <p className="text-xs text-red-600">{errors.wwn}</p>}
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-xs text-muted-foreground">Description (optional)</label>
          <input
            className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Production database HBA port A"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={push}
            onChange={(e) => setPush(e.target.checked)}
            className="rounded"
          />
          <span>Also push to switch as <code className="text-xs bg-muted px-1 rounded">device-alias</code></span>
        </label>
        <div className="flex gap-2">
          {errors.general && <span className="text-xs text-red-600">{errors.general}</span>}
          <button
            onClick={submit}
            disabled={busy}
            className="h-8 px-4 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create alias"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alias bridge: panel showing new WWNs detected on switch with no local alias
// ---------------------------------------------------------------------------
function AliasBridgePanel({
  syncResult,
  switchId,
  onDismiss,
}: {
  syncResult: AliasSyncResult;
  switchId: string;
  onDismiss: () => void;
}) {
  const [names, setNames] = useState<Record<string, string>>(
    Object.fromEntries(syncResult.newAliasesOnSwitch.map((a) => [a.wwn, a.name]))
  );
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Set<string>>(new Set());

  const push = async (wwn: string) => {
    const name = names[wwn]?.trim();
    if (!name) return;
    setBusy((p) => ({ ...p, [wwn]: true }));
    try {
      await createAlias({ switchId, name, wwn, pushToSwitch: true });
      setDone((p) => new Set([...p, wwn]));
    } finally {
      setBusy((p) => ({ ...p, [wwn]: false }));
    }
  };

  const remaining = syncResult.newAliasesOnSwitch.filter((a) => !done.has(a.wwn));

  if (remaining.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between">
        <span className="text-sm text-emerald-800">All new devices have been named.</span>
        <button onClick={onDismiss} className="text-xs text-emerald-700 underline">Dismiss</button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-amber-900">
            {remaining.length} new device{remaining.length !== 1 ? "s" : ""} detected
          </h3>
          <p className="text-xs text-amber-700 mt-0.5">
            These WWNs are active on the switch but have no local alias. Give them a name.
          </p>
        </div>
        <button onClick={onDismiss} className="text-xs text-amber-700 underline">Dismiss</button>
      </div>
      <div className="space-y-2">
        {remaining.map((a) => (
          <div key={a.wwn} className="flex items-center gap-2 bg-white/60 rounded-md p-2">
            <span className="font-mono text-xs text-foreground w-52 flex-shrink-0">{a.wwn}</span>
            <input
              className="h-7 flex-1 rounded border border-amber-300 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
              placeholder="Give it an alias…"
              value={names[a.wwn] ?? ""}
              onChange={(e) => setNames((p) => ({ ...p, [a.wwn]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && push(a.wwn)}
            />
            <button
              onClick={() => push(a.wwn)}
              disabled={busy[a.wwn] || !names[a.wwn]?.trim()}
              className="h-7 px-3 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy[a.wwn] ? "…" : "Save & push"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alias table
// ---------------------------------------------------------------------------
function AliasTable({ aliases, onDelete }: { aliases: FcAlias[]; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
            <th className="text-left px-3 py-2 font-medium">Alias name</th>
            <th className="text-left px-3 py-2 font-medium">Port WWN</th>
            <th className="text-left px-3 py-2 font-medium">Description</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="w-8 px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {aliases.length === 0 ? (
            <tr>
              <td colSpan={5} className="text-center py-6 text-xs text-muted-foreground italic">
                No aliases — create one above or run a sync
              </td>
            </tr>
          ) : (
            aliases.map((a) => (
              <tr key={a.id} className={cn("hover:bg-muted/30 transition-colors", a.isOrphaned && "opacity-60")}>
                <td className="px-3 py-2 font-medium font-mono text-xs">{a.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{a.wwn}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{a.description ?? "—"}</td>
                <td className="px-3 py-2">
                  {a.isOrphaned ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 border border-red-200">orphaned</span>
                  ) : a.syncedAt ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200">synced</span>
                  ) : (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600 border border-gray-200">local only</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => onDelete(a.id)}
                    className="text-muted-foreground hover:text-red-500 transition-colors"
                    title="Delete alias"
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AliasManager component
// ---------------------------------------------------------------------------
interface AliasManagerProps {
  switchId: string;
}

export function AliasManager({ switchId }: AliasManagerProps) {
  const { aliases, isLoading } = useAliases(switchId);
  const [syncing, setSyncing]           = useState(false);
  const [syncResult, setSyncResult]     = useState<AliasSyncResult | null>(null);
  const [showCreate, setShowCreate]     = useState(false);
  const [search, setSearch]             = useState("");

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await syncAliases(switchId);
      setSyncResult(result);
    } catch (e) {
      console.error(e);
    } finally { setSyncing(false); }
  };

  const filteredAliases = aliases.filter(
    (a) =>
      !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.wwn.includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="absolute left-2.5 top-2 text-muted-foreground">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search alias or WWN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="h-8 px-3 text-sm rounded-md border border-border bg-background hover:bg-accent transition-colors"
        >
          {showCreate ? "Cancel" : "+ New alias"}
        </button>
        <button
          onClick={runSync}
          disabled={syncing}
          className="h-8 px-3 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {syncing ? "Syncing…" : "Sync from switch"}
        </button>
        <span className="text-xs text-muted-foreground ml-auto">{aliases.length} aliases</span>
      </div>

      {/* Alias Bridge panel */}
      {syncResult && syncResult.newAliasesOnSwitch.length > 0 && (
        <AliasBridgePanel
          syncResult={syncResult}
          switchId={switchId}
          onDismiss={() => setSyncResult(null)}
        />
      )}

      {/* Create form */}
      {showCreate && (
        <CreateAliasForm
          switchId={switchId}
          onCreated={() => setShowCreate(false)}
        />
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-8 text-sm text-muted-foreground">Loading aliases…</div>
      ) : (
        <AliasTable
          aliases={filteredAliases}
          onDelete={async (id) => {
            if (confirm("Delete this alias?")) await deleteAlias(id);
          }}
        />
      )}
    </div>
  );
}
