// =============================================================================
// components/zoning/SnapshotHistory.tsx
// Versioned backup browser with diff summary + manual capture
// =============================================================================

import { useState } from "react";
import { useSnapshots, captureSnapshot } from "../../hooks/useZoningApi";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

function getAuthHeaders() {
  const token = sessionStorage.getItem("san-auth-token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

async function restoreSnapshot(snapshotId: string): Promise<{ zonesRestored: number; aliasesRestored: number }> {
  const res = await fetch(`${BASE}/snapshots/${snapshotId}/restore`, {
    method: "POST",
    headers: getAuthHeaders() as HeadersInit,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Restore failed");
  return data;
}
import { ZoningSnapshot } from "../../types/api.types";
import { formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "../../lib/utils";

const TRIGGER_STYLES: Record<ZoningSnapshot["trigger"], string> = {
  PRE_COMMIT: "bg-amber-100 text-amber-800 border-amber-200",
  MANUAL:     "bg-blue-100 text-blue-800 border-blue-200",
  SCHEDULED:  "bg-gray-100 text-gray-700 border-gray-200",
};

const TRIGGER_LABELS: Record<ZoningSnapshot["trigger"], string> = {
  PRE_COMMIT: "Pre-commit",
  MANUAL:     "Manual",
  SCHEDULED:  "Scheduled",
};

interface DiffBadges {
  aliases: { added: unknown[]; removed: unknown[]; modified: unknown[] };
  zones: { added: unknown[]; removed: unknown[]; membersAdded: unknown[]; membersRemoved: unknown[] };
}

function DiffSummary({ diff }: { diff: DiffBadges }) {
  const items = [
    { label: "aliases+",  count: diff.aliases.added.length,    color: "text-emerald-700" },
    { label: "aliases-",  count: diff.aliases.removed.length,  color: "text-red-600" },
    { label: "zones+",    count: diff.zones.added.length,      color: "text-emerald-700" },
    { label: "zones-",    count: diff.zones.removed.length,    color: "text-red-600" },
    { label: "members+",  count: diff.zones.membersAdded.length,   color: "text-emerald-700" },
    { label: "members-",  count: diff.zones.membersRemoved.length, color: "text-red-600" },
  ].filter((i) => i.count > 0);

  if (items.length === 0) return <span className="text-xs text-muted-foreground">No changes</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item.label} className={cn("text-[11px] font-medium", item.color)}>
          {item.label} {item.count}
        </span>
      ))}
    </div>
  );
}

interface SnapshotHistoryProps {
  switchId: string;
  vsanId: number;
}


// ---------------------------------------------------------------------------
// Restore button — shows confirm prompt, calls restore, reports result
// ---------------------------------------------------------------------------
function RestoreButton({ snapshotId, onRestored }: { snapshotId: string; onRestored: () => void }) {
  const [busy,    setBusy]    = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [result,  setResult]  = useState<string | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  const doRestore = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await restoreSnapshot(snapshotId);
      setResult(`Restored: ${r.zonesRestored} zone(s), ${r.aliasesRestored} alias(es) loaded as draft. Review in Zone Editor then commit or discard.`);
      setConfirm(false);
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally { setBusy(false); }
  };

  if (result) return (
    <div className="mt-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 px-2 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
      ✓ {result}
    </div>
  );

  if (error) return (
    <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-2 py-1.5 text-xs text-red-700">
      {error}{" "}
      <button onClick={() => setError(null)} className="underline ml-1">Dismiss</button>
    </div>
  );

  if (confirm) return (
    <div className="mt-2 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 px-2 py-1.5 text-xs space-y-1.5">
      <p className="text-amber-800 dark:text-amber-300 font-medium">
        Restore this snapshot as a draft?
      </p>
      <p className="text-amber-700 dark:text-amber-400">
        Current draft zones and aliases will be overwritten. You can review changes in the Zone Editor before committing.
      </p>
      <div className="flex gap-2">
        <button onClick={doRestore} disabled={busy}
          className="h-6 px-2.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
          {busy ? "Restoring…" : "Yes, restore"}
        </button>
        <button onClick={() => setConfirm(false)}
          className="h-6 px-2 text-xs rounded border border-border hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <button
      onClick={() => setConfirm(true)}
      className="mt-2 h-6 px-2.5 text-xs rounded border border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/20 flex items-center gap-1"
    >
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
        <path d="M1.5 5.5A4 4 0 1 1 5.5 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        <path d="M1.5 3v2.5H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Restore to draft
    </button>
  );
}

export function SnapshotHistory({ switchId, vsanId }: SnapshotHistoryProps) {
  const { snapshots, isLoading } = useSnapshots(switchId, vsanId);
  const [capturing, setCapturing] = useState(false);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const capture = async () => {
    setCapturing(true);
    try { await captureSnapshot(switchId, vsanId); }
    finally { setCapturing(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Zoning snapshot history</h3>
          <p className="text-xs text-muted-foreground">VSAN {vsanId} · {snapshots.length} snapshots</p>
        </div>
        <button
          onClick={capture}
          disabled={capturing}
          className="h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {capturing ? "Capturing…" : "Capture now"}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-6 text-sm text-muted-foreground">Loading snapshots…</div>
      ) : snapshots.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No snapshots yet — trigger a commit or capture manually
        </div>
      ) : (
        <div className="space-y-1.5">
          {snapshots.map((snap) => (
            <div key={snap.id} className="rounded-lg border bg-card overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
                onClick={() => setExpanded(expanded === snap.id ? null : snap.id)}
              >
                <span className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded border flex-shrink-0",
                  TRIGGER_STYLES[snap.trigger]
                )}>
                  {TRIGGER_LABELS[snap.trigger]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(parseISO(snap.createdAt), { addSuffix: true })}
                    </span>
                    {snap.triggeredBy && (
                      <span className="text-xs text-muted-foreground">· {snap.triggeredBy}</span>
                    )}
                  </div>
                  {snap.diffSummary !== null && snap.diffSummary !== undefined && (
                    <DiffSummary diff={snap.diffSummary as DiffBadges} />
                  )}
                </div>
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  className={cn("text-muted-foreground flex-shrink-0 transition-transform", expanded === snap.id && "rotate-90")}
                >
                  <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {expanded === snap.id && (
                <div className="border-t px-3 py-2 bg-muted/20">
                  <p className="text-[11px] text-muted-foreground font-mono break-all">
                    ID: {snap.id}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Captured: {new Date(snap.createdAt).toLocaleString()}
                  </p>
                  <RestoreButton snapshotId={snap.id} onRestored={() => {}} />
                  {snap.diffSummary !== null && snap.diffSummary !== undefined && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        View diff JSON
                      </summary>
                      <pre className="mt-1 p-2 bg-muted rounded text-[10px] overflow-auto max-h-48">
                        {JSON.stringify(snap.diffSummary, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
