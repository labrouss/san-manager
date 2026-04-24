// =============================================================================
// components/notifications/NotificationsPanel.tsx
// Alert feed — plain Tailwind, no shadcn/ui, self-contained SWR hook
// =============================================================================

import { useState } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { formatDistanceToNow, parseISO } from "date-fns";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Local types (avoid importing from api.types to keep this self-contained)
// ---------------------------------------------------------------------------
interface Notification {
  id: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  type: string;
  message: string;
  value: number | null;
  threshold: number | null;
  acknowledgedAt: string | null;
  createdAt: string;
  interface?: { name: string; alias: string | null } | null;
}

async function acknowledgeNotification(id: string): Promise<void> {
  await fetch(`${BASE}/notifications/${id}/acknowledge`, { method: "PATCH" });
  globalMutate((k) => typeof k === "string" && k.includes("/notifications"), undefined, { revalidate: true });
}

// ---------------------------------------------------------------------------
const SEVERITY_LEFT: Record<string, string> = {
  CRITICAL: "border-l-red-500 bg-red-50 dark:bg-red-950/20",
  WARNING:  "border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
  INFO:     "border-l-blue-400 bg-blue-50 dark:bg-blue-950/20",
};

// ---------------------------------------------------------------------------
function NotificationRow({ n }: { n: Notification }) {
  const [acking, setAcking] = useState(false);
  const acked = !!n.acknowledgedAt;

  return (
    <div className={cn(
      "flex items-start gap-2 border-l-2 px-3 py-2.5 rounded-r-md",
      SEVERITY_LEFT[n.severity] ?? "border-l-gray-300"
    )}>
      {/* Severity dot */}
      <span className={cn(
        "mt-1.5 h-2 w-2 rounded-full flex-shrink-0",
        n.severity === "CRITICAL" ? "bg-red-500" :
        n.severity === "WARNING"  ? "bg-amber-500" : "bg-blue-400"
      )} />

      <div className="flex-1 min-w-0">
        <p className={cn("text-sm", acked && "line-through text-muted-foreground")}>
          {n.message}
        </p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {n.interface && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {n.interface.alias ?? n.interface.name}
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(parseISO(n.createdAt), { addSuffix: true })}
          </span>
          {acked && <span className="text-[11px] text-muted-foreground">acknowledged</span>}
        </div>
      </div>

      {!acked && (
        <button
          onClick={async (e) => { e.stopPropagation(); setAcking(true); await acknowledgeNotification(n.id); setAcking(false); }}
          disabled={acking}
          title="Acknowledge"
          className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function NotificationsPanel() {
  const [showAll, setShowAll] = useState(false);

  const url = `${BASE}/notifications?limit=100${!showAll ? "&unacknowledged=true" : ""}`;
  const { data: notifications = [], isLoading } = useSWR<Notification[]>(url, fetcher, {
    refreshInterval: 10_000,
  });

  const unacked = notifications.filter((n) => !n.acknowledgedAt).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            className={unacked > 0 ? "text-red-500" : "text-muted-foreground"}>
            <path d="M8 1.5a5 5 0 0 0-5 5v2.5L1.5 11h13L13 9V6.5a5 5 0 0 0-5-5Z"
              stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
            <path d="M6.5 13a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.2"/>
          </svg>
          <h3 className="text-sm font-medium">Alerts</h3>
          {unacked > 0 && (
            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-[10px] font-medium text-white">
              {unacked}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowAll(!showAll)}
          className="h-7 px-2.5 text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors"
        >
          {showAll ? "Unacked only" : "Show all"}
        </button>
      </div>

      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {isLoading && (
          <p className="text-sm text-muted-foreground text-center py-4">Loading alerts…</p>
        )}
        {!isLoading && notifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="opacity-40">
              <path d="M10 2a7 7 0 0 0-7 7v3l-1.5 3h17L17 12V9a7 7 0 0 0-7-7Z"
                stroke="currentColor" strokeWidth="1.3"/>
              <path d="M8 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            No alerts
          </div>
        )}
        {notifications.map((n) => (
          <NotificationRow key={n.id} n={n} />
        ))}
      </div>
    </div>
  );
}
