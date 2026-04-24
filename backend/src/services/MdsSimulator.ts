// =============================================================================
// services/MdsSimulator.ts — Cisco MDS 9000 NX-API Simulator v2
//
// Per-switch state includes configurable port profiles with min/max ranges
// for throughput and SFP optical power. Each poll generates values within
// these ranges, producing realistic time-series data for charts.
//
// Field names match real NX-API JSON output per Cisco DevNet docs.
// =============================================================================

import logger from "../config/logger";

// ---------------------------------------------------------------------------
// State interfaces
// ---------------------------------------------------------------------------
interface SimAlias   { name: string; pwwn: string; }
interface SimMember  { type: "pwwn" | "device_alias"; value: string; }
interface SimZone    { name: string; vsanId: number; members: SimMember[]; }
interface SimZoneSet { name: string; vsanId: number; isActive: boolean; zones: string[]; }

export interface SimPortConfig {
  name:        string;
  state:       "up" | "down";
  mode:        "F" | "E" | "TE" | "FL";
  speedGbps:   4 | 8 | 16 | 32 | 64;
  vsanId:      number;
  sfpPresent:  boolean;
  degraded:    boolean;
  // Throughput simulation (Mbps). 0 = auto-derive from port speed
  txMinMbps:   number;
  txMaxMbps:   number;
  rxMinMbps:   number;
  rxMaxMbps:   number;
  // SFP optical power (dBm). 0 = auto defaults
  rxPwrMin:    number;
  rxPwrMax:    number;
  txPwrMin:    number;
  txPwrMax:    number;
}

interface SwitchState {
  aliases:   SimAlias[];
  zones:     SimZone[];
  zoneSets:  SimZoneSet[];
  ports:     SimPortConfig[];
  pollCount: number;
}

const switchStates = new Map<string, SwitchState>();

// ---------------------------------------------------------------------------
// WWN generator — valid 8-byte FC pWWN, deterministic per IP
// ---------------------------------------------------------------------------
function ipSeed(ip: string): number {
  const parts = ip.split(".").map(p => parseInt(p.replace(/[^0-9]/g, ""), 10) || 0);
  return ((parts[0] * 31 + parts[1]) * 31 + parts[2]) * 31 + parts[3];
}

function makeWwn(prefix: string, ip: string, index: number): string {
  const seed = ipSeed(ip);
  const b5 = ((seed >> 16) & 0xFF).toString(16).padStart(2, "0");
  const b6 = ((seed >>  8) & 0xFF).toString(16).padStart(2, "0");
  const b7 = ( seed        & 0xFF).toString(16).padStart(2, "0");
  const b8 = (index & 0xFF).toString(16).padStart(2, "0");
  return `${prefix}:${b5}:${b6}:${b7}:${b8}`;
}

// ---------------------------------------------------------------------------
// Pseudo-random value in [min, max] that varies slowly per poll
// Using sin gives smooth, continuous variation rather than noise
// ---------------------------------------------------------------------------
function simValue(min: number, max: number, pollCount: number, phase: number): number {
  const t = Math.sin(pollCount * 0.3 + phase);   // oscillates -1..1
  return min + (max - min) * (0.5 + t * 0.45);  // maps to min..max with 90% range
}

// ---------------------------------------------------------------------------
// Default port config — auto ranges derived from port speed
// ---------------------------------------------------------------------------
function autoRanges(speedGbps: number, degraded: boolean): Pick<
  SimPortConfig, "txMinMbps"|"txMaxMbps"|"rxMinMbps"|"rxMaxMbps"|"rxPwrMin"|"rxPwrMax"|"txPwrMin"|"txPwrMax"
> {
  const cap = speedGbps * 1000;   // Mbps
  return {
    txMinMbps: Math.round(cap * 0.05), txMaxMbps: Math.round(cap * 0.75),
    rxMinMbps: Math.round(cap * 0.05), rxMaxMbps: Math.round(cap * 0.80),
    rxPwrMin:  degraded ? -12.5 : -4.5, rxPwrMax:  degraded ? -10.0 : -2.0,
    txPwrMin:  -2.5,                    txPwrMax:  -0.5,
  };
}

