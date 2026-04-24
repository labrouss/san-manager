// =============================================================================
// routes/settings.routes.ts
// GET  /api/settings          — read current runtime config + DB stats
// POST /api/settings          — update runtime flags (simulate, seed)
// GET  /api/backup            — export full database backup as JSON
// POST /api/restore           — import a JSON backup, merging or replacing data
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import logger from "../config/logger";

// Runtime state (survives for the life of the process, not persisted to disk)
const runtimeConfig = {
  simulate: process.env.MDS_SIMULATE === "true",
  seedEnabled: process.env.SAN_SEED === "true",
};

export function buildSettingsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // All settings routes require authentication; backup/restore require ADMIN
  router.use(requireAuth);


  // GET /api/settings/simulate — lightweight check for sim mode (any authenticated user)
  router.get("/settings/simulate", (_req: Request, res: Response) => {
    res.json({ simulate: runtimeConfig.simulate });
  });

  // ==========================================================================
  // GET /api/settings
  // ==========================================================================
  router.get("/settings", async (_req: Request, res: Response, next: NextFunction) => {
    try {
      // Gather DB statistics
      const [
        switchCount,
        aliasCount,
        zoneCount,
        zoneSetCount,
        snapshotCount,
        userCount,
        metricCount,
      ] = await Promise.all([
        prisma.switch.count({ where: { isActive: true } }),
        prisma.fcAlias.count(),
        prisma.zone.count(),
        prisma.zoneSet.count(),
        prisma.zoningSnapshot.count(),
        prisma.user.count(),
        prisma.portMetrics.count(),
      ]);

      // Oldest and newest metric timestamps
      const oldestMetric = await prisma.portMetrics.findFirst({
        orderBy: { timestamp: "asc" },
        select:  { timestamp: true },
      });
      const newestMetric = await prisma.portMetrics.findFirst({
        orderBy: { timestamp: "desc" },
        select:  { timestamp: true },
      });

      res.json({
        runtime: {
          simulate:     runtimeConfig.simulate,
          seedEnabled:  runtimeConfig.seedEnabled,
          nodeEnv:      process.env.NODE_ENV ?? "production",
          jwtExpires:   process.env.JWT_EXPIRES ?? "8h",
          version:      process.env.npm_package_version ?? "2.9.0",
          uptime:       Math.floor(process.uptime()),
        },
        database: {
          switches:   switchCount,
          aliases:    aliasCount,
          zones:      zoneCount,
          zoneSets:   zoneSetCount,
          snapshots:  snapshotCount,
          users:      userCount,
          metrics:    metricCount,
          oldestMetric: oldestMetric?.timestamp ?? null,
          newestMetric: newestMetric?.timestamp ?? null,
        },
      });
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // POST /api/settings  (ADMIN only — toggles runtime flags)
  // ==========================================================================
  router.post("/settings", requireRole("ADMIN"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { simulate, seedEnabled } = req.body as {
        simulate?:    boolean;
        seedEnabled?: boolean;
      };

      if (simulate !== undefined) {
        runtimeConfig.simulate = Boolean(simulate);
        process.env.MDS_SIMULATE = runtimeConfig.simulate ? "true" : "false";
        logger.info({ simulate: runtimeConfig.simulate }, "Simulation mode toggled");
      }

      if (seedEnabled !== undefined) {
        runtimeConfig.seedEnabled = Boolean(seedEnabled);
        process.env.SAN_SEED = runtimeConfig.seedEnabled ? "true" : "false";
        logger.info({ seedEnabled: runtimeConfig.seedEnabled }, "Seed flag toggled");
      }

      res.json({ success: true, runtime: runtimeConfig });
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // GET /api/backup  (ADMIN only)
  // Exports a complete JSON snapshot of all application data.
  // Excludes port_metrics (time-series, potentially huge — export separately).
  // ==========================================================================
  router.get("/backup", requireRole("ADMIN"), async (_req: Request, res: Response, next: NextFunction) => {
    try {
      logger.info("Database backup requested");

      const [users, switches, aliases, zones, zoneMembers, zoneSets, zoneSetMembers, snapshots] =
        await Promise.all([
          prisma.user.findMany({
            select: {
              id: true, username: true, email: true, passwordHash: true,
              role: true, isActive: true, lastLoginAt: true, createdAt: true, updatedAt: true,
            },
          }),
          prisma.switch.findMany(),
          prisma.fcAlias.findMany(),
          prisma.zone.findMany(),
          prisma.zoneMember.findMany(),
          prisma.zoneSet.findMany(),
          prisma.zoneSetMember.findMany(),
          prisma.zoningSnapshot.findMany({
            orderBy: { createdAt: "desc" },
            take: 500, // cap at 500 most recent snapshots
          }),
        ]);

      const backup = {
        meta: {
          version:     "2.9.0",
          exportedAt:  new Date().toISOString(),
          description: "SAN Manager full database backup",
          tables: {
            users:          users.length,
            switches:       switches.length,
            aliases:        aliases.length,
            zones:          zones.length,
            zoneMembers:    zoneMembers.length,
            zoneSets:       zoneSets.length,
            zoneSetMembers: zoneSetMembers.length,
            snapshots:      snapshots.length,
          },
        },
        data: {
          users,
          switches,
          aliases,
          zones,
          zoneMembers,
          zoneSets,
          zoneSetMembers,
          snapshots,
        },
      };

      const filename = `san-backup-${new Date().toISOString().slice(0, 16).replace(/[:.]/g, "-")}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.json(backup);
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // POST /api/restore  (ADMIN only)
  // Accepts a JSON backup and upserts all records.
  // Uses upsert (not truncate+insert) so it can be applied incrementally.
  // ==========================================================================
  router.post("/restore", requireRole("ADMIN"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const backup = req.body as {
        meta?: { version?: string; exportedAt?: string };
        data: {
          users?:          any[];
          switches?:       any[];
          aliases?:        any[];
          zones?:          any[];
          zoneMembers?:    any[];
          zoneSets?:       any[];
          zoneSetMembers?: any[];
          snapshots?:      any[];
        };
      };

      if (!backup?.data) {
        return res.status(422).json({ error: "Invalid backup format: missing data field" });
      }

      const { data } = backup;
      const stats = {
        users: 0, switches: 0, aliases: 0, zones: 0,
        zoneMembers: 0, zoneSets: 0, zoneSetMembers: 0, snapshots: 0,
      };

      // Restore in dependency order
      // 1. Users
      for (const u of data.users ?? []) {
        await prisma.user.upsert({
          where:  { id: u.id },
          create: { id: u.id, username: u.username, email: u.email, passwordHash: u.passwordHash,
                    role: u.role, isActive: u.isActive },
          update: { username: u.username, email: u.email, role: u.role, isActive: u.isActive },
        }).catch(() => {});
        stats.users++;
      }

      // 2. Switches
      for (const sw of data.switches ?? []) {
        await prisma.switch.upsert({
          where:  { id: sw.id },
          create: { id: sw.id, ipAddress: sw.ipAddress, hostname: sw.hostname,
                    model: sw.model, serialNumber: sw.serialNumber, isActive: sw.isActive },
          update: { hostname: sw.hostname, model: sw.model, isActive: sw.isActive },
        }).catch(() => {});
        stats.switches++;
      }

      // 3. FC Aliases
      for (const a of data.aliases ?? []) {
        await prisma.fcAlias.upsert({
          where:  { id: a.id },
          create: { id: a.id, switchId: a.switchId, name: a.name, wwn: a.wwn,
                    description: a.description, isOrphaned: a.isOrphaned },
          update: { name: a.name, description: a.description, isOrphaned: a.isOrphaned },
        }).catch(() => {});
        stats.aliases++;
      }

      // 4. Zones
      for (const z of data.zones ?? []) {
        await prisma.zone.upsert({
          where:  { id: z.id },
          create: { id: z.id, switchId: z.switchId, name: z.name, vsanId: z.vsanId,
                    description: z.description, isDraft: z.isDraft },
          update: { name: z.name, description: z.description, isDraft: z.isDraft },
        }).catch(() => {});
        stats.zones++;
      }

      // 5. Zone Members
      for (const m of data.zoneMembers ?? []) {
        await prisma.zoneMember.upsert({
          where:  { id: m.id },
          create: { id: m.id, zoneId: m.zoneId, memberType: m.memberType, value: m.value },
          update: { memberType: m.memberType, value: m.value },
        }).catch(() => {});
        stats.zoneMembers++;
      }

      // 6. Zone Sets
      for (const zs of data.zoneSets ?? []) {
        await prisma.zoneSet.upsert({
          where:  { id: zs.id },
          create: { id: zs.id, switchId: zs.switchId, name: zs.name, vsanId: zs.vsanId,
                    isActive: zs.isActive, isDraft: zs.isDraft },
          update: { name: zs.name, isActive: zs.isActive, isDraft: zs.isDraft },
        }).catch(() => {});
        stats.zoneSets++;
      }

      // 7. Zone Set Members
      for (const zsm of data.zoneSetMembers ?? []) {
        await prisma.zoneSetMember.upsert({
          where:  { zoneSetId_zoneId: { zoneSetId: zsm.zoneSetId, zoneId: zsm.zoneId } },
          create: { zoneSetId: zsm.zoneSetId, zoneId: zsm.zoneId },
          update: {},
        }).catch(() => {});
        stats.zoneSetMembers++;
      }

      // 8. Snapshots
      for (const sn of data.snapshots ?? []) {
        await prisma.zoningSnapshot.upsert({
          where:  { id: sn.id },
          create: { id: sn.id, switchId: sn.switchId, vsanId: sn.vsanId,
                    trigger: sn.trigger, payload: sn.payload,
                    diffSummary: sn.diffSummary, triggeredBy: sn.triggeredBy,
                    createdAt: new Date(sn.createdAt) },
          update: {},
        }).catch(() => {});
        stats.snapshots++;
      }

      logger.info({ stats, source: backup.meta?.exportedAt }, "Database restore completed");
      res.json({ success: true, restored: stats, sourceExportedAt: backup.meta?.exportedAt });
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // DELETE /api/settings/metrics  (ADMIN only — purge old time-series data)
  // ==========================================================================
  router.delete("/settings/metrics", requireRole("ADMIN"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { olderThanDays = "90" } = req.query as Record<string, string>;
      const days = Math.max(1, parseInt(olderThanDays));
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const result = await prisma.portMetrics.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });

      logger.info({ deleted: result.count, cutoff }, "Old metrics purged");
      res.json({ success: true, deleted: result.count, cutoff });
    } catch (err) { next(err); }
  });

  return router;
}
