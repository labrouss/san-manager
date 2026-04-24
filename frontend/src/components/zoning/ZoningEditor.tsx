// =============================================================================
// components/zoning/ZoningEditor.tsx
// Brocade-style zoning editor with:
//   • Left panel: Edit view (draft zones & zone sets)
//   • Right panel: Effective view (active on switch)
//   • Commit & Activate button with pre-flight confirmation
// =============================================================================

import { useState, useCallback } from "react";
import { cn } from "../../lib/utils";
import {
  useZones, useZoneSets, createZone, createZoneSet,
  addZoneToSet, removeZoneFromSet, addZoneMember, removeZoneMember,
  deleteZone, commitAndActivate, useKnownWwns, syncZonesFromSwitch,
} from "../../hooks/useZoningApi";
import { Zone, ZoneSet, CommitResult } from "../../types/api.types";
import { WWN_REGEX } from "../../lib/validation";

// ---------------------------------------------------------------------------
// Tiny shared UI primitives (inlined to keep the file self-contained)
// ---------------------------------------------------------------------------

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "draft" | "active" | "danger" }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border",
      variant === "active"  && "bg-emerald-100 text-emerald-800 border-emerald-200",
      variant === "draft"   && "bg-amber-100 text-amber-800 border-amber-200",
      variant === "danger"  && "bg-red-100 text-red-800 border-red-200",
      variant === "default" && "bg-gray-100 text-gray-700 border-gray-200"
    )}>
      {children}
    </span>
  );
}

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-border bg-background px-3 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
        "placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

