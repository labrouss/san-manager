// =============================================================================
// routes/switches.routes.ts
// Switch CRUD (with hard delete + cascade) + metrics + interface list endpoints.
// Every data query is scoped to a specific switchId — no cross-switch leakage.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { buildClient, isSim } from "../services/clientFactory";
import logger from "../config/logger";

export function buildSwitchesRouter(prisma: PrismaClient): Router {
  const router = Router();

  // ==========================================================================
  // SWITCHES
  // ==========================================================================

  // GET /api/switches
  router.get("/switches", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const switches = await prisma.switch.findMany({
        where: { isActive: true },
        orderBy: { hostname: "asc" },
        include: {
          _count: {
            select: {
              fcAliases: true,
              zones: true,
              zoneSets: true,
              portMetrics: true,
            },
          },
        },
      });
      res.json(switches);
    } catch (err) { next(err); }
  });

  // POST /api/switches
  router.post("/switches", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ipAddress, hostname, model, serialNumber } = req.body as {
        ipAddress: string; hostname?: string; model?: string; serialNumber?: string;
      };
      if (!ipAddress) return res.status(422).json({ error: "ipAddress is required" });
      const sw = await prisma.switch.create({
        data: { ipAddress, hostname, model, serialNumber },
      });
      logger.info({ switchId: sw.id, ip: sw.ipAddress }, "Switch registered");
      res.status(201).json(sw);
    } catch (err) { next(err); }
  });

  // GET /api/switches/:id
  router.get("/switches/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sw = await prisma.switch.findUnique({
        where: { id: req.params.id },
        include: {
          _count: {
            select: {
              fcAliases: true,
              zones: true,
              zoneSets: true,
              zoningSnapshots: true,
              portMetrics: true,
            },
          },
        },
      });
      if (!sw) return res.status(404).json({ error: "Switch not found" });
      res.json(sw);
    } catch (err) { next(err); }
  });

  // PATCH /api/switches/:id
  router.patch("/switches/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { hostname, model, nxosVersion, isActive, displayName, notes } = req.body as {
        hostname?: string; model?: string; nxosVersion?: string;
        isActive?: boolean; displayName?: string; notes?: string;
      };
      const sw = await prisma.switch.update({
        where: { id: req.params.id },
        data: {
          ...(hostname    !== undefined && { hostname }),
          ...(model       !== undefined && { model }),
          ...(nxosVersion !== undefined && { nxosVersion }),
          ...(isActive    !== undefined && { isActive }),
          ...(displayName !== undefined && { displayName }),
          ...(notes       !== undefined && { notes }),
        },
      });
      res.json(sw);
    } catch (err) { next(err); }
  });

  // DELETE /api/switches/:id
  // Hard delete — Prisma cascade removes ALL associated data:
  //   fc_aliases, zones, zone_members, zone_sets, zone_set_members,
  //   zoning_snapshots, port_metrics
  router.delete("/switches/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sw = await prisma.switch.findUnique({ where: { id: req.params.id } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      // Hard delete — all child records cascade via FK constraints
      await prisma.switch.delete({ where: { id: req.params.id } });

      logger.info({ switchId: req.params.id, ip: sw.ipAddress }, "Switch and all associated data deleted");
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // INTERFACES  (synthesised from port_metrics distinct interface names)
  // Scoped strictly to the given switchId.
  // GET /api/switches/:id/interfaces?search=&status=
  // ==========================================================================

  router.get(
    "/switches/:id/interfaces",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { search, status } = req.query as Record<string, string>;

        // Verify switch exists
        const sw = await prisma.switch.findUnique({ where: { id: req.params.id } });
        if (!sw) return res.status(404).json({ error: "Switch not found" });

        let rows = await prisma.portMetrics.findMany({
          where: { switchId: req.params.id },
          distinct: ["interfaceName"],
          select: { interfaceName: true, rxPowerDbm: true, temperature: true, voltage: true, timestamp: true },
          orderBy: { interfaceName: "asc" },
        });

        // When no metrics yet (fresh switch or simulator without poll data),
        // fall back to a live query so the inventory shows data immediately
        if (rows.length === 0) {
          try {
            const client = buildClient(sw.id, sw.ipAddress);
            const out = await client.sendCommand<any>("show interface counters brief");
            const briefRows: any[] = out.body.TABLE_interface_brief?.ROW_interface_brief ?? [];
            const arr = Array.isArray(briefRows) ? briefRows : [briefRows];
            rows = arr
              .filter((r: any) => /^fc\d+\/\d+/i.test(r.interface))
              .map((r: any) => ({
                interfaceName: r.interface,
                rxPowerDbm:    null,
                temperature:   null,
                voltage:       null,
                timestamp:     new Date(),
              }));
          } catch { /* non-fatal — return empty list */ }
        }

        // Enrich with live interface data from show interface + show flogi database
        const ifaceMetaMap = new Map<string, { wwn?: string; state?: string; speed?: number; mode?: string; vsan?: number }>();
        // Map: interface → connected pWWN (from FLOGI database = devices logged into each port)
        const flogiWwnMap = new Map<string, string>();
        try {
          const client = buildClient(sw.id, sw.ipAddress);

          // show interface — port WWN (the switch port's own WWN), state, speed, mode, VSAN
          const ifaceOut = await client.sendCommand<any>("show interface");
          const ifaceRows: any[] = ifaceOut.body.TABLE_interface?.ROW_interface ?? [];
          const ifaceArr = Array.isArray(ifaceRows) ? ifaceRows : [ifaceRows];
          for (const r of ifaceArr) {
            if (/^fc\d+\/\d+/i.test(r.interface)) {
              ifaceMetaMap.set(r.interface, {
                wwn:   r.port_wwn?.trim() ?? undefined,
                state: r.state?.trim() ?? "up",
                speed: r.oper_speed ? parseInt(r.oper_speed) / 1000 : (r.speed ? parseInt(r.speed) / 1000 : 16),
                mode:  r.oper_mode?.trim() ?? r.port_mode?.trim() ?? "F",
                vsan:  r.vsan ? parseInt(r.vsan) : undefined,
              });
            }
          }

          // show flogi database — connected device pWWN per interface (what's logged in)
          const flogiOut = await client.sendCommand<any>("show flogi database");
          const flogiRows: any[] = flogiOut.body.TABLE_flogi_entry?.ROW_flogi_entry ?? [];
          const flogiArr = Array.isArray(flogiRows) ? flogiRows : [flogiRows];
          for (const r of flogiArr) {
            if (r.interface && r.port_name) {
              flogiWwnMap.set(r.interface.trim(), r.port_name.trim());
            }
          }
        } catch { /* non-fatal — use defaults */ }

        // Pull fc_aliases for WWN→alias mapping
        const aliases = await prisma.fcAlias.findMany({
          where:  { switchId: req.params.id },
          select: { wwn: true, name: true },
        });
        const aliasMap = new Map(aliases.map((a) => [a.wwn.toLowerCase(), a.name]));

        type IfaceStatus = "UP" | "DOWN" | "TRUNKING" | "ISOLATED" | "UNKNOWN";
        function normalizeState(s?: string): IfaceStatus {
          if (!s) return "UP";
          const l = s.toLowerCase();
          if (l === "up" || l === "trunking") return l === "trunking" ? "TRUNKING" : "UP";
          if (l === "down" || l === "sfpAbsent" || l.includes("down")) return "DOWN";
          if (l === "isolated") return "ISOLATED";
          return "UNKNOWN";
        }

        let ifaces = rows.map((r) => {
          const meta  = ifaceMetaMap.get(r.interfaceName) ?? {};
          const portWwn    = meta.wwn ?? null;           // switch port's own WWN
          const connWwn    = flogiWwnMap.get(r.interfaceName) ?? null;  // connected device pWWN
          const wwn        = connWwn;                   // show the connected device WWN
          const alias      = connWwn ? (aliasMap.get(connWwn.toLowerCase()) ?? null) : null;
          return {
            id:             `${req.params.id}::${r.interfaceName}`,
            switchId:       req.params.id,
            name:           r.interfaceName,
            wwn,
            alias,
            description:    null as string | null,
            status:         normalizeState(meta.state) as IfaceStatus,
            speed:          meta.speed ?? 16,
            vsanMembership: meta.vsan ? [meta.vsan] : [] as number[],
            portType:       (meta.mode === "E" ? "E_PORT" : meta.mode === "TE" ? "TE_PORT" : "F_PORT"),
            connectedWwn:   portWwn,   // the switch port's own WWN
            updatedAt:      r.timestamp.toISOString(),
          };
        });

        if (search) {
          const q = search.toLowerCase();
          ifaces = ifaces.filter((i) =>
            i.name.toLowerCase().includes(q) ||
            (i.alias ?? "").toLowerCase().includes(q) ||
            (i.wwn ?? "").toLowerCase().includes(q)
          );
        }
        if (status && status !== "ALL") {
          ifaces = ifaces.filter((i) => i.status === status);
        }

        res.json(ifaces);
      } catch (err) { next(err); }
    }
  );

  // PATCH /api/interfaces/:id/alias   (id = "switchId::interfaceName")
  router.patch("/interfaces/:id/alias", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { alias } = req.body as { alias: string };
      const [switchId, ...rest] = req.params.id.split("::");
      const interfaceName = rest.join("::");
      if (!switchId || !interfaceName) {
        return res.status(422).json({ error: "Invalid interface ID format" });
      }
      res.json({ id: req.params.id, alias: alias.trim(), updatedAt: new Date().toISOString() });
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // TIME-SERIES METRICS  — all scoped to switchId
  // GET /api/metrics?switchId=&interface=&window=24h
  // ==========================================================================

  router.get("/metrics", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        switchId,
        interface: interfaceName,
        window: windowParam = "24h",
      } = req.query as Record<string, string>;

      if (!switchId || !interfaceName) {
        return res.status(422).json({ error: "switchId and interface are required" });
      }

      // Verify switch exists (prevents cross-switch querying with a guessed ID)
      const sw = await prisma.switch.findUnique({ where: { id: switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const windowHours = parseInt(windowParam.replace("h", ""), 10) || 24;
      let bucketMinutes: number;
      if      (windowHours <= 1)  bucketMinutes = 1;
      else if (windowHours <= 6)  bucketMinutes = 5;
      else if (windowHours <= 24) bucketMinutes = 15;
      else                         bucketMinutes = 60;

      const rows = await prisma.$queryRaw<{
        bucket: Date;
        avg_tx_bps: number | null;
        avg_rx_bps: number | null;
        max_crc_errors: bigint;
        avg_rx_power_dbm: number | null;
      }[]>`
        SELECT
          time_bucket(${`${bucketMinutes} minutes`}::interval, timestamp) AS bucket,
          AVG(tx_rate_bps)   AS avg_tx_bps,
          AVG(rx_rate_bps)   AS avg_rx_bps,
          MAX(crc_errors)    AS max_crc_errors,
          AVG(rx_power_dbm)  AS avg_rx_power_dbm
        FROM port_metrics
        WHERE
          switch_id      = ${switchId}
          AND interface_name = ${interfaceName}
          AND timestamp  >= NOW() - ${`${windowHours} hours`}::interval
        GROUP BY bucket
        ORDER BY bucket ASC
      `;

      res.json(rows.map((r) => ({
        timestamp:  r.bucket.toISOString(),
        txMbps:     r.avg_tx_bps  != null ? r.avg_tx_bps  / 1e6 : null,
        rxMbps:     r.avg_rx_bps  != null ? r.avg_rx_bps  / 1e6 : null,
        crcErrors:  Number(r.max_crc_errors ?? 0),
        rxPowerDbm: r.avg_rx_power_dbm ?? null,
      })));
    } catch (err) { next(err); }
  });

  // GET /api/metrics/latest?switchId=&interface=
  router.get("/metrics/latest", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId, interface: interfaceName } = req.query as Record<string, string>;
      if (!switchId || !interfaceName) {
        return res.status(422).json({ error: "switchId and interface are required" });
      }
      const latest = await prisma.portMetrics.findFirst({
        where: { switchId, interfaceName },   // ← both required
        orderBy: { timestamp: "desc" },
      });
      res.json(latest ?? null);
    } catch (err) { next(err); }
  });

  // GET /api/metrics/interfaces?switchId=
  router.get("/metrics/interfaces", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId is required" });

      const rows = await prisma.portMetrics.findMany({
        where: { switchId },   // ← scoped
        distinct: ["interfaceName"],
        select: { interfaceName: true },
        orderBy: { interfaceName: "asc" },
      });
      res.json(rows.map((r) => r.interfaceName));
    } catch (err) { next(err); }
  });

  return router;
}
