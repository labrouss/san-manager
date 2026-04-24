// =============================================================================
// types/fabric.types.ts
// NX-API response shapes for fabric discovery commands:
//   show fcs database, show fcns database, show interface counters brief
// =============================================================================

// ---------------------------------------------------------------------------
// show fcns database [detail] [vsan <id>]
// ---------------------------------------------------------------------------

export interface ShowFcnsBody {
  TABLE_fcns_vsan?: {
    ROW_fcns_vsan: FcnsVsanRow | FcnsVsanRow[];
  };
}

export interface FcnsVsanRow {
  vsan_id: string;
  TABLE_fcns_database?: {
    ROW_fcns_database: FcnsDatabaseRow | FcnsDatabaseRow[];
  };
}

export interface FcnsDatabaseRow {
  pwwn: string;           // "21:00:00:24:ff:8a:1b:2c"
  fcid: string;           // "0x010100"
  type?: string;          // "N" | "NL" | "F" | "E"
  vendor?: string;        // "Emulex" | "QLogic" | "Cisco" etc.
  // Detail fields (show fcns database detail)
  port_name?: string;     // may repeat pwwn
  node_name?: string;     // NWWN
  class?: string;         // "3"
  ip_addr?: string;
  fc4_types?: string;     // "scsi-fcp:init"
  symbolic_port_name?: string;
  symbolic_node_name?: string;
  // Connected interface (detail only)
  connected_interface?: string;  // "fc1/1"
  switch_wwn?: string;
  switch_name?: string;
}

// ---------------------------------------------------------------------------
// show fcs database [vsan <id>]
// ---------------------------------------------------------------------------

export interface ShowFcsBody {
  TABLE_fcs_vsan?: {
    ROW_fcs_vsan: FcsVsanRow | FcsVsanRow[];
  };
}

export interface FcsVsanRow {
  vsan_id: string;
  TABLE_fcs_ie?: {
    ROW_fcs_ie: FcsIeRow | FcsIeRow[];
  };
}

export interface FcsIeRow {
  ie_wwn?: string;
  ie_name?: string;
  ie_mgmt_id?: string;
  TABLE_fcs_port?: {
    ROW_fcs_port: FcsPortRow | FcsPortRow[];
  };
}

export interface FcsPortRow {
  port_wwn: string;
  port_name?: string;
  port_type?: string;     // "N" | "F" | "E" | "TE"
  port_fcid?: string;
  connected_pwwn?: string;
  interface?: string;     // "fc1/1"
}

// ---------------------------------------------------------------------------
// show interface counters brief
// ---------------------------------------------------------------------------

export interface ShowInterfaceCountersBriefBody {
  TABLE_interface_brief?: {
    ROW_interface_brief: InterfaceCounterBriefRow | InterfaceCounterBriefRow[];
  };
}

export interface InterfaceCounterBriefRow {
  interface: string;         // "fc1/1"
  rx_frames?: string;
  tx_frames?: string;
  rx_words?: string;
  tx_words?: string;
  rx_errors?: string;
  tx_errors?: string;
  credit_loss?: string;
  input_discards?: string;
  output_discards?: string;
}

// ---------------------------------------------------------------------------
// Parsed / clean domain types
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

export interface FcsPort {
  vsanId: number;
  portWwn: string;
  portName: string | null;
  portType: string | null;
  fcid: string | null;
  connectedPwwn: string | null;
  interface: string | null;
}

export interface InterfaceBriefCounters {
  interfaceName: string;
  rxFrames: bigint;
  txFrames: bigint;
  rxWords: bigint;
  txWords: bigint;
  rxErrors: bigint;
  txErrors: bigint;
  collectedAt: Date;
}

export interface InterfaceThroughputStats {
  interfaceName: string;
  txMbps: number;
  rxMbps: number;
  txFramesPerSec: number;
  rxFramesPerSec: number;
  errorRate: number;
  // Linked fabric info
  connectedWwn: string | null;
  alias: string | null;
}

export interface TopPortsResult {
  switchId: string;
  vsanId: number;
  collectedAt: string;
  ports: InterfaceThroughputStats[];
}
