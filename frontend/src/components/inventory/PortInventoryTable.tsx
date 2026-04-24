// =============================================================================
// components/inventory/PortInventoryTable.tsx
// Searchable port inventory — plain Tailwind, no shadcn/ui
// =============================================================================

import { useState, useCallback } from "react";
import { useInterfaces, updateAlias } from "../../hooks/useApi";
import { Interface } from "../../types/api.types";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const STATUS_STYLES: Record<Interface["status"], string> = {
  UP:       "bg-green-100 text-green-800 border-green-200",
  DOWN:     "bg-red-100 text-red-800 border-red-200",
  TRUNKING: "bg-blue-100 text-blue-800 border-blue-200",
  ISOLATED: "bg-yellow-100 text-yellow-800 border-yellow-200",
  UNKNOWN:  "bg-gray-100 text-gray-600 border-gray-200",
};

const STATUS_DOT: Record<Interface["status"], string> = {
  UP: "bg-green-500", DOWN: "bg-red-500", TRUNKING: "bg-blue-500",
  ISOLATED: "bg-yellow-500", UNKNOWN: "bg-gray-400",
};

function StatusBadge({ status }: { status: Interface["status"] }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
      STATUS_STYLES[status]
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[status])} />
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline alias editor
// ---------------------------------------------------------------------------
function AliasCell({ iface, onSaved }: { iface: Interface; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(iface.alias ?? "");
  const [saving, setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateAlias(iface.id, value);
      onSaved();
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          className="h-7 w-36 rounded border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          autoFocus
        />
        <button onClick={save} disabled={saving}
          className="h-6 w-6 flex items-center justify-center rounded text-green-600 hover:bg-green-50">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button onClick={() => setEditing(false)}
          className="h-6 w-6 flex items-center justify-center rounded text-red-500 hover:bg-red-50">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1 cursor-pointer" onClick={() => setEditing(true)}>
      <span className={cn("text-sm", !iface.alias && "text-muted-foreground italic")}>
        {iface.alias || "—"}
      </span>
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground">
        <path d="M8 1.5L9.5 3 3.5 9H2V7.5L8 1.5Z" stroke="currentColor" strokeWidth="1.2"
          strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main table
// ---------------------------------------------------------------------------
interface PortInventoryTableProps {
  switchId: string;
  onSelectInterface?: (iface: Interface) => void;
  selectedInterfaceId?: string | null;
}

const STATUS_OPTIONS = ["ALL", "UP", "DOWN", "TRUNKING", "ISOLATED", "UNKNOWN"];

export function PortInventoryTable({
  switchId,
  onSelectInterface,
  selectedInterfaceId,
}: PortInventoryTableProps) {
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showFilter, setShowFilter]   = useState(false);
  const { interfaces, isLoading, refresh } = useInterfaces(switchId, {
    search: search.length >= 2 ? search : undefined,
    status: statusFilter !== "ALL" ? statusFilter : undefined,
  });

  const handleSaved = useCallback(() => {}, []);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"
            className="absolute left-2.5 top-2 text-muted-foreground">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            placeholder="Search name, alias, WWN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="relative">
          <button
            onClick={() => setShowFilter(!showFilter)}
            className="h-8 px-3 text-sm rounded-md border border-border bg-background hover:bg-muted flex items-center gap-1"
          >
            Status: {statusFilter}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="ml-1">
              <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          {showFilter && (
            <div className="absolute top-full mt-1 right-0 z-10 bg-card border rounded-lg shadow-md py-1 min-w-32">
              {STATUS_OPTIONS.map((s) => (
                <button key={s} onClick={() => { setStatusFilter(s); setShowFilter(false); }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-sm hover:bg-muted",
                    statusFilter === s && "font-medium text-primary"
                  )}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => refresh()}
          className="h-8 px-2.5 text-xs rounded-md border border-border bg-background hover:bg-muted flex items-center gap-1.5"
          title="Refresh from switch"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1.5 6A4.5 4.5 0 1 1 6 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            <path d="M1.5 3.5V6H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
        <span className="text-xs text-muted-foreground">{interfaces.length} ports</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs text-muted-foreground uppercase tracking-wide">
              <th className="text-left px-3 py-2 font-medium">Port</th>
              <th className="text-left px-3 py-2 font-medium">Alias</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">WWN</th>
              <th className="text-left px-3 py-2 font-medium">Speed</th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">Loading interfaces…</td></tr>
            )}
            {!isLoading && interfaces.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-sm text-muted-foreground">No interfaces found</td></tr>
            )}
            {interfaces.map((iface) => (
              <tr
                key={iface.id}
                onClick={() => onSelectInterface?.(iface)}
                className={cn(
                  "cursor-pointer hover:bg-muted/30 transition-colors",
                  selectedInterfaceId === iface.id && "bg-accent"
                )}
              >
                <td className="px-3 py-2 font-mono text-sm font-medium">{iface.name}</td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <AliasCell iface={iface} onSaved={handleSaved} />
                </td>
                <td className="px-3 py-2"><StatusBadge status={iface.status} /></td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground hidden md:table-cell">
                  {iface.wwn ?? "—"}
                </td>
                <td className="px-3 py-2 text-sm">
                  {iface.speed ? `${iface.speed}G` : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                  {iface.portType.replace("_PORT", "")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
