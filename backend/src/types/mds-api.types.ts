// =============================================================================
// types/mds-api.types.ts
// TypeScript interfaces for Cisco MDS 9000 NX-API JSON-RPC
// =============================================================================

// ---------------------------------------------------------------------------
// JSON-RPC transport layer
// ---------------------------------------------------------------------------

export interface NxApiRequest {
  ins_api: {
    version: string;            // "1.0"
    type: "cli_show" | "cli_show_ascii" | "cli_conf";
    chunk: "0" | "1";
    sid?: string;               // session id for chunked responses
    input: string;              // NX-OS CLI command
    output_format: "json" | "xml";
  };
}

export interface NxApiResponse<T = unknown> {
  ins_api: {
    type: string;
    version: string;
    sid: string;
    outputs: {
      output: NxApiOutput<T> | NxApiOutput<T>[];
    };
  };
}

export interface NxApiOutput<T = unknown> {
  body: T;
  code: string;                 // "200" = ok, "400" = error
  input: string;                // the CLI command that was run
  msg: string;                  // "Success" or error description
}

// ---------------------------------------------------------------------------
// show interface counters
// ---------------------------------------------------------------------------

export interface ShowInterfaceCountersBody {
  TABLE_interface: {
    ROW_interface: InterfaceCounterRow | InterfaceCounterRow[];
  };
}

export interface InterfaceCounterRow {
  interface: string;            // "fc1/1"

  // Traffic counters
  "rx_bytes"?: string;
  "tx_bytes"?: string;
  "rx_frames"?: string;
  "tx_frames"?: string;

  // Error counters
  "rx_crc_err"?: string;
  "rx_bad_eof"?: string;
  "rx_enc_disp_err"?: string;
  "link_failures"?: string;
  "sync_losses"?: string;
  "signal_losses"?: string;
  "prim_seq_proto_err"?: string;
  "discards"?: string;
  "too_long"?: string;
  "too_short"?: string;

  // Throughput (if "detail" variant used)
  "rx_bit_rate"?: string;       // "N.NN Mbps"
  "tx_bit_rate"?: string;
}

// ---------------------------------------------------------------------------
// show interface transceiver
// ---------------------------------------------------------------------------

export interface ShowInterfaceTransceiverBody {
  TABLE_interface_transceiver: {
    ROW_interface_transceiver: TransceiverRow | TransceiverRow[];
  };
}

export interface TransceiverRow {
  interface: string;            // "fc1/1"

  // Module info
  sfp: string;                  // "present" | "absent"
  name?: string;                // vendor name
  partnum?: string;
  rev?: string;
  serialnum?: string;
  nom_bitrate?: string;
  type?: string;                // "SFP" | "SFP+" | "QSFP"
  cisco_id?: string;
  cisco_extended_id?: string;

  // DDMI / DOM – may be absent if SFP doesn't support it
  TABLE_calibration?: {
    ROW_calibration: TransceiverCalibrationRow;
  };
}

export interface TransceiverCalibrationRow {
  // Temperature
  temperature?: string;         // "35.50" (°C)
  temp_alarm_hi?: string;
  temp_alarm_lo?: string;
  temp_warn_hi?: string;
  temp_warn_lo?: string;

  // Voltage
  voltage?: string;             // "3.31" (V)
  volt_alarm_hi?: string;
  volt_alarm_lo?: string;
  volt_warn_hi?: string;
  volt_warn_lo?: string;

  // Bias current
  current?: string;             // "6.50" (mA)
  curr_alarm_hi?: string;
  curr_alarm_lo?: string;

  // TX power
  tx_pwr?: string;              // "-1.50" (dBm)
  tx_pwr_alarm_hi?: string;
  tx_pwr_alarm_lo?: string;
  tx_pwr_warn_hi?: string;
  tx_pwr_warn_lo?: string;

  // RX power
  rx_pwr?: string;              // "-3.20" (dBm)
  rx_pwr_alarm_hi?: string;
  rx_pwr_alarm_lo?: string;
  rx_pwr_warn_hi?: string;
  rx_pwr_warn_lo?: string;
}

// ---------------------------------------------------------------------------
// show interface (status + WWN)
// ---------------------------------------------------------------------------

export interface ShowInterfaceBody {
  TABLE_interface: {
    ROW_interface: InterfaceStatusRow | InterfaceStatusRow[];
  };
}

export interface InterfaceStatusRow {
  interface: string;
  state: string;                // "up" | "down" | "trunking"
  state_rsn?: string;           // reason for down state
  speed?: string;               // "8000" (Mbps)
  port_wwn?: string;            // "20:01:00:de:fb:xx:xx:xx"
  peer_wwn?: string;
  admin_state?: string;         // "up" | "down"
  vsan?: string;
  mode?: string;                // "F" | "E" | "TE" | "NP"
  description?: string;
  connected_wwn?: string;
}

// ---------------------------------------------------------------------------
// Parsed / clean domain types (output of parsing functions)
// ---------------------------------------------------------------------------

export interface ParsedInterfaceCounters {
  interfaceName: string;
  rxBytes: bigint;
  txBytes: bigint;
  crcErrors: bigint;
  linkFailures: bigint;
  lossOfSync: bigint;
  lossOfSignal: bigint;
  collectedAt: Date;
}

export interface ParsedTransceiverDiagnostics {
  interfaceName: string;
  sfpPresent: boolean;
  vendorName: string | null;
  partNumber: string | null;
  serialNumber: string | null;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  temperature: number | null;  // °C
  voltage: number | null;      // V
  current: number | null;      // mA
  collectedAt: Date;
}

export interface ParsedInterfaceStatus {
  interfaceName: string;
  status: "UP" | "DOWN" | "TRUNKING" | "ISOLATED" | "UNKNOWN";
  portWwn: string | null;
  connectedWwn: string | null;
  speedGbps: number | null;
  vsanId: number | null;
  portMode: string | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Poller snapshot (full per-switch poll result)
// ---------------------------------------------------------------------------

export interface PollSnapshot {
  switchId: string;
  switchIp: string;
  polledAt: Date;
  counters: ParsedInterfaceCounters[];
  transceivers: ParsedTransceiverDiagnostics[];
  statuses: ParsedInterfaceStatus[];
}
