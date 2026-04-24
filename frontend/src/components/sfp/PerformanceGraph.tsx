// =============================================================================
// components/charts/PerformanceGraph.tsx
// Recharts area chart for Tx/Rx throughput with window selector
// =============================================================================

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { useMetrics } from "../../hooks/useApi";
import { MetricPoint } from "../../types/api.types";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Window selector
// ---------------------------------------------------------------------------
const WINDOWS = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "168h" },
] as const;

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-lg shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-medium text-foreground">
        {label ? format(parseISO(label), "MMM d, HH:mm") : ""}
      </p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(1)} Mbps
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CRC error mini-bar overlay
// ---------------------------------------------------------------------------
function CrcBadge({ errors }: { errors: number }) {
  if (errors === 0) return null;
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 border border-red-200">
      {errors} CRC
    </span>
  );
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------
interface PerformanceGraphProps {
  interfaceId: string;
  interfaceName?: string;
}

export function PerformanceGraph({
  interfaceId,
  interfaceName,
}: PerformanceGraphProps) {
  const [window, setWindow] = useState<"1h" | "6h" | "24h" | "168h">("24h");
  const { metrics, isLoading } = useMetrics(interfaceId, window);

  const totalCrcErrors = metrics.reduce((sum, m) => sum + (m.crcErrors ?? 0), 0);

  // Format x-axis timestamps based on window
  const xFormatter = (ts: string) => {
    const d = parseISO(ts);
    return window === "1h"
      ? format(d, "HH:mm")
      : window === "6h"
      ? format(d, "HH:mm")
      : window === "24h"
      ? format(d, "HH:mm")
      : format(d, "MMM d");
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">
            Throughput{interfaceName ? ` – ${interfaceName}` : ""}
          </h3>
          <p className="text-xs text-muted-foreground">
            Tx / Rx rates from TimescaleDB time_bucket aggregation
          </p>
        </div>
        <div className="flex items-center gap-1">
          {totalCrcErrors > 0 && <CrcBadge errors={totalCrcErrors} />}
          <div className="flex rounded-md border overflow-hidden">
            {WINDOWS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setWindow(value)}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors",
                  window === value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-56">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Loading metrics…
          </div>
        ) : metrics.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            No data for this window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={metrics}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradTx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradRx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                strokeOpacity={0.06}
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={xFormatter}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(1)}G` : `${v.toFixed(0)}M`
                }
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: "11px", paddingTop: "4px" }}
                iconType="circle"
                iconSize={8}
              />
              <Area
                type="monotone"
                dataKey="txMbps"
                name="Tx"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill="url(#gradTx)"
                dot={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="rxMbps"
                name="Rx"
                stroke="#10b981"
                strokeWidth={1.5}
                fill="url(#gradRx)"
                dot={false}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