function defaultPorts(ip: string): SimPortConfig[] {
  const mkPort = (
    name: string, state: "up"|"down", mode: "F"|"E"|"TE"|"FL",
    speedGbps: 4|8|16|32|64, vsanId: number, sfpPresent: boolean, degraded: boolean
  ): SimPortConfig => ({
    name, state, mode, speedGbps, vsanId, sfpPresent, degraded,
    ...autoRanges(speedGbps, degraded),
  });

  return [
    mkPort("fc1/1", "up",   "F",  8,  100, true,  false),
    mkPort("fc1/2", "up",   "F",  8,  100, true,  false),
    mkPort("fc1/3", "up",   "F",  8,  100, true,  false),
    mkPort("fc1/4", "down", "F",  8,  100, false, false),
    mkPort("fc1/5", "up",   "E",  16, 100, true,  false),
    mkPort("fc1/6", "up",   "F",  8,  200, true,  false),
    mkPort("fc1/7", "up",   "F",  8,  200, true,  false),
    mkPort("fc1/8", "up",   "F",  4,  200, true,  true ),
  ];
}

function defaultAliases(ip: string): SimAlias[] {
  return [
    { name: "DB_Server_01_HBA_A",  pwwn: makeWwn("21:00:00:24", ip, 0x01) },
    { name: "DB_Server_01_HBA_B",  pwwn: makeWwn("21:00:00:24", ip, 0x02) },
    { name: "App_Server_02_HBA_A", pwwn: makeWwn("21:00:00:24", ip, 0x03) },
    { name: "Storage_Array_A_P1",  pwwn: makeWwn("50:00:d3:10", ip, 0x04) },
    { name: "Storage_Array_A_P2",  pwwn: makeWwn("50:00:d3:10", ip, 0x05) },
    { name: "Backup_Host_HBA_A",   pwwn: makeWwn("20:00:00:25", ip, 0x06) },
  ];
}

function defaultZones(ip: string): SimZone[] {
  const a = defaultAliases(ip);
  return [
    {
      name: "Zone_DB_to_Storage", vsanId: 100,
      members: [
        { type: "pwwn", value: a[0].pwwn }, { type: "pwwn", value: a[1].pwwn },
        { type: "device_alias", value: "Storage_Array_A_P1" },
        { type: "device_alias", value: "Storage_Array_A_P2" },
      ],
    },
    {
      name: "Zone_App_to_Storage", vsanId: 100,
      members: [
        { type: "pwwn", value: a[2].pwwn },
        { type: "device_alias", value: "Storage_Array_A_P1" },
      ],
    },
    {
      name: "Zone_DB_to_Storage_VSAN200", vsanId: 200,
      members: [
        { type: "pwwn", value: a[3].pwwn },
        { type: "device_alias", value: "Backup_Host_HBA_A" },
      ],
    },
  ];
}

function getState(ip: string): SwitchState {
  if (!switchStates.has(ip)) {
    switchStates.set(ip, {
      pollCount: 0,
      aliases:   defaultAliases(ip),
      zones:     defaultZones(ip),
      ports:     defaultPorts(ip),
      zoneSets: [
        { name: "Production_ZoneSet_VSAN100", vsanId: 100, isActive: true,  zones: ["Zone_DB_to_Storage", "Zone_App_to_Storage"] },
        { name: "Production_ZoneSet_VSAN200", vsanId: 200, isActive: true,  zones: ["Zone_DB_to_Storage_VSAN200"] },
      ],
    });
  }
  return switchStates.get(ip)!;
}

// ---------------------------------------------------------------------------
// Public API for SimulatorConfig UI and API routes
// ---------------------------------------------------------------------------
export function getSimulatorState(ip: string): SwitchState { return getState(ip); }

