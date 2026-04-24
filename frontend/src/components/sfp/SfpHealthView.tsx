// =============================================================================
// components/sfp/SfpHealthView.tsx
// Visual transceiver diagnostics panel with health indicators
// =============================================================================

import { useSfpDiagnostics } from "../../hooks/useApi";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Single metric tile
// ---------------------------------------------------------------------------
interface MetricTileProps {
  label: string;
  value: number | null;
  unit: string;
  min: number;
  max: number;
  warnMin?: number;
  warnMax?: number;
  critMin?: number;
  critMax?: number;
  precision?: number;
}

type HealthLevel = "good" | "warn" | "crit" | "unknown";

function getHealth(
  value: number | null,
  { warnMin, warnMax, critMin, critMax }: Partial<MetricTileProps>
): HealthLevel {
  if (value === null) return "unknown";
  if (
    (critMin !== undefined && value < critMin) ||
    (critMax !== undefined && value > critMax)
  )
    return "crit";
  if (
    (warnMin !== undefined && value < warnMin) ||
    (warnMax !== undefined && value > warnMax)
  )
    return "warn";
  return "good";
}

const HEALTH_STYLES: Record<HealthLevel, { bar: string; text: string; badge: string }> = {
  good:    { bar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", badge: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  warn:    { bar: "bg-amber-400",   text: "text-amber-700 dark:text-amber-400",    badge: "bg-amber-100 text-amber-800 border-amber-200" },
  crit:    { bar: "bg-red-500",     text: "text-red-700 dark:text-red-400",        badge: "bg-red-100 text-red-800 border-red-200" },
  unknown: { bar: "bg-gray-300",    text: "text-muted-foreground",                 badge: "bg-gray-100 text-gray-600 border-gray-200" },
};

const HEALTH_LABELS: Record<HealthLevel, string> = {
  good:    "Normal",
  warn:    "Warning",
  crit:    "Critical",
  unknown: "No data",
};

function MetricTile({
  label,
  value,
  unit,
  min,
  max,
  warnMin,
  warnMax,
  critMin,
  critMax,
  precision = 1,
}: MetricTileProps) {
  const health = getHealth(value, { warnMin, warnMax, critMin, critMax });
  const styles = HEALTH_STYLES[health];

  // Normalise value to 0–100% for the bar
  const pct =
    value !== null
      ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
      : 0;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded border",
            styles.badge
          )}
        >
          {HEALTH_LABELS[health]}
        </span>
      </div>

      <div className={cn("text-2xl font-semibold tabular-nums", styles.text)}>
        {value !== null ? `${value.toFixed(precision)}` : "—"}
        <span className="text-sm font-normal text-muted-foreground ml-1">
          {unit}
        </span>
      </div>

      {/* Horizontal progress bar */}
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", styles.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// dBm power tile with logarithmic semantics
// ---------------------------------------------------------------------------
function PowerTile({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  // Typical FC SFP range: -20 to +3 dBm
  const health = getHealth(value, {
    critMin: -14,
    warnMin: -10,
    warnMax: 2,
    critMax: 3,
  });
  const styles = HEALTH_STYLES[health];

  const pct =
    value !== null
      ? Math.max(0, Math.min(100, ((value - -20) / (3 - -20)) * 100))
      : 0;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span
          className={cn(
            "text-[10px] font-medium px-1.5 py-0.5 rounded border",
            styles.badge
          )}
        >
          {HEALTH_LABELS[health]}
        </span>
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", styles.text)}>
        {value !== null ? value.toFixed(2) : "—"}
        <span className="text-sm font-normal text-muted-foreground ml-1">dBm</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", styles.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>–20 dBm</span>
        <span className="text-red-400">–10 threshold</span>
        <span>+3 dBm</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
interface SfpHealthViewProps {
  switchId: string;
  interfaceName: string;
}

export function SfpHealthView({ switchId, interfaceName }: SfpHealthViewProps) {
  const { sfp, isLoading } = useSfpDiagnostics(switchId, interfaceName);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        Loading SFP diagnostics…
      </div>
    );
  }

  if (!sfp) {
    return (
      <div className="flex items-center justify-center h-32 rounded-lg border border-dashed text-sm text-muted-foreground">
        No transceiver data — SFP absent or non-DDMI
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">
          SFP Health{interfaceName ? ` – ${interfaceName}` : ""}
        </h3>
        <p className="text-xs text-muted-foreground">
          Last updated:{" "}
          {new Date(sfp.timestamp).toLocaleString()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile
          label="Temperature"
          value={sfp.temperature}
          unit="°C"
          min={0}
          max={85}
          warnMax={60}
          critMax={70}
          precision={1}
        />
        <MetricTile
          label="Voltage"
          value={sfp.voltage}
          unit="V"
          min={2.9}
          max={3.7}
          warnMin={3.0}
          warnMax={3.6}
          critMin={2.97}
          critMax={3.63}
          precision={2}
        />
        <MetricTile
          label="Bias current"
          value={sfp.current}
          unit="mA"
          min={0}
          max={20}
          warnMax={15}
          critMax={18}
          precision={1}
        />
        <PowerTile label="RX power" value={sfp.rxPowerDbm} />
        <PowerTile label="TX power" value={sfp.txPowerDbm} />
      </div>
    </div>
  );
}
