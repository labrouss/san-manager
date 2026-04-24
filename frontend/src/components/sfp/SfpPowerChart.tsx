// =============================================================================
// components/sfp/SfpPowerChart.tsx
// Historical RX optical power trend + Tx/Rx throughput using TimescaleDB data
// =============================================================================

import { useState } from "react";
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import useSWR from "swr";
import { PortMetricPoint } from "../../types/api.types";
import { cn } from "../../lib/utils";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
const WINDOWS = [
  { label: "1h",  value: "1h" },
  { label: "6h",  value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d",  value: "168h" },
] as const;

type Window = (typeof WINDOWS)[number]["value"];

// ---------------------------------------------------------------------------
// Custom tooltip
// ---------------------------------------------------------------------------
function PowerTooltip({
  active, payload, label,
}: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-lg shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-medium text-foreground">
        {label ? format(parseISO(label), "MMM d, HH:mm") : ""}
      </p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(2)}
          {p.name.includes("Power") ? " dBm" : " Mbps"}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
interface SfpPowerChartProps {
  switchId: string;
  interfaceName: string;
}

export function SfpPowerChart({ switchId, interfaceName }: SfpPowerChartProps) {
  const [window, setWindow] = useState<Window>("24h");

  // Query port_metrics for this specific interface via the API
  const url = `${BASE}/metrics?switchId=${switchId}&interface=${encodeURIComponent(interfaceName)}&window=${window}`;
  const { data: metrics = [], isLoading } = useSWR<PortMetricPoint[]>(url, fetcher, {
    refreshInterval: 60_000,
  });

  const xFormatter = (ts: string) => {
    const d = parseISO(ts);
    return window === "168h" ? format(d, "MMM d") : format(d, "HH:mm");
  };

  // Determine if any data point is below the -10 dBm critical threshold
  const hasCriticalPower = metrics.some(
    (m) => m.rxPowerDbm !== null && m.rxPowerDbm < -10
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">
            SFP optical power history — <span className="font-mono">{interfaceName}</span>
          </h3>
          <p className="text-xs text-muted-foreground">RX power trend with –10 dBm critical threshold</p>
        </div>
        <div className="flex items-center gap-2">
          {hasCriticalPower && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 border border-red-200">
              Below threshold
            </span>
          )}
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

      {isLoading ? (
        <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
          Loading metrics…
        </div>
      ) : metrics.length === 0 ? (
        <div className="h-48 flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No data for this window
        </div>
      ) : (
        <div className="space-y-5">
          {/* RX optical power line chart */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">RX optical power (dBm)</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={xFormatter}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `${v.toFixed(0)}`}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={32}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<PowerTooltip />} />
                  {/* Critical threshold reference line */}
                  <ReferenceLine
                    y={-10}
                    stroke="#ef4444"
                    strokeDasharray="4 3"
                    strokeWidth={1}
                    label={{ value: "–10 dBm", position: "right", fontSize: 10, fill: "#ef4444" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rxPowerDbm"
                    name="RX Power"
                    stroke="#8b5cf6"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tx/Rx throughput area chart */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Throughput (Mbps)</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
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
                    width={40}
                  />
                  <Tooltip content={<PowerTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} iconType="circle" iconSize={8} />
                  <Area
                    type="monotone"
                    dataKey="txMbps"
                    name="Tx"
                    stroke="#3b82f6"
                    strokeWidth={1.5}
                    fill="url(#gTx)"
                    dot={false}
                    connectNulls
                  />
                  <Area
                    type="monotone"
                    dataKey="rxMbps"
                    name="Rx"
                    stroke="#10b981"
                    strokeWidth={1.5}
                    fill="url(#gRx)"
                    dot={false}
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
