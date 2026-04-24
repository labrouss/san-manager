// =============================================================================
// services/MdsFabricService.ts
// Queries FCNS/FCS databases and interface counters brief.
// Powers the fabric discovery, WWN dropdown, and performance pages.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { MdsClient } from "./MdsClient";
import type { AnyMdsClient } from "./clientFactory";
import {
  ShowFcnsBody, FcnsVsanRow, FcnsDatabaseRow,
  ShowFcsBody, FcsVsanRow, FcsPortRow,
  ShowInterfaceCountersBriefBody, InterfaceCounterBriefRow,
  FcnsEntry, FcsPort, InterfaceBriefCounters, InterfaceThroughputStats, TopPortsResult,
} from "../types/fabric.types";
import logger from "../config/logger";

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function parseBigInt(v: string | undefined): bigint {
  if (!v) return 0n;
  return BigInt(v.replace(/,/g, "").trim() || "0");
}

// ---------------------------------------------------------------------------
// Parsing functions (exported for unit tests)
// ---------------------------------------------------------------------------

export function parseFcnsDatabase(body: ShowFcnsBody): FcnsEntry[] {
  const vsanRows = toArray(body.TABLE_fcns_vsan?.ROW_fcns_vsan);
  const entries: FcnsEntry[] = [];

  for (const vsanRow of vsanRows) {
    const vsanId = parseInt(vsanRow.vsan_id, 10);
    const dbRows = toArray(vsanRow.TABLE_fcns_database?.ROW_fcns_database);

    for (const row of dbRows) {
      entries.push({
        vsanId,
        pwwn:               row.pwwn?.trim() ?? "",
        fcid:               row.fcid?.trim() ?? "",
        type:               row.type?.trim() ?? null,
        vendor:             row.vendor?.trim() ?? null,
        nodeName:           row.node_name?.trim() ?? null,
        fc4Types:           row.fc4_types?.trim() ?? null,
        symbolicPortName:   row.symbolic_port_name?.trim() ?? null,
        symbolicNodeName:   row.symbolic_node_name?.trim() ?? null,
        connectedInterface: row.connected_interface?.trim() ?? null,
        switchName:         row.switch_name?.trim() ?? null,
      });
    }
  }

  return entries;
}

export function parseFcsDatabase(body: ShowFcsBody): FcsPort[] {
  const vsanRows = toArray(body.TABLE_fcs_vsan?.ROW_fcs_vsan);
  const ports: FcsPort[] = [];

  for (const vsanRow of vsanRows) {
    const vsanId = parseInt(vsanRow.vsan_id, 10);
    const ieRows = toArray(vsanRow.TABLE_fcs_ie?.ROW_fcs_ie);

    for (const ie of ieRows) {
      const portRows = toArray(ie.TABLE_fcs_port?.ROW_fcs_port);
      for (const port of portRows) {
        ports.push({
          vsanId,
          portWwn:       port.port_wwn?.trim() ?? "",
          portName:      port.port_name?.trim() ?? null,
          portType:      port.port_type?.trim() ?? null,
          fcid:          port.port_fcid?.trim() ?? null,
          connectedPwwn: port.connected_pwwn?.trim() ?? null,
          interface:     port.interface?.trim() ?? null,
        });
      }
    }
  }

  return ports;
}

export function parseCountersBrief(body: ShowInterfaceCountersBriefBody): InterfaceBriefCounters[] {
  const rows = toArray(body.TABLE_interface_brief?.ROW_interface_brief);
  const now = new Date();

  return rows
    .filter((r: InterfaceCounterBriefRow) => /^fc\d+\/\d+/i.test(r.interface))
    .map((r: InterfaceCounterBriefRow): InterfaceBriefCounters => ({
      interfaceName:  r.interface,
      rxFrames:       parseBigInt(r.rx_frames),
      txFrames:       parseBigInt(r.tx_frames),
      rxWords:        parseBigInt(r.rx_words),
      txWords:        parseBigInt(r.tx_words),
      rxErrors:       parseBigInt(r.rx_errors),
      txErrors:       parseBigInt(r.tx_errors),
      collectedAt:    now,
    }));
}

// ---------------------------------------------------------------------------
// In-memory counter cache for delta calculation (per switch)
// ---------------------------------------------------------------------------
type CounterCacheKey = string; // `${switchId}::${interfaceName}`
const counterCache = new Map<CounterCacheKey, InterfaceBriefCounters>();

// ---------------------------------------------------------------------------
// MdsFabricService
// ---------------------------------------------------------------------------