export function updateSimulatorPorts(ip: string, ports: SimPortConfig[]): void {
  // Re-compute auto ranges for any port where min==max==0
  const resolved = ports.map(p => {
    const needsAuto = p.txMinMbps === 0 && p.txMaxMbps === 0;
    return needsAuto ? { ...p, ...autoRanges(p.speedGbps, p.degraded) } : p;
  });
  getState(ip).ports = resolved;
  logger.info({ ip, portCount: resolved.length }, "[SIMULATOR] Ports updated");
}

export function resetSimulatorState(ip: string): void {
  switchStates.delete(ip);
  logger.info({ ip }, "[SIMULATOR] State reset to defaults");
}

// ---------------------------------------------------------------------------
// MdsSimulator
// ---------------------------------------------------------------------------
export class MdsSimulator {
  private get state(): SwitchState { return getState(this.ip); }

  constructor(private readonly ip: string) {
    logger.info({ ip }, "[SIMULATOR] MDS 9000 simulator active");
  }

  async sendCommand<T>(command: string): Promise<{ body: T; code: string; input: string; msg: string }> {
    this.state.pollCount++;
    await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
    const body = this.dispatch(command.trim());
    return { body: body as T, code: "200", input: command, msg: "Success" };
  }

  async sendConfigBatch(commands: string[]): Promise<void> {
    await new Promise(r => setTimeout(r, 20 + commands.length * 5));
    this.applyConfig(commands);
    logger.info({ ip: this.ip, cmdCount: commands.length }, "[SIMULATOR] config applied");
  }

  // ── Command router ──────────────────────────────────────────────────────
  private dispatch(cmd: string): unknown {
    const c = cmd.toLowerCase();
    if (c.includes("show interface counters brief"))          return this.showCountersBrief();
    if (c.includes("show interface counters"))                return this.showCounters();
    if (c.includes("show interface transceiver"))             return this.showTransceiver();
    if (c.includes("show interface brief"))                   return this.showInterfaceBrief();
    if (c.startsWith("show interface") && !c.includes("counters") && !c.includes("transceiver") && !c.includes("brief"))
                                                              return this.showInterface();
    if (c.includes("show flogi database"))                    return this.showFlogiDatabase(cmd);
    if (c.includes("show fcns database detail"))              return this.showFcnsDetail(cmd);
    if (c.includes("show fcns database"))                     return this.showFcnsDetail(cmd);
    if (c.includes("show fcs database"))                      return this.showFcs(cmd);
    if (c.includes("show device-alias database"))             return this.showDeviceAlias();
    if (c.includes("show vsan") && c.includes("membership")) return this.showVsanMembership(cmd);
    if (c.includes("show vsan"))                              return this.showVsan(cmd);
    if (c.includes("show zoneset"))                           return this.showZoneSet(cmd);
    if (c.includes("show zone"))                              return {};
    if (c.includes("show version"))                           return this.showVersion();
    if (c.includes("show inventory"))                         return this.showInventory();
    if (c.includes("show system uptime"))                     return this.showUptime();
    logger.warn({ ip: this.ip, cmd }, "[SIMULATOR] unhandled command");
    return {};
  }

  // ── show version ──────────────────────────────────────────────────────
  private showVersion() {
    return {
      header_str:    `Cisco Nexus Operating System (NX-OS) Software\nMDS 9396S [SIMULATED ${this.ip}]`,
      chassis_id:    "MDS 9396S (Simulated)",
      sys_ver_str:   "9.3(8) [SIMULATED]",
      proc_board_id: `SIM${ipSeed(this.ip).toString(16).toUpperCase().slice(0, 8)}`,
    };
  }

  private showInventory() {
    return {
      TABLE_inv: {
        ROW_inv: {
          name: "Chassis", desc: "MDS 9396S Chassis",
          productid: "DS-C9396S", vid: "V02",
          serialnum: `SIM${ipSeed(this.ip).toString(16).toUpperCase().slice(0, 8)}`,
        },
      },
    };
  }

  private showUptime() {
    const pc = this.state.pollCount;
    return { sys_uptime_str: `${Math.floor(pc / 1440)}d ${Math.floor((pc % 1440) / 60)}h ${pc % 60}m` };
  }

