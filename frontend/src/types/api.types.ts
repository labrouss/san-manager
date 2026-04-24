// =============================================================================
// types/api.types.ts — Frontend domain types
// =============================================================================

export interface Switch {
  id: string;
  ipAddress: string;
  hostname: string | null;
  model: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
}

export interface FcAlias {
  id: string;
  switchId: string;
  name: string;
  wwn: string;
  description: string | null;
  syncedAt: string | null;
  isOrphaned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ZoneMember {
  id: string;
  zoneId: string;
  memberType: "PWWN" | "DEVICE_ALIAS" | "FCID";
  value: string;
  createdAt: string;
}

export interface Zone {
  id: string;
  switchId: string;
  name: string;
  vsanId: number;
  description: string | null;
  isDraft: boolean;
  syncedAt: string | null;
  members: ZoneMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ZoneSetMember {
  zoneSetId: string;
  zoneId: string;
  addedAt: string;
  zone: Zone;
}

export interface ZoneSet {
  id: string;
  switchId: string;
  name: string;
  vsanId: number;
  isActive: boolean;
  isDraft: boolean;
  activatedAt: string | null;
  syncedAt: string | null;
  members: ZoneSetMember[];
  createdAt: string;
  updatedAt: string;
}

export interface ZoningSnapshot {
  id: string;
  switchId: string;
  vsanId: number;
  trigger: "PRE_COMMIT" | "MANUAL" | "SCHEDULED";
  triggeredBy: string | null;
  diffSummary: unknown;
  createdAt: string;
}

export interface CommitResult {
  success: boolean;
  snapshotId: string;
  activatedZoneSet: string;
  commandsExecuted: string[];
  errors?: string[];
}

export interface AliasSyncResult {
  switchId: string;
  switchIp: string;
  newAliasesOnSwitch: { name: string; wwn: string }[];
  orphanedAliasesInDb: { name: string; wwn: string }[];
  synced: number;
}

export interface PortMetricPoint {
  timestamp: string;
  txMbps: number | null;
  rxMbps: number | null;
  rxPowerDbm: number | null;
  crcErrors: number;
}

// ---------------------------------------------------------------------------
// Additional types used by PortInventoryTable, SfpHealthView, PerformanceGraph
// ---------------------------------------------------------------------------

export interface Interface {
  id: string;
  switchId: string;
  name: string;
  wwn: string | null;
  alias: string | null;
  description: string | null;
  status: "UP" | "DOWN" | "TRUNKING" | "ISOLATED" | "UNKNOWN";
  speed: number | null;
  vsanMembership: number[];
  portType: string;
  connectedWwn: string | null;
  updatedAt: string;
}

export interface SfpDiagnostics {
  timestamp: string;
  temperature: number | null;
  voltage: number | null;
  current: number | null;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
}

export interface MetricPoint {
  timestamp: string;
  txMbps: number | null;
  rxMbps: number | null;
  crcErrors: number;
  rxPowerDbm: number | null;
}

// ---------------------------------------------------------------------------
// Fabric discovery types
// ---------------------------------------------------------------------------

export interface FcnsEntry {
  vsanId: number;
  pwwn: string;
  fcid: string;
  type: string | null;
  vendor: string | null;
  nodeName: string | null;
  fc4Types: string | null;
  symbolicPortName: string | null;
  symbolicNodeName: string | null;
  connectedInterface: string | null;
  switchName: string | null;
}

export interface KnownWwn {
  pwwn: string;
  alias: string | null;
  fcid: string | null;
  vendor: string | null;
  connectedInterface: string | null;
}

export interface TopPortStat {
  interfaceName: string;
  txMbps: number;
  rxMbps: number;
  txFramesPerSec: number;
  rxFramesPerSec: number;
  errorRate: number;
  connectedWwn: string | null;
  alias: string | null;
}

export interface TopPortsResult {
  switchId: string;
  vsanId: number;
  collectedAt: string;
  ports: TopPortStat[];
}

export interface SwitchRegistration {
  ipAddress: string;
  username: string;
  password: string;
  port?: number;
  hostname?: string;
  model?: string;
}
