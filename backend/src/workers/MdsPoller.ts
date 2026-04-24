// =============================================================================
// workers/MdsPoller.ts
// 60-second polling loop for all active switches.
// Dynamically adds new switches without requiring a restart.
// Collects: FC counters (Tx/Rx bytes/words/errors) + transceiver DDMI.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { buildClient } from "../services/clientFactory";
import { MdsZoningService } from "../services/MdsZoningService";
import logger from "../config/logger";

// ---------------------------------------------------------------------------
interface CounterRow {
  interface:      string;
  rx_bytes?:      string;
  tx_bytes?:      string;
  rx_words?:      string;
  tx_words?:      string;
  rx_crc_err?:    string;
  link_failures?: string;
  sync_losses?:   string;
  signal_losses?: string;
}

interface TransceiverCalRow {
  temperature?: string;
  voltage?:     string;
  current?:     string;
  rx_pwr?:      string;
  tx_pwr?:      string;
}

interface TransceiverRow {
  interface:           string;
  sfp?:                string;
  TABLE_calibration?:  { ROW_calibration?: TransceiverCalRow };
}

// ---------------------------------------------------------------------------
function parseCounter(raw?: string): bigint {
  if (!raw) return 0n;
  return BigInt(raw.replace(/[^0-9]/g, "").trim() || "0");
}

function parseFloat_(raw?: string): number | null {
  if (!raw || raw === "--" || raw === "N/A" || raw === "") return null;
  const n = parseFloat(raw.trim());
  return isNaN(n) ? null : n;
}

function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ---------------------------------------------------------------------------
// In-memory counter state for delta calculations
// ---------------------------------------------------------------------------
type PrevKey = string; // `${switchId}::${interfaceName}`
const previousCounters = new Map<PrevKey, {
  rxBytes: bigint; txBytes: bigint; rxWords: bigint; txWords: bigint;
  crcErrors: bigint; ts: Date;
}>();