  // ── show interface (full) ─────────────────────────────────────────────
  private showInterface() {
    const st = this.state;
    return {
      TABLE_interface: {
        ROW_interface: st.ports.map((port, idx) => {
          const alias = st.aliases[idx] ?? null;
          return {
            interface:     port.name,
            state:         port.state,
            admin_state:   "up",
            admin_mode:    port.mode,
            oper_mode:     port.mode,
            oper_speed:    String(port.speedGbps * 1000),
            port_wwn:      makeWwn("20:00:de:fb", this.ip, idx + 1),
            peer_port_wwn: alias?.pwwn ?? "",
            vsan:          String(port.vsanId),
            fcid:          port.state === "up" ? `0x${(port.vsanId * 0x10000 + idx + 1).toString(16).padStart(6, "0")}` : "",
            port_mode:     port.mode,
            logical_type:  port.mode === "E" || port.mode === "TE" ? "core" : "edge",
            description:   alias?.name ?? "",
          };
        }),
      },
    };
  }

  // ── show interface brief (Cisco DevNet field names) ───────────────────
  private showInterfaceBrief() {
    return {
      TABLE_interface_brief_if: {
        ROW_interface_brief_if: this.state.ports.map(port => ({
          interface:        port.name,
          vsan:             String(port.vsanId),
          admin_mode:       port.mode,
          admin_trunk_mode: "on",
          status:           port.state,
          fcot_info:        port.sfpPresent ? "swl" : "--",
          oper_mode:        port.mode,
          oper_speed:       String(port.speedGbps),
          port_channel:     "--",
          logical_type:     port.mode === "E" || port.mode === "TE" ? "core" : "edge",
        })),
      },
    };
  }

  // ── Counters — values derived from configurable min/max ranges ────────
  private simCounter(port: SimPortConfig) {
    const pc = this.state.pollCount;
    const idx = this.state.ports.indexOf(port);
    const base = idx * 10_000_000;

    if (port.state === "down") {
      return {
        interface: port.name, rx_frames: "0", tx_frames: "0",
        rx_words: "0", tx_words: "0", rx_bytes: "0", tx_bytes: "0",
        rx_crc_err: "0", link_failures: "0", sync_losses: "0", signal_losses: "0",
      };
    }

    // Compute instantaneous Mbps within configured range
    const txMbps = simValue(port.txMinMbps, port.txMaxMbps, pc, idx * 0.7);
    const rxMbps = simValue(port.rxMinMbps, port.rxMaxMbps, pc, idx * 0.7 + 0.5);

    // Accumulate: words = Mbps * elapsed_seconds * 1e6 / 8 / 4
    // One word = 4 bytes = 32 bits; 1 Mbps = 1e6 bits/s
    // Per poll (60s): words = Mbps * 60 * 1e6 / 32
    const txWordsPerPoll = Math.round(txMbps * 60 * 1e6 / 32);
    const rxWordsPerPoll = Math.round(rxMbps * 60 * 1e6 / 32);
    const txWords = base + txWordsPerPoll * pc;
    const rxWords = base + rxWordsPerPoll * pc;
    const framesPerWord = 1 / 128;  // ~128 words per typical FC frame
    const crcErr = port.name === "fc1/3" && pc > 5 ? String(pc - 5) : "0";

    return {
      interface:     port.name,
      rx_frames:     String(Math.round(rxWords * framesPerWord)),
      tx_frames:     String(Math.round(txWords * framesPerWord)),
      rx_words:      String(rxWords),
      tx_words:      String(txWords),
      rx_bytes:      String(rxWords * 4),
      tx_bytes:      String(txWords * 4),
      rx_crc_err:    crcErr,
      link_failures: "0",
      sync_losses:   "0",
      signal_losses: "0",
    };
  }

  private showCounters() {
    return { TABLE_interface: { ROW_interface: this.state.ports.map(p => this.simCounter(p)) } };
  }

  private showCountersBrief() {
    return {
      TABLE_interface_brief: {
        ROW_interface_brief: this.state.ports.map(p => ({
          ...this.simCounter(p),
          rx_errors: this.simCounter(p).rx_crc_err,
          tx_errors: "0",
        })),
      },
    };
  }

