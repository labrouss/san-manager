// =============================================================================
// components/performance/PortPerformanceChart.tsx
// Per-port throughput history — dropdown like SFP health, line chart like SFP power
// =============================================================================

import { useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Legend, ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { useInterfaceNames } from "../../hooks/useZoningApi";
import { useMetrics } from "../../hooks/useApi";
import { cn } from "../../lib/utils";

const WINDOWS = [
  { label: "1h",  value: "1h"   },
  { label: "6h",  value: "6h"   },
  { label: "24h", value: "24h"  },
  { label: "7d",  value: "168h" },
] as const;
type Window = (typeof WINDOWS)[number]["value"];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-lg shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-medium text-foreground">
        {label ? format(parseISO(label), "MMM d, HH:mm") : ""}
      </p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number"
            ? p.value >= 1000 ? `${(p.value / 1000).toFixed(2)} Gbps` : `${p.value.toFixed(1)} Mbps`
            : p.value}
        </p>
      ))}
    </div>
  );
}

interface PortPerformanceChartProps {
  switchId: string;
}

export function PortPerformanceChart({ switchId }: PortPerformanceChartProps) {
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [window, setWindow]             = useState<Window>("24h");

  const { interfaceNames, isLoading: namesLoading } = useInterfaceNames(switchId);
  const { metrics, isLoading: metricsLoading }      = useMetrics(
    switchId,
    selectedPort || null,
    window
  );

  const xFormatter = (ts: string) => {
    const d = parseISO(ts);
    return window === "168h" ? format(d, "MMM d") : format(d, "HH:mm");
  };

  const hasCrcErrors = metrics.some(m => m.crcErrors > 0);
  const maxThroughput = Math.max(...metrics.map(m => Math.max(m.txMbps ?? 0, m.rxMbps ?? 0)), 0);

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-medium">Port throughput history</h3>
          <p className="text-xs text-muted-foreground">
            {selectedPort
              ? `Tx/Rx over time for ${selectedPort}`
              : "Select a port to view historical throughput"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Port selector dropdown */}
          {namesLoading ? (
            <div className="h-8 w-36 rounded-md border border-border bg-muted animate-pulse" />
          ) : interfaceNames.length > 0 ? (
            <select
              value={selectedPort}
              onChange={e => setSelectedPort(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">— select port —</option>
              {interfaceNames.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              className="h-8 w-28 rounded-md border border-border bg-background px-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="fc1/1"
              value={selectedPort}
              onChange={e => setSelectedPort(e.target.value)}
            />
          )}

          {/* Window selector */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            {WINDOWS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setWindow(value)}
                className={cn(
                  "px-2.5 py-1.5 transition-colors",
                  window === value
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* CRC error badge */}
          {hasCrcErrors && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 border border-red-200">
              CRC errors detected
            </span>
          )}
        </div>
      </div>

      {/* Chart area */}
      {!selectedPort ? (
        <div className="h-56 flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          Select a port from the dropdown above
        </div>
      ) : metricsLoading ? (
        <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
          Loading metrics…
        </div>
      ) : metrics.length === 0 ? (
        <div className="h-56 flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No data for this window. The poller collects data every 60 seconds.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Tx / Rx throughput */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Throughput (Mbps)</p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gTxPort" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="gRxPort" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06}/>
                  <XAxis dataKey="timestamp" tickFormatter={xFormatter} tick={{ fontSize: 11 }} tickLine={false} axisLine={false}/>
                  <YAxis
                    tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48}
                    tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(1)}G` : `${v.toFixed(0)}M`}
                  />
                  <Tooltip content={<CustomTooltip />}/>
                  <Legend wrapperStyle={{ fontSize: "11px" }} iconType="circle" iconSize={8}/>
                  {/* Show a reference line at interface speed if we can infer it */}
                  {maxThroughput > 0 && (
                    <ReferenceLine
                      y={maxThroughput * 1.1}
                      stroke="transparent"  // invisible — just sets the domain
                    />
                  )}
                  <Area
                    type="monotone" dataKey="txMbps" name="Tx"
                    stroke="#3b82f6" strokeWidth={1.5} fill="url(#gTxPort)"
                    dot={false} connectNulls
                  />
                  <Area
                    type="monotone" dataKey="rxMbps" name="Rx"
                    stroke="#10b981" strokeWidth={1.5} fill="url(#gRxPort)"
                    dot={false} connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* RX optical power if available */}
          {metrics.some(m => m.rxPowerDbm !== null) && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">RX optical power (dBm)</p>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metrics} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gPwrPort" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06}/>
                    <XAxis dataKey="timestamp" tickFormatter={xFormatter} tick={{ fontSize: 11 }} tickLine={false} axisLine={false}/>
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32}/>
                    <Tooltip content={<CustomTooltip />}/>
                    <ReferenceLine
                      y={-10} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1}
                      label={{ value: "–10 dBm", position: "right", fontSize: 10, fill: "#ef4444" }}
                    />
                    <Area
                      type="monotone" dataKey="rxPowerDbm" name="RX Power"
                      stroke="#8b5cf6" strokeWidth={1.5} fill="url(#gPwrPort)"
                      dot={false} connectNulls
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