function Button({
  children, variant = "default", size = "md", disabled, onClick, className,
}: {
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost" | "danger" | "commit";
  size?: "sm" | "md";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-4 text-sm",
        variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
        variant === "outline" && "border border-border bg-background hover:bg-accent text-foreground",
        variant === "ghost"   && "hover:bg-accent text-muted-foreground hover:text-foreground",
        variant === "danger"  && "bg-red-600 text-white hover:bg-red-700",
        variant === "commit"  && "bg-emerald-600 text-white hover:bg-emerald-700 font-semibold",
        className
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Zone member row (used in both edit and effective views)
// ---------------------------------------------------------------------------
function ZoneMemberRow({
  value,
  memberType,
  onRemove,
  editable = false,
}: {
  value: string;
  memberType: string;
  onRemove?: () => void;
  editable?: boolean;
}) {
  return (
    <div className="group flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50">
      <span className={cn(
        "w-14 text-[10px] font-medium uppercase tracking-wide rounded px-1",
        memberType === "PWWN"         && "text-blue-700 bg-blue-50",
        memberType === "DEVICE_ALIAS" && "text-purple-700 bg-purple-50",
        memberType === "FCID"         && "text-gray-600 bg-gray-100",
      )}>
        {memberType === "DEVICE_ALIAS" ? "alias" : memberType.toLowerCase()}
      </span>
      <span className="font-mono text-xs flex-1 text-foreground">{value}</span>
      {editable && onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity"
          title="Remove member"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Add member" inline form
// ---------------------------------------------------------------------------
function AddMemberForm({
  zoneId, switchId, vsanId, onAdded,
}: {
  zoneId: string; switchId: string; vsanId: number; onAdded: () => void;
}) {
  const [type, setType]   = useState<"PWWN" | "DEVICE_ALIAS">("PWWN");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy]   = useState(false);
  const { wwns }          = useKnownWwns(switchId, vsanId);

  const validate = () => {
    if (!value.trim()) return "Enter a value";
    if (type === "PWWN" && !WWN_REGEX.test(value.trim()))
      return "Invalid WWN — expected xx:xx:xx:xx:xx:xx:xx:xx";
    return null;
  };

  const add = async () => {
    const err = validate();
    if (err) { setError(err); return; }
    setBusy(true);
    try {
      await addZoneMember(zoneId, type, value.trim().toLowerCase());
      setValue(""); setError(null); onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add member");
    } finally { setBusy(false); }
  };

  // WWN options for dropdown
  const wwnOptions = wwns.filter(w => w.pwwn);
  const aliasOptions = wwns.filter(w => w.alias);

  return (
    <div className="mt-2 space-y-1.5 border-t pt-2">
      <div className="flex gap-1.5 flex-wrap">
        <select value={type} onChange={(e) => { setType(e.target.value as "PWWN" | "DEVICE_ALIAS"); setValue(""); }}
          className="h-7 rounded border border-border bg-background px-2 text-xs">
          <option value="PWWN">pWWN</option>
          <option value="DEVICE_ALIAS">Alias</option>
        </select>

        {type === "PWWN" && wwnOptions.length > 0 ? (
          <select value={value} onChange={(e) => { setValue(e.target.value); setError(null); }}
            className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs font-mono">
            <option value="">— select or type below —</option>
            {wwnOptions.map(w => (
              <option key={w.pwwn} value={w.pwwn}>
                {w.alias ? `${w.alias} (${w.pwwn})` : w.pwwn}
                {w.connectedInterface ? ` @ ${w.connectedInterface}` : ""}
              </option>
            ))}
          </select>
        ) : type === "DEVICE_ALIAS" && aliasOptions.length > 0 ? (
          <select value={value} onChange={(e) => { setValue(e.target.value); setError(null); }}
            className="h-7 flex-1 rounded border border-border bg-background px-2 text-xs">
            <option value="">— select alias —</option>
            {aliasOptions.map(w => (
              <option key={w.alias} value={w.alias!}>{w.alias} ({w.pwwn})</option>
            ))}
          </select>
        ) : (
          <Input
            placeholder={type === "PWWN" ? "21:00:00:24:ff:8a:1b:2c" : "DB_Server_HBA_A"}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === "Enter" && add()}
            className="h-7 text-xs font-mono flex-1"
          />
        )}
        <Button variant="outline" size="sm" onClick={add} disabled={busy || !value}>
          {busy ? "…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone card (edit mode)
// ---------------------------------------------------------------------------
function ZoneCard({
  zone,
  selected,
  onSelect,
  onDelete,
  switchId,
  vsanId,
}: {
  zone: Zone;
  selected: boolean;
  onSelect: (z: Zone) => void;
  onDelete: (id: string) => void;
  switchId: string;
  vsanId: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-colors cursor-pointer",
        selected && "border-primary ring-1 ring-primary"
      )}
      onClick={() => onSelect(zone)}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-muted-foreground"
        >
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            className={cn("transition-transform", expanded && "rotate-90")}
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="font-mono text-sm font-medium flex-1 truncate">{zone.name}</span>
        <span className="text-xs text-muted-foreground">{zone.members.length}m</span>
        {zone.isDraft && <Badge variant="draft">draft</Badge>}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(zone.id); }}
          className="text-muted-foreground hover:text-red-500 transition-colors"
          title="Delete zone"
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 2l9 9M11 2l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t" onClick={(e) => e.stopPropagation()}>
          {zone.members.length === 0 ? (
            <p className="text-xs text-muted-foreground italic py-2">No members yet</p>
          ) : (
            <div className="mt-1 space-y-0.5">
              {zone.members.map((m) => (
                <ZoneMemberRow
                  key={m.id}
                  value={m.value}
                  memberType={m.memberType}
                  editable
                  onRemove={async () => {
                    await removeZoneMember(zone.id, m.id);
                  }}
                />
              ))}
            </div>
          )}
          {!addingMember ? (
            <button
              onClick={() => setAddingMember(true)}
              className="mt-2 text-xs text-primary hover:underline"
            >
              + Add member
            </button>
          ) : (
            <AddMemberForm
              zoneId={zone.id}
              switchId={switchId}
              vsanId={vsanId}
              onAdded={() => setAddingMember(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commit confirmation modal (inline, no fixed positioning)
// ---------------------------------------------------------------------------
function CommitModal({
  zoneSet,
  onConfirm,
  onCancel,
  busy,
  result,
}: {
  zoneSet: ZoneSet;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  result: { success: boolean; errors?: string[]; snapshotId: string; commandsExecuted: string[] } | null;
}) {
  return (
    <div
      style={{ minHeight: 320, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      className="rounded-xl"
    >
      <div className="bg-card border rounded-xl p-6 w-full max-w-md shadow-lg space-y-4">
        {!result ? (
          <>
            <h2 className="text-base font-medium">Commit &amp; activate zone set?</h2>
            <div className="text-sm text-muted-foreground space-y-1">
              <p>Zone set: <span className="font-mono text-foreground">{zoneSet.name}</span></p>
              <p>VSAN: <span className="font-mono text-foreground">{zoneSet.vsanId}</span></p>
              <p>Zones: <span className="font-mono text-foreground">{zoneSet.members.length}</span></p>
            </div>
            <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              A pre-commit snapshot of the current switch state will be saved to Postgres automatically before any changes are made.
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
              <Button variant="commit" onClick={onConfirm} disabled={busy}>
                {busy ? "Committing…" : "Confirm & activate"}
              </Button>
            </div>
          </>
        ) : result.success ? (
          <>
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-emerald-600">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M6 10l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h2 className="text-base font-medium text-emerald-700">Activation successful</h2>
            </div>
            <p className="text-xs text-muted-foreground">
              Snapshot saved: <span className="font-mono">{result.snapshotId}</span>
            </p>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {result.commandsExecuted.length} commands sent
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-[11px] overflow-auto max-h-40">
                {result.commandsExecuted.join("\n")}
              </pre>
            </details>
            <Button variant="outline" onClick={onCancel}>Close</Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-red-600">
                <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M10 6v4M10 14h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <h2 className="text-base font-medium text-red-700">Commit failed</h2>
            </div>
            {result.snapshotId && (
              <p className="text-xs text-muted-foreground">
                Pre-commit snapshot: <span className="font-mono">{result.snapshotId}</span>
              </p>
            )}
            <ul className="text-xs text-red-700 space-y-1">
              {result.errors?.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
            <Button variant="outline" onClick={onCancel}>Close</Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ZoningEditor component
// ---------------------------------------------------------------------------
interface ZoningEditorProps {
  switchId: string;
  vsanId: number;
}

export function ZoningEditor({ switchId, vsanId }: ZoningEditorProps) {
  const { zones, isLoading: zonesLoading } = useZones(switchId, vsanId);
  const { zoneSets, isLoading: zsLoading }  = useZoneSets(switchId, vsanId);

  const [selectedZone, setSelectedZone]         = useState<Zone | null>(null);
  const [selectedZoneSet, setSelectedZoneSet]   = useState<ZoneSet | null>(null);
  const [newZoneName, setNewZoneName]           = useState("");
  const [newZoneSetName, setNewZoneSetName]     = useState("");
  const [view, setView]                         = useState<"edit" | "effective">("edit");
  const [commitModal, setCommitModal]           = useState(false);
  const [committing, setCommitting]             = useState(false);
  const [commitResult, setCommitResult]         = useState<CommitResult | null>(null);
  const [error, setError]                       = useState<string | null>(null);
  const [syncing,     setSyncing]               = useState(false);
  const [syncResult,  setSyncResult]            = useState<string | null>(null);

  const activeZoneSet = zoneSets.find((zs) => zs.isActive);
  const draftZoneSets = zoneSets.filter((zs) => zs.isDraft || !zs.isActive);

  const handleCreateZone = async () => {
    if (!newZoneName.trim()) return;
    try {
      await createZone({ switchId, name: newZoneName.trim(), vsanId });
      setNewZoneName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create zone");
    }
  };

  const handleCreateZoneSet = async () => {
    if (!newZoneSetName.trim()) return;
    try {
      await createZoneSet({ switchId, name: newZoneSetName.trim(), vsanId });
      setNewZoneSetName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create zone set");
    }
  };

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await syncZonesFromSwitch(switchId, vsanId);
      setSyncResult(`Synced from switch: ${r.zonesImported} zones, ${r.zoneSetsImported} zone sets, ${r.aliasesImported} aliases.`);
      setTimeout(() => setSyncResult(null), 6000);
    } catch (err) {
      setSyncResult(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setSyncing(false); }
  };

  const handleCommit = useCallback(async () => {
    if (!selectedZoneSet) return;
    setCommitting(true);
    try {
      const result = await commitAndActivate({
        switchId,
        vsanId,
        zoneSetId: selectedZoneSet.id,
      });
      setCommitResult(result);
    } catch (e) {
      setCommitResult({
        success: false,
        snapshotId: "",
        activatedZoneSet: "",
        commandsExecuted: [],
        errors: [e instanceof Error ? e.message : "Unknown error"],
      });
    } finally {
      setCommitting(false);
    }
  }, [selectedZoneSet, switchId, vsanId]);

  return (
    <div className="space-y-4">
      {/* Header + view toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Zone editor — VSAN {vsanId}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {draftZoneSets.length} draft · {activeZoneSet ? `Active: ${activeZoneSet.name}` : "No active zone set"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Sync from switch */}
          <button
            onClick={handleSync}
            disabled={syncing}
            title="Pull live zone database from switch into local DB"
            className="h-8 px-3 text-xs rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 flex items-center gap-1.5"
          >
            {syncing ? (
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1.5 6.5A5 5 0 1 1 6.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <path d="M1.5 4v2.5H4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {syncing ? "Syncing…" : "Sync from switch"}
          </button>

          {/* Edit / Effective toggle */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            <button
              onClick={() => setView("edit")}
              className={cn("px-3 py-1.5 transition-colors", view === "edit" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}
            >
              Edit
            </button>
            <button
              onClick={() => setView("effective")}
              className={cn("px-3 py-1.5 transition-colors", view === "effective" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground")}
            >
              Effective
            </button>
          </div>
        </div>
      </div>

      {/* Sync result toast */}
      {syncResult && (
        <div className={`rounded-md px-3 py-2 text-xs border flex items-center gap-2 ${
          syncResult.startsWith("Sync failed")
            ? "bg-red-50 dark:bg-red-950/20 border-red-200 text-red-700 dark:text-red-400"
            : "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 text-emerald-800 dark:text-emerald-300"
        }`}>
          {syncResult.startsWith("Sync failed") ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7 4v3M7 10h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="flex-shrink-0">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
          {syncResult}
          <button onClick={() => setSyncResult(null)} className="ml-auto text-muted-foreground hover:text-foreground">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Dismiss</button>
        </div>
      )}

      {/* Commit modal */}
      {commitModal && selectedZoneSet && (
        <CommitModal
          zoneSet={selectedZoneSet}
          onConfirm={handleCommit}
          onCancel={() => { setCommitModal(false); setCommitResult(null); }}
          busy={committing}
          result={commitResult}
        />
      )}

      {view === "edit" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LEFT: Zones */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zones</h3>
              <span className="text-xs text-muted-foreground">{zones.length} total</span>
            </div>

            <div className="flex gap-1.5">
              <Input
                placeholder="New zone name"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateZone()}
                className="h-8 text-sm font-mono"
              />
              <Button variant="outline" size="sm" onClick={handleCreateZone}>Create</Button>
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {zonesLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
              ) : zones.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-4 text-center">No zones yet — create one above</p>
              ) : (
                zones.map((zone) => (
                  <ZoneCard
                    key={zone.id}
                    zone={zone}
                    selected={selectedZone?.id === zone.id}
                    onSelect={setSelectedZone}
                    switchId={switchId}
                    vsanId={vsanId}
                    onDelete={async (id) => {
                      if (confirm(`Delete zone "${zone.name}"?`)) {
                        await deleteZone(id);
                        if (selectedZone?.id === id) setSelectedZone(null);
                      }
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT: Zone Sets */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zone sets</h3>
              <span className="text-xs text-muted-foreground">{zoneSets.length} total</span>
            </div>

            <div className="flex gap-1.5">
              <Input
                placeholder="New zone set name"
                value={newZoneSetName}
                onChange={(e) => setNewZoneSetName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateZoneSet()}
                className="h-8 text-sm font-mono"
              />
              <Button variant="outline" size="sm" onClick={handleCreateZoneSet}>Create</Button>
            </div>

            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {zsLoading ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
              ) : (
                zoneSets.map((zs) => (
                  <div
                    key={zs.id}
                    onClick={() => setSelectedZoneSet(zs)}
                    className={cn(
                      "rounded-lg border bg-card p-3 cursor-pointer transition-colors",
                      selectedZoneSet?.id === zs.id && "border-primary ring-1 ring-primary"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-sm font-medium flex-1 truncate">{zs.name}</span>
                      {zs.isActive  && <Badge variant="active">active</Badge>}
                      {zs.isDraft   && <Badge variant="draft">draft</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{zs.members.length} zones</p>

                    {/* Zone membership within the set */}
                    <div className="space-y-1">
                      {zs.members.map((zsm) => (
                        <div key={zsm.zoneId} className="group flex items-center gap-2 text-xs py-0.5">
                          <span className="font-mono flex-1 text-foreground">{zsm.zone.name}</span>
                          <span className="text-muted-foreground">{zsm.zone.members.length}m</span>
                  <button
                                                onClick={async (e) => {
                              e.stopPropagation();
                              await removeZoneFromSet(zs.id, zsm.zoneId);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"
                          >
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <path d="M1 1l9 9M10 1l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add zone dropdown */}
                    {zones.filter((z) => !zs.members.some((m) => m.zoneId === z.id)).length > 0 && (
                      <select
                        className="mt-2 w-full h-7 text-xs rounded border border-border bg-background px-2 text-muted-foreground"
                        value=""
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          if (e.target.value) {
                            await addZoneToSet(zs.id, e.target.value);
                            e.target.value = "";
                          }
                        }}
                      >
                        <option value="">+ Add zone to set…</option>
                        {zones
                          .filter((z) => !zs.members.some((m) => m.zoneId === z.id))
                          .map((z) => (
                            <option key={z.id} value={z.id}>{z.name}</option>
                          ))}
                      </select>
                    )}

                    {/* Commit button */}
                    {selectedZoneSet?.id === zs.id && (
                      <div className="mt-3 pt-2 border-t" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="commit"
                          className="w-full"
                          onClick={() => { setCommitModal(true); setCommitResult(null); }}
                          disabled={zs.members.length === 0}
                        >
                          Commit &amp; activate
                        </Button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* EFFECTIVE VIEW — read-only representation of the active zone set */
        <div className="space-y-3">
          {!activeZoneSet ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              No zone set is currently active on VSAN {vsanId}
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <div className="flex items-center gap-3 p-4 border-b">
                <div>
                  <h3 className="text-sm font-medium font-mono">{activeZoneSet.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activated {activeZoneSet.activatedAt
                      ? new Date(activeZoneSet.activatedAt).toLocaleString()
                      : "—"}
                  </p>
                </div>
                <Badge variant="active">effective</Badge>
              </div>
              <div className="p-4 space-y-3">
                {activeZoneSet.members.map((zsm) => (
                  <div key={zsm.zoneId} className="rounded-md border bg-muted/20 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-sm font-medium">{zsm.zone.name}</span>
                      <span className="text-xs text-muted-foreground">{zsm.zone.members.length} members</span>
                    </div>
                    <div className="space-y-0.5">
                      {zsm.zone.members.map((m) => (
                        <ZoneMemberRow
                          key={m.id}
                          value={m.value}
                          memberType={m.memberType}
                          editable={false}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