export class MdsFabricService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── FCNS database ──────────────────────────────────────────────────────────

  async fetchFcnsDatabase(
    client: AnyMdsClient,
    vsanId?: number
  ): Promise<FcnsEntry[]> {
    const cmd = vsanId
      ? `show fcns database detail vsan ${vsanId}`
      : "show fcns database detail";

    try {
      const output = await client.sendCommand<ShowFcnsBody>(cmd);
      return parseFcnsDatabase(output.body);
    } catch (err) {
      logger.warn({ err, cmd }, "FCNS database query failed");
      return [];
    }
  }

  /** Get all known WWNs for a switch+vsan — used to populate dropdowns */
  async getKnownWwns(
    switchId: string,
    vsanId: number
  ): Promise<{ pwwn: string; alias: string | null; fcid: string | null; vendor: string | null; connectedInterface: string | null }[]> {
    // Get fc_aliases from DB (fastest, no live switch needed)
    const aliases = await this.prisma.fcAlias.findMany({
      where: { switchId },
      select: { wwn: true, name: true },
    });
    const aliasMap = new Map(aliases.map((a) => [a.wwn, a.name]));

    // Get latest FCNS snapshot from port_metrics distinct WWNs (approximation)
    // In production, we'd cache FCNS results — for now return aliases + orphaned
    const allWwns = aliases.map((a) => ({
      pwwn: a.wwn,
      alias: a.name,
      fcid: null as string | null,
      vendor: null as string | null,
      connectedInterface: null as string | null,
    }));

    return allWwns;
  }

  // ── Live FCNS + FCS query ──────────────────────────────────────────────────

  async fetchAndEnrichFabric(
    client: AnyMdsClient,
    switchId: string,
    vsanId: number
  ): Promise<{
    fcns: FcnsEntry[];
    fcs: FcsPort[];
    wwns: { pwwn: string; alias: string | null; fcid: string | null; vendor: string | null; connectedInterface: string | null }[];
  }> {
    const [fcnsOutput, fcsOutput] = await Promise.allSettled([
      client.sendCommand<ShowFcnsBody>(`show fcns database detail vsan ${vsanId}`),
      client.sendCommand<ShowFcsBody>(`show fcs database vsan ${vsanId}`),
    ]);

    const fcns = fcnsOutput.status === "fulfilled"
      ? parseFcnsDatabase(fcnsOutput.value.body)
      : [];

    const fcs = fcsOutput.status === "fulfilled"
      ? parseFcsDatabase(fcsOutput.value.body)
      : [];

    // Sync FCNS entries to fc_aliases (alias bridge)
    const existingAliases = await this.prisma.fcAlias.findMany({
      where: { switchId },
      select: { wwn: true, name: true },
    });
    const aliasMap = new Map(existingAliases.map((a) => [a.wwn, a.name]));

    // Build enriched WWN list merging FCNS data with local aliases
    const wwns = fcns.map((e) => ({
      pwwn:               e.pwwn,
      alias:              (aliasMap.get(e.pwwn) ?? null) as string | null,
      fcid:               e.fcid,
      vendor:             e.vendor,
      connectedInterface: e.connectedInterface,
    }));

    // Upsert discovered WWNs into fc_aliases as orphaned if not already named
    for (const entry of fcns) {
      if (!aliasMap.has(entry.pwwn) && entry.pwwn) {
        await this.prisma.fcAlias.upsert({
          where: { switchId_wwn: { switchId, wwn: entry.pwwn } },
          create: {
            switchId,
            name: entry.symbolicPortName ?? entry.pwwn.slice(-8),
            wwn: entry.pwwn,
            isOrphaned: true,
          },
          update: { isOrphaned: true },
        }).catch(() => {}); // ignore duplicate name conflicts
      }
    }

    return { fcns, fcs, wwns };
  }

  // ── Interface counters brief + throughput calculation ──────────────────────

  async fetchTopPorts(
    client: AnyMdsClient,
    switchId: string,
    vsanId: number,
    topN = 5
  ): Promise<TopPortsResult> {
    const output = await client.sendCommand<ShowInterfaceCountersBriefBody>(
      "show interface counters brief"
    );
    const current = parseCountersBrief(output.body);

    const stats: InterfaceThroughputStats[] = [];

    for (const cnt of current) {
      const key: CounterCacheKey = `${switchId}::${cnt.interfaceName}`;
      const prev = counterCache.get(key);
      counterCache.set(key, cnt);

      if (!prev) continue;

      const elapsedSec = (cnt.collectedAt.getTime() - prev.collectedAt.getTime()) / 1000;
      if (elapsedSec <= 0) continue;

      // FC words = 4 bytes each; convert to Mbps
      const txMbps = Number(cnt.txWords - prev.txWords) * 4 * 8 / elapsedSec / 1e6;
      const rxMbps = Number(cnt.rxWords - prev.rxWords) * 4 * 8 / elapsedSec / 1e6;
      const txFps  = Number(cnt.txFrames - prev.txFrames) / elapsedSec;
      const rxFps  = Number(cnt.rxFrames - prev.rxFrames) / elapsedSec;
      const errors = Number((cnt.rxErrors + cnt.txErrors) - (prev.rxErrors + prev.txErrors));

      if (txMbps < 0 || rxMbps < 0) continue; // counter wrap

      stats.push({
        interfaceName:  cnt.interfaceName,
        txMbps:         Math.max(0, txMbps),
        rxMbps:         Math.max(0, rxMbps),
        txFramesPerSec: Math.max(0, txFps),
        rxFramesPerSec: Math.max(0, rxFps),
        errorRate:      Math.max(0, errors / elapsedSec),
        connectedWwn:   null,
        alias:          null,
      });
    }

    // Sort by combined throughput, return top N
    stats.sort((a, b) => (b.txMbps + b.rxMbps) - (a.txMbps + a.rxMbps));
    const topPorts = stats.slice(0, topN);

    // Enrich with alias info from DB
    const aliases = await this.prisma.fcAlias.findMany({ where: { switchId } });
    // (port→WWN mapping would require FCNS — approximate with fc_aliases by name pattern)

    return {
      switchId,
      vsanId,
      collectedAt: new Date().toISOString(),
      ports: topPorts,
    };
  }

  // ── Interface name list for dropdowns ──────────────────────────────────────

  async getInterfaceNames(switchId: string): Promise<string[]> {
    const rows = await this.prisma.portMetrics.findMany({
      where: { switchId },
      distinct: ["interfaceName"],
      select: { interfaceName: true },
      orderBy: { interfaceName: "asc" },
    });
    return rows.map((r) => r.interfaceName);
  }
}