// ---------------------------------------------------------------------------
export class MdsPoller {
  private timers        = new Map<string, ReturnType<typeof setInterval>>();
  private running       = false;
  private zoningService: MdsZoningService;
  // Watch timer — checks for new switches every 30 seconds
  private watchTimer:   ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaClient) {
    this.zoningService = new MdsZoningService(prisma);
  }

  // ---------------------------------------------------------------------------
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Initial poll for all existing active switches
    await this.syncSwitches();
    logger.info({ count: this.timers.size }, "MdsPoller started");

    // Watch for newly registered switches every 30 s
    this.watchTimer = setInterval(() => this.syncSwitches(), 30_000);
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers.clear();
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = null;
    this.running    = false;
    logger.info("MdsPoller stopped");
  }

  // ---------------------------------------------------------------------------
  // Sync: start polling any switch that doesn't have a timer yet
  // ---------------------------------------------------------------------------
  private async syncSwitches(): Promise<void> {
    if (!this.running) return;
    try {
      const switches = await this.prisma.switch.findMany({ where: { isActive: true } });

      for (const sw of switches) {
        if (this.timers.has(sw.id)) continue;   // already polling

        logger.info({ switchId: sw.id, ip: sw.ipAddress }, "MdsPoller: registering new switch");

        // Immediate first poll
        this.poll(sw.id, sw.ipAddress).catch(e =>
          logger.warn({ switchId: sw.id, err: String(e) }, "Initial poll failed (non-fatal)")
        );

        // Recurring poll every 60 s
        const t = setInterval(
          () => this.poll(sw.id, sw.ipAddress).catch(e =>
            logger.warn({ switchId: sw.id, err: String(e) }, "Poll failed (non-fatal)")
          ),
          60_000
        );
        this.timers.set(sw.id, t);
      }

      // Stop polling switches that have been removed / deactivated
      for (const [switchId] of this.timers) {
        const stillActive = switches.find(s => s.id === switchId);
        if (!stillActive) {
          const t = this.timers.get(switchId);
          if (t) clearInterval(t);
          this.timers.delete(switchId);
          logger.info({ switchId }, "MdsPoller: removed deactivated switch");
        }
      }
    } catch (err) {
      logger.warn({ err }, "MdsPoller syncSwitches error (non-fatal)");
    }
  }

  // ---------------------------------------------------------------------------
  private async poll(switchId: string, ip: string): Promise<void> {
    logger.debug({ switchId, ip }, "Polling");
    const client = buildClient(switchId, ip);

    // ── Counters + transceiver in parallel ───────────────────────────────────
    const [counterRes, xcvrRes] = await Promise.all([
      client.sendCommand<{ TABLE_interface: { ROW_interface: CounterRow | CounterRow[] } }>(
        "show interface counters"
      ),
      client.sendCommand<{ TABLE_interface_transceiver: { ROW_interface_transceiver: TransceiverRow | TransceiverRow[] } }>(
        "show interface transceiver"
      ),
    ]);

    const counterRows = toArray(counterRes.body.TABLE_interface?.ROW_interface);
    const xcvrRows    = toArray(xcvrRes.body.TABLE_interface_transceiver?.ROW_interface_transceiver);
    const xcvrMap     = new Map(xcvrRows.map(x => [x.interface, x]));

    const now     = new Date();
    const records: Record<string, unknown>[] = [];

    for (const row of counterRows) {
      if (!/^fc\d+\/\d+/i.test(row.interface)) continue;

      const rxBytes   = parseCounter(row.rx_bytes);
      const txBytes   = parseCounter(row.tx_bytes);
      const rxWords   = parseCounter(row.rx_words);
      const txWords   = parseCounter(row.tx_words);
      const crcErrors = parseCounter(row.rx_crc_err);

      const prevKey = `${switchId}::${row.interface}` as PrevKey;
      const prev    = previousCounters.get(prevKey);

      let txRateBps: number | null = null;
      let rxRateBps: number | null = null;

      if (prev) {
        const elapsed = (now.getTime() - prev.ts.getTime()) / 1000;
        if (elapsed > 0) {
          const txDeltaWords = Number(txWords - prev.txWords);
          const rxDeltaWords = Number(rxWords - prev.rxWords);
          const txDeltaBytes = Number(txBytes - prev.txBytes);
          const rxDeltaBytes = Number(rxBytes - prev.rxBytes);

          if (txDeltaWords > 0) txRateBps = (txDeltaWords * 4 * 8) / elapsed;
          else if (txDeltaBytes > 0) txRateBps = (txDeltaBytes * 8) / elapsed;

          if (rxDeltaWords > 0) rxRateBps = (rxDeltaWords * 4 * 8) / elapsed;
          else if (rxDeltaBytes > 0) rxRateBps = (rxDeltaBytes * 8) / elapsed;

          if (crcErrors > prev.crcErrors) {
            logger.warn({ iface: row.interface, delta: (crcErrors - prev.crcErrors).toString() }, "CRC error spike");
          }
        }
      }

      previousCounters.set(prevKey, { rxBytes, txBytes, rxWords, txWords, crcErrors, ts: now });

      // ── SFP / transceiver diagnostics ────────────────────────────────────
      const xcvr     = xcvrMap.get(row.interface);
      const sfpAbsent = xcvr?.sfp === "absent" || !xcvr;
      const cal       = xcvr?.TABLE_calibration?.ROW_calibration;

      records.push({
        timestamp:     now,
        switchId,
        interfaceName: row.interface,
        txBytes,
        rxBytes,
        crcErrors,
        linkFailures:  parseCounter(row.link_failures),
        txRateBps,
        rxRateBps,
        rxPowerDbm:    sfpAbsent ? null : parseFloat_(cal?.rx_pwr),
        txPowerDbm:    sfpAbsent ? null : parseFloat_(cal?.tx_pwr),
        temperature:   sfpAbsent ? null : parseFloat_(cal?.temperature),
        voltage:       sfpAbsent ? null : parseFloat_(cal?.voltage),
        current:       sfpAbsent ? null : parseFloat_(cal?.current),
      });
    }

    if (records.length > 0) {
      await this.prisma.portMetrics.createMany({
        data:           records as any,
        skipDuplicates: true,
      });
      logger.debug({ switchId, rows: records.length }, "Metrics stored");
    }

    // ── Alias bridge: sync device-alias DB every ~10 polls (~10 min) ─────────
    try {
      const pollMod = Math.floor(Date.now() / 60_000) % 10;
      if (pollMod === 0) {
        const sw = await this.prisma.switch.findUnique({ where: { id: switchId } });
        if (sw) {
          await this.zoningService.syncAliases(switchId, client as any, sw.ipAddress);
          logger.debug({ switchId }, "Alias bridge sync complete");
        }
      }
    } catch (err) {
      logger.warn({ switchId, err }, "Alias bridge sync failed (non-fatal)");
    }

    // ── Update switch lastSeenAt ──────────────────────────────────────────────
    await this.prisma.switch.update({
      where: { id: switchId },
      data:  { lastSeenAt: now },
    }).catch(() => {});
  }
}