  // ── Transceiver — values from configurable SFP power ranges ──────────
  private simXcvr(port: SimPortConfig) {
    if (!port.sfpPresent || port.state === "down") {
      return { interface: port.name, sfp: "absent" };
    }
    const pc  = this.state.pollCount;
    const idx = this.state.ports.indexOf(port);

    const rxPower = simValue(port.rxPwrMin, port.rxPwrMax, pc, idx * 0.6).toFixed(2);
    const txPower = simValue(port.txPwrMin, port.txPwrMax, pc, idx * 0.6 + 1).toFixed(2);
    const temp    = simValue(32, 42, pc, idx * 0.4).toFixed(1);
    const voltage = simValue(3.27, 3.35, pc, idx * 0.2).toFixed(3);
    const current = simValue(6.0, 7.5, pc, idx * 0.3).toFixed(2);

    return {
      interface: port.name,
      sfp:       "present",
      name:      ["CISCO-AVAGO","CISCO-FINISAR","CISCO-JDSU","CISCO-AVAGO",
                  "CISCO-FINISAR","CISCO-JDSU","CISCO-AVAGO","CISCO-FINISAR"][idx % 8],
      partnum:   port.degraded ? "SFBR-5799APZ-CS5" : "AFBR-57F5PZ-CS1",
      serialnum: `SIM${port.name.replace("/", "")}${String(ipSeed(this.ip) & 0xFFFF).padStart(4, "0")}`,
      TABLE_calibration: {
        ROW_calibration: {
          temperature: temp,
          voltage,
          current,
          rx_pwr: rxPower,
          tx_pwr: txPower,
        },
      },
    };
  }

  private showTransceiver() {
    return {
      TABLE_interface_transceiver: {
        ROW_interface_transceiver: this.state.ports.map(p => this.simXcvr(p)),
      },
    };
  }

  // ── show flogi database ───────────────────────────────────────────────
  private showFlogiDatabase(cmd: string) {
    const vsanMatch  = cmd.match(/vsan\s+(\d+)/i);
    const vsanFilter = vsanMatch ? parseInt(vsanMatch[1]) : null;
    const st = this.state;
    const entries: object[] = [];

    st.ports.forEach((port, idx) => {
      if (port.state !== "up") return;
      if (vsanFilter && port.vsanId !== vsanFilter) return;
      const alias = st.aliases[idx] ?? null;
      if (!alias) return;
      entries.push({
        interface: port.name,
        vsan:      port.vsanId,
        fcid:      `0x${(port.vsanId * 0x10000 + idx + 1).toString(16).padStart(6, "0")}`,
        port_name: alias.pwwn,
        node_name: alias.pwwn.replace(/^[0-9a-f]{2}:/, "20:"),
      });
    });

    return {
      TABLE_flogi_entry: { ROW_flogi_entry: entries.length === 1 ? entries[0] : entries },
    };
  }

  // ── show fcns database detail ─────────────────────────────────────────
  private showFcnsDetail(cmd: string) {
    const st = this.state;
    const vsanMatch  = cmd.match(/vsan\s+(\d+)/i);
    const vsanFilter = vsanMatch ? parseInt(vsanMatch[1]) : null;
    const vsans = vsanFilter ? [vsanFilter] : [...new Set(st.ports.map(p => p.vsanId))];

    return {
      TABLE_fcns_vsan: {
        ROW_fcns_vsan: vsans.map(vsanId => ({
          vsan_id: String(vsanId),
          TABLE_fcns_database: {
            ROW_fcns_database: st.ports
              .filter(p => p.vsanId === vsanId && p.state === "up")
              .map((port, i) => {
                const idx   = st.ports.indexOf(port);
                const alias = st.aliases[idx] ?? null;
                const pwwn  = alias?.pwwn ?? makeWwn("20:00:de:fb", this.ip, idx + 1);
                return {
                  pwwn,
                  fcid:                `0x${(vsanId * 0x10000 + idx + 1).toString(16).padStart(6, "0")}`,
                  type:                port.mode === "E" || port.mode === "TE" ? "NL" : "N",
                  vendor:              ["Emulex", "QLogic", "Pure Storage", "Cisco"][i % 4],
                  node_name:           pwwn.replace(/^[0-9a-f]{2}:/, "20:"),
                  fc4_types:           port.mode === "E" || port.mode === "TE" ? "scsi-fcp:target" : "scsi-fcp:init",
                  symbolic_port_name:  alias?.name ?? "",
                  symbolic_node_name:  alias ? `${alias.name}_NODE` : "",
                  connected_interface: port.name,
                  switch_name:         `MDS-SIM-${this.ip}`,
                };
              }),
          },
        })),
      },
    };
  }

