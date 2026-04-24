// =============================================================================
// components/performance/TopPortsChart.tsx
// Top-N port throughput bar chart + table, auto-refreshing every 30s
// =============================================================================

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from "recharts";
import { useTopPorts, discoverFabric } from "../../hooks/useZoningApi";
import { cn } from "../../lib/utils";

interface TopPortsChartProps {
  switchId: string;
  vsanId: number;
}

const TX_COLOR = "#3b82f6";
const RX_COLOR = "#10b981";
const ERR_COLOR = "#ef4444";

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-lg shadow-md px-3 py-2 text-xs space-y-1">
      <p className="font-mono font-medium text-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(1) : p.value}
          {p.name.includes("Mbps") ? " Mbps" : p.name.includes("fps") ? " fps" : ""}
        </p>
      ))}
    </div>
  );
}

export function TopPortsChart({ switchId, vsanId }: TopPortsChartProps) {
  const [topN, setTopN]           = useState(5);
  const [metric, setMetric]       = useState<"throughput" | "frames" | "errors">("throughput");
  const [discovering, setDisc]    = useState(false);
  const { topPorts, isLoading }   = useTopPorts(switchId, vsanId, topN);

  const ports = topPorts?.ports ?? [];

  const chartData = ports.map((p) => ({
    name:   p.interfaceName,
    Tx_Mbps: parseFloat(p.txMbps.toFixed(1)),
    Rx_Mbps: parseFloat(p.rxMbps.toFixed(1)),
    Tx_fps:  parseFloat(p.txFramesPerSec.toFixed(0)),
    Rx_fps:  parseFloat(p.rxFramesPerSec.toFixed(0)),
    Errors:  parseFloat(p.errorRate.toFixed(2)),
    alias:   p.alias ?? "",
  }));

  const discover = async () => {
    setDisc(true);
    try { await discoverFabric(switchId, vsanId); }
    catch { /* non-fatal */ }
    finally { setDisc(false); }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-medium">Top {topN} ports — VSAN {vsanId}</h3>
          <p className="text-xs text-muted-foreground">
            {topPorts?.collectedAt
              ? `Updated ${new Date(topPorts.collectedAt).toLocaleTimeString()}`
              : "Live from show interface counters brief"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Metric selector */}
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["throughput", "frames", "errors"] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)}
                className={cn("px-2.5 py-1.5 capitalize transition-colors",
                  metric === m ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                )}>
                {m}
              </button>
            ))}
          </div>
          {/* Top N */}
          <select value={topN} onChange={(e) => setTopN(Number(e.target.value))}
            className="h-7 rounded border border-border bg-background px-2 text-xs">
            {[3,5,8,10].map(n => <option key={n} value={n}>Top {n}</option>)}
          </select>
          {/* Discover */}
          <button onClick={discover} disabled={discovering}
            className="h-7 px-2.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {discovering ? "Discovering…" : "Discover fabric"}
          </button>
        </div>
      </div>

      {isLoading || ports.length === 0 ? (
        <div className="h-48 flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {isLoading
            ? "Loading…"
            : "No throughput data yet. Poller collects data every 60s. After two polls, deltas will appear."}
        </div>
      ) : (
        <>
          {/* Bar chart */}
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44}
                  tickFormatter={(v: number) =>
                    metric === "throughput"
                      ? v >= 1000 ? `${(v/1000).toFixed(1)}G` : `${v}M`
                      : v.toFixed(0)
                  }
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} iconType="square" iconSize={10} />

                {metric === "throughput" && (
                  <>
                    <Bar dataKey="Tx_Mbps" name="Tx Mbps" fill={TX_COLOR} radius={[3,3,0,0]} maxBarSize={40} />
                    <Bar dataKey="Rx_Mbps" name="Rx Mbps" fill={RX_COLOR} radius={[3,3,0,0]} maxBarSize={40} />
                  </>
                )}
                {metric === "frames" && (
                  <>
                    <Bar dataKey="Tx_fps" name="Tx fps" fill={TX_COLOR} radius={[3,3,0,0]} maxBarSize={40} />
                    <Bar dataKey="Rx_fps" name="Rx fps" fill={RX_COLOR} radius={[3,3,0,0]} maxBarSize={40} />
                  </>
                )}
                {metric === "errors" && (
                  <Bar dataKey="Errors" name="Errors/sec" fill={ERR_COLOR} radius={[3,3,0,0]} maxBarSize={40} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detail table */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-3 py-2 font-medium">Port</th>
                  <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Alias / WWN</th>
                  <th className="text-right px-3 py-2 font-medium">Tx Mbps</th>
                  <th className="text-right px-3 py-2 font-medium">Rx Mbps</th>
                  <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Tx fps</th>
                  <th className="text-right px-3 py-2 font-medium hidden md:table-cell">Rx fps</th>
                  <th className="text-right px-3 py-2 font-medium">Err/s</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ports.map((p, i) => (
                  <tr key={p.interfaceName} className={cn(i === 0 && "bg-blue-50/40 dark:bg-blue-950/10")}>
                    <td className="px-3 py-2 font-mono font-medium">{p.interfaceName}</td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                      {p.alias || p.connectedWwn || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">
                      {p.txMbps.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {p.rxMbps.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                      {p.txFramesPerSec.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                      {p.rxFramesPerSec.toFixed(0)}
                    </td>
                    <td className={cn("px-3 py-2 text-right tabular-nums",
                      p.errorRate > 0 ? "text-red-600" : "text-muted-foreground")}>
                      {p.errorRate.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
