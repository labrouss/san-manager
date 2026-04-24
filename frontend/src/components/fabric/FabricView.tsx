// =============================================================================
// components/fabric/FabricView.tsx
// FCNS/FCS database viewer — shows all logged-in devices per VSAN
// =============================================================================

import { useState } from "react";
import { useFcns, discoverFabric } from "../../hooks/useZoningApi";
import { FcnsEntry } from "../../types/api.types";
import { cn } from "../../lib/utils";

const FC4_BADGE: Record<string, string> = {
  "scsi-fcp:init":   "bg-blue-100 text-blue-800 border-blue-200",
  "scsi-fcp:target": "bg-emerald-100 text-emerald-800 border-emerald-200",
  "scsi-fcp:both":   "bg-purple-100 text-purple-800 border-purple-200",
};

function Fc4Badge({ fc4 }: { fc4: string | null }) {
  if (!fc4) return <span className="text-muted-foreground">—</span>;
  const label = fc4.replace("scsi-fcp:", "").replace("init", "initiator").replace("target", "target");
  return (
    <span className={cn("inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border",
      FC4_BADGE[fc4.toLowerCase()] ?? "bg-gray-100 text-gray-700 border-gray-200")}>
      {label}
    </span>
  );
}

interface FabricViewProps {
  switchId: string;
  vsanId: number;
}

export function FabricView({ switchId, vsanId }: FabricViewProps) {
  const [search, setSearch]         = useState("");
  const [discovering, setDisc]      = useState(false);
  const { fcns, isLoading }         = useFcns(switchId, vsanId);

  const filtered = fcns.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.pwwn.toLowerCase().includes(q) ||
      (e.symbolicPortName ?? "").toLowerCase().includes(q) ||
      (e.vendor ?? "").toLowerCase().includes(q) ||
      (e.connectedInterface ?? "").toLowerCase().includes(q) ||
      (e.fcid ?? "").toLowerCase().includes(q)
    );
  });

  const discover = async () => {
    setDisc(true);
    try { await discoverFabric(switchId, vsanId); }
    catch { /* non-fatal */ }
    finally { setDisc(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            className="absolute left-2.5 top-2 text-muted-foreground">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            placeholder="Search WWN, alias, vendor, interface…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button onClick={discover} disabled={discovering}
          className="h-8 px-3 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {discovering ? "Discovering…" : "Refresh from switch"}
        </button>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} entries · VSAN {vsanId}
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-3 py-2 font-medium">pWWN</th>
              <th className="text-left px-3 py-2 font-medium">Alias / Name</th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">FCID</th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Vendor</th>
              <th className="text-left px-3 py-2 font-medium">Role</th>
              <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Interface</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">
                Loading FCNS database…
              </td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">
                No entries. Click "Refresh from switch" to query the FCNS database.
              </td></tr>
            )}
            {filtered.map((e: FcnsEntry, i) => (
              <tr key={`${e.pwwn}-${i}`} className="hover:bg-muted/30">
                <td className="px-3 py-2 font-mono">{e.pwwn}</td>
                <td className="px-3 py-2">
                  {e.symbolicPortName
                    ? <span className="text-foreground">{e.symbolicPortName}</span>
                    : <span className="text-muted-foreground italic">unnamed</span>}
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground hidden sm:table-cell">{e.fcid || "—"}</td>
                <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{e.vendor || "—"}</td>
                <td className="px-3 py-2"><Fc4Badge fc4={e.fc4Types} /></td>
                <td className="px-3 py-2 font-mono text-muted-foreground hidden lg:table-cell">
                  {e.connectedInterface || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