  // ── show fcs database ─────────────────────────────────────────────────
  private showFcs(cmd: string) {
    const st = this.state;
    const vsanMatch  = cmd.match(/vsan\s+(\d+)/i);
    const vsanFilter = vsanMatch ? parseInt(vsanMatch[1]) : null;
    const vsans = vsanFilter ? [vsanFilter] : [...new Set(st.ports.map(p => p.vsanId))];

    return {
      TABLE_fcs_vsan: {
        ROW_fcs_vsan: vsans.map(vsanId => ({
          vsan_id: String(vsanId),
          TABLE_fcs_ie: {
            ROW_fcs_ie: [{
              ie_wwn:  makeWwn("10:00:de:fb", this.ip, vsanId),
              ie_name: `MDS-SIM-${this.ip}`,
              TABLE_fcs_port: {
                ROW_fcs_port: st.ports
                  .filter(p => p.vsanId === vsanId && p.state === "up")
                  .map((port, i) => {
                    const idx   = st.ports.indexOf(port);
                    const alias = st.aliases[idx] ?? null;
                    return {
                      port_wwn:  alias?.pwwn ?? makeWwn("20:00:de:fb", this.ip, idx + 1),
                      port_name: alias?.name ?? "",
                      port_type: port.mode,
                      port_fcid: `0x${(vsanId * 0x10000 + idx + 1).toString(16).padStart(6, "0")}`,
                      interface: port.name,
                    };
                  }),
              },
            }],
          },
        })),
      },
    };
  }

  // ── show device-alias database ────────────────────────────────────────
  private showDeviceAlias() {
    return {
      TABLE_device_alias_database: {
        ROW_device_alias_database: this.state.aliases.map(a => ({
          dev_alias_name: a.name, pwwn: a.pwwn,
        })),
      },
    };
  }

  // ── show vsan ─────────────────────────────────────────────────────────
  private showVsan(cmd: string) {
    const vsanMatch  = cmd.match(/vsan\s+(\d+)/i);
    const vsanFilter = vsanMatch ? parseInt(vsanMatch[1]) : null;
    const vsans = vsanFilter ? [vsanFilter] : [...new Set(this.state.ports.map(p => p.vsanId))];
    return {
      TABLE_vsan: {
        ROW_vsan: vsans.map(v => ({
          vsan_id: String(v), vsan_name: `VSAN${v}`,
          vsan_state: "active", vsan_admin_state: "active",
        })),
      },
    };
  }

  private showVsanMembership(cmd: string) {
    const vsanMatch = cmd.match(/vsan\s+(\d+)/i);
    const vsanId    = vsanMatch ? parseInt(vsanMatch[1]) : 100;
    const ifaces    = this.state.ports.filter(p => p.vsanId === vsanId).map(p => p.name);
    return { TABLE_vsan_membership: { ROW_vsan_membership: { vsan: String(vsanId), interfaces: ifaces } } };
  }

  // ── show zoneset ──────────────────────────────────────────────────────
  private showZoneSet(cmd: string) {
    const st = this.state;
    const vsanMatch  = cmd.match(/vsan\s+(\d+)/i);
    const vsanFilter = vsanMatch ? parseInt(vsanMatch[1]) : null;
    const matching   = st.zoneSets.filter(zs => !vsanFilter || zs.vsanId === vsanFilter);
    if (matching.length === 0) return {};

    return {
      TABLE_zoneset: {
        ROW_zoneset: matching.map(zs => ({
          zoneset_name:   zs.name,
          zoneset_vsan:   String(zs.vsanId),
          zoneset_active: String(zs.isActive),
          TABLE_zone: {
            ROW_zone: zs.zones
              .map(zname => st.zones.find(z => z.name === zname && z.vsanId === zs.vsanId))
              .filter(Boolean)
              .map(zone => ({
                zone_name: zone!.name,
                TABLE_zone_member: zone!.members.length ? {
                  ROW_zone_member: zone!.members.map(m =>
                    m.type === "pwwn" ? { wwn: m.value } : { device_alias: m.value }
                  ),
                } : undefined,
              })),
          },
        })),
      },
    };
  }

  // ── Config parser ─────────────────────────────────────────────────────
  private applyConfig(commands: string[]) {
    const st = this.state;
    let curZone:    string | null = null;
    let curZoneSet: string | null = null;
    let curVsan = 100;
    let inAlias = false;

    for (const raw of commands) {
      const cmd = raw.trim().toLowerCase();
      if (!cmd || cmd === "conf t" || cmd === "end") continue;

      if (cmd === "device-alias database") { inAlias = true; curZone = curZoneSet = null; continue; }
      if (cmd === "device-alias commit")   { inAlias = false; continue; }

      if (inAlias) {
        const m = raw.trim().match(/device-alias name (\S+)\s+pwwn\s+(\S+)/i);
        if (m) {
          const [, name, pwwn] = m;
          const ei = st.aliases.findIndex(a => a.name.toLowerCase() === name.toLowerCase());
          if (ei >= 0) st.aliases[ei] = { name, pwwn: pwwn.toLowerCase() };
          else         st.aliases.push({ name, pwwn: pwwn.toLowerCase() });
        }
        continue;
      }

      const zm = raw.trim().match(/^zone name (\S+)\s+vsan\s+(\d+)$/i);
      if (zm) {
        curZone = zm[1]; curVsan = parseInt(zm[2]); curZoneSet = null;
        if (!st.zones.find(z => z.name === curZone && z.vsanId === curVsan))
          st.zones.push({ name: curZone, vsanId: curVsan, members: [] });
        continue;
      }

      if (curZone) {
        const zone = st.zones.find(z => z.name === curZone && z.vsanId === curVsan);
        if (zone) {
          const pm = raw.trim().match(/member\s+pwwn\s+(\S+)/i);
          const am = raw.trim().match(/member\s+device-alias\s+(\S+)/i);
          if (pm && !zone.members.find(m => m.value === pm[1].toLowerCase()))
            zone.members.push({ type: "pwwn", value: pm[1].toLowerCase() });
          if (am && !zone.members.find(m => m.value === am[1]))
            zone.members.push({ type: "device_alias", value: am[1] });
        }
        continue;
      }

      const zsm = raw.trim().match(/^zoneset name (\S+)\s+vsan\s+(\d+)$/i);
      if (zsm) {
        curZoneSet = zsm[1]; curVsan = parseInt(zsm[2]); curZone = null;
        if (!st.zoneSets.find(zs => zs.name === curZoneSet && zs.vsanId === curVsan))
          st.zoneSets.push({ name: curZoneSet, vsanId: curVsan, isActive: false, zones: [] });
        continue;
      }

      if (curZoneSet) {
        const mm = raw.trim().match(/^\s*member\s+(\S+)/i);
        if (mm) {
          const zs = st.zoneSets.find(z => z.name === curZoneSet && z.vsanId === curVsan);
          if (zs && !zs.zones.includes(mm[1])) zs.zones.push(mm[1]);
        }
        continue;
      }

      const am = raw.trim().match(/zoneset activate name (\S+)\s+vsan\s+(\d+)/i);
      if (am) {
        const [, name, vs] = am;
        const vsan = parseInt(vs);
        for (const zs of st.zoneSets) if (zs.vsanId === vsan) zs.isActive = (zs.name === name);
      }
    }
  }
}

export function isSim(): boolean {
  return process.env.MDS_SIMULATE === "true";
}
