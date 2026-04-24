// =============================================================================
// routes/zoning.routes.ts
// All zoning & alias CRUD + the critical POST /api/zoning/commit endpoint
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { MdsZoningService, isValidWwn } from "../services/MdsZoningService";
import { buildClient } from "../services/clientFactory";
import { CommitRequest } from "../types/zoning.types";
import logger from "../config/logger";

export function buildZoningRouter(prisma: PrismaClient): Router {
  const router = Router();
  const zoningService = new MdsZoningService(prisma);

  // ==========================================================================
  // FC ALIASES
  // ==========================================================================

  // GET /api/aliases?switchId=&orphanedOnly=
  router.get("/aliases", async (req, res, next) => {
    try {
      const { switchId, orphanedOnly } = req.query as Record<string, string>;
      const aliases = await prisma.fcAlias.findMany({
        where: {
          ...(switchId && { switchId }),
          ...(orphanedOnly === "true" && { isOrphaned: true }),
        },
        orderBy: { name: "asc" },
      });
      res.json(aliases);
    } catch (err) { next(err); }
  });

  // POST /api/aliases  — create and optionally push to switch
  router.post("/aliases", async (req, res, next) => {
    try {
      const { switchId, name, wwn, description, pushToSwitch = false } = req.body as {
        switchId: string;
        name: string;
        wwn: string;
        description?: string;
        pushToSwitch?: boolean;
      };

      if (!isValidWwn(wwn)) {
        return res.status(422).json({ error: `Invalid WWN format: ${wwn}. Expected xx:xx:xx:xx:xx:xx:xx:xx` });
      }

      const sw = await prisma.switch.findUniqueOrThrow({ where: { id: switchId } });

      if (pushToSwitch) {
        const client = buildClient(sw.id, sw.ipAddress);
        await zoningService.pushAlias(name.trim(), wwn.toLowerCase().trim(), client);
      }

      const alias = await prisma.fcAlias.create({
        data: {
          switchId,
          name: name.trim(),
          wwn: wwn.toLowerCase().trim(),
          description: description?.trim(),
          syncedAt: pushToSwitch ? new Date() : null,
        },
      });
      res.status(201).json(alias);
    } catch (err) { next(err); }
  });

  // PATCH /api/aliases/:id
  router.patch("/aliases/:id", async (req, res, next) => {
    try {
      const { name, description } = req.body as { name?: string; description?: string };
      const alias = await prisma.fcAlias.update({
        where: { id: req.params.id },
        data: {
          ...(name && { name: name.trim() }),
          ...(description !== undefined && { description: description.trim() }),
        },
      });
      res.json(alias);
    } catch (err) { next(err); }
  });

  // DELETE /api/aliases/:id
  router.delete("/aliases/:id", async (req, res, next) => {
    try {
      await prisma.fcAlias.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // POST /api/aliases/sync  — run the Alias Bridge against a switch
  router.post("/aliases/sync", async (req, res, next) => {
    try {
      const { switchId } = req.body as { switchId: string };
      const sw = await prisma.switch.findUniqueOrThrow({ where: { id: switchId } });
      const client = buildClient(sw.id, sw.ipAddress);
      const result = await zoningService.syncAliases(switchId, client, sw.ipAddress);
      res.json(result);
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // ZONES
  // ==========================================================================

  // GET /api/zones?switchId=&vsanId=&isDraft=
  router.get("/zones", async (req, res, next) => {
    try {
      const { switchId, vsanId, isDraft } = req.query as Record<string, string>;
      const zones = await prisma.zone.findMany({
        where: {
          ...(switchId && { switchId }),
          ...(vsanId && { vsanId: parseInt(vsanId) }),
          ...(isDraft !== undefined && { isDraft: isDraft === "true" }),
        },
        include: { members: true },
        orderBy: { name: "asc" },
      });
      res.json(zones);
    } catch (err) { next(err); }
  });

  // POST /api/zones
  router.post("/zones", async (req, res, next) => {
    try {
      const { switchId, name, vsanId, description, members = [] } = req.body as {
        switchId: string;
        name: string;
        vsanId: number;
        description?: string;
        members?: { memberType: string; value: string }[];
      };

      // Validate all PWWN members
      const wwnErrors = members
        .filter((m) => m.memberType === "PWWN" && !isValidWwn(m.value))
        .map((m) => `Invalid WWN: ${m.value}`);
      if (wwnErrors.length > 0) return res.status(422).json({ errors: wwnErrors });

      const zone = await prisma.zone.create({
        data: {
          switchId,
          name: name.trim(),
          vsanId: Number(vsanId),
          description: description?.trim(),
          isDraft: true,
          members: {
            create: members.map((m) => ({
              memberType: m.memberType as any,
              value: m.memberType === "PWWN"
                ? m.value.toLowerCase().trim()
                : m.value.trim(),
            })),
          },
        },
        include: { members: true },
      });
      res.status(201).json(zone);
    } catch (err) { next(err); }
  });

  // POST /api/zones/:id/members  — add a member to a zone
  router.post("/zones/:id/members", async (req, res, next) => {
    try {
      const { memberType = "PWWN", value } = req.body as { memberType?: string; value: string };

      if (memberType === "PWWN" && !isValidWwn(value)) {
        return res.status(422).json({ error: `Invalid WWN: ${value}` });
      }

      const member = await prisma.zoneMember.create({
        data: {
          zoneId: req.params.id,
          memberType: memberType as any,
          value: memberType === "PWWN" ? value.toLowerCase().trim() : value.trim(),
        },
      });
      // Mark zone as draft again whenever membership changes
      await prisma.zone.update({ where: { id: req.params.id }, data: { isDraft: true } });
      res.status(201).json(member);
    } catch (err) { next(err); }
  });

  // DELETE /api/zones/:zoneId/members/:memberId
  router.delete("/zones/:zoneId/members/:memberId", async (req, res, next) => {
    try {
      await prisma.zoneMember.delete({ where: { id: req.params.memberId } });
      await prisma.zone.update({ where: { id: req.params.zoneId }, data: { isDraft: true } });
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // DELETE /api/zones/:id
  router.delete("/zones/:id", async (req, res, next) => {
    try {
      await prisma.zone.delete({ where: { id: req.params.id } });
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // ZONE SETS
  // ==========================================================================

  // GET /api/zonesets?switchId=&vsanId=
  router.get("/zonesets", async (req, res, next) => {
    try {
      const { switchId, vsanId } = req.query as Record<string, string>;
      const zoneSets = await prisma.zoneSet.findMany({
        where: {
          ...(switchId && { switchId }),
          ...(vsanId && { vsanId: parseInt(vsanId) }),
        },
        include: {
          members: { include: { zone: { include: { members: true } } } },
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });
      res.json(zoneSets);
    } catch (err) { next(err); }
  });

  // POST /api/zonesets
  router.post("/zonesets", async (req, res, next) => {
    try {
      const { switchId, name, vsanId } = req.body as { switchId: string; name: string; vsanId: number };
      const zoneSet = await prisma.zoneSet.create({
        data: { switchId, name: name.trim(), vsanId: Number(vsanId), isDraft: true },
      });
      res.status(201).json(zoneSet);
    } catch (err) { next(err); }
  });

  // POST /api/zonesets/:id/zones  — add a zone to a zone set
  router.post("/zonesets/:id/zones", async (req, res, next) => {
    try {
      const { zoneId } = req.body as { zoneId: string };
      const member = await prisma.zoneSetMember.create({
        data: { zoneSetId: req.params.id, zoneId },
      });
      await prisma.zoneSet.update({ where: { id: req.params.id }, data: { isDraft: true } });
      res.status(201).json(member);
    } catch (err) { next(err); }
  });

  // DELETE /api/zonesets/:id/zones/:zoneId
  router.delete("/zonesets/:id/zones/:zoneId", async (req, res, next) => {
    try {
      await prisma.zoneSetMember.delete({
        where: { zoneSetId_zoneId: { zoneSetId: req.params.id, zoneId: req.params.zoneId } },
      });
      await prisma.zoneSet.update({ where: { id: req.params.id }, data: { isDraft: true } });
      res.status(204).send();
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // COMMIT & ACTIVATE  — the critical write endpoint
  // ==========================================================================

  // POST /api/zoning/commit
  router.post("/zoning/commit", async (req, res, next) => {
    try {
      const body = req.body as CommitRequest;
      const triggeredBy = (req as any).user?.email ?? "api";

      logger.info({ ...body, triggeredBy }, "Zoning commit requested");

      const sw = await prisma.switch.findUnique({ where: { id: body.switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const client = buildClient(sw.id, sw.ipAddress);
      const result = await zoningService.commitAndActivate(body, client, sw.ipAddress, triggeredBy);

      const status = result.success ? 200 : 422;
      res.status(status).json(result);
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // SNAPSHOTS
  // ==========================================================================

  // GET /api/snapshots?switchId=&vsanId=&limit=
  router.get("/snapshots", async (req, res, next) => {
    try {
      const { switchId, vsanId, limit = "20" } = req.query as Record<string, string>;
      const snapshots = await prisma.zoningSnapshot.findMany({
        where: {
          ...(switchId && { switchId }),
          ...(vsanId && { vsanId: parseInt(vsanId) }),
        },
        orderBy: { createdAt: "desc" },
        take: parseInt(limit),
        select: {
          id: true, switchId: true, vsanId: true,
          trigger: true, triggeredBy: true,
          diffSummary: true, createdAt: true,
        },
      });
      res.json(snapshots);
    } catch (err) { next(err); }
  });

  // GET /api/snapshots/:id  — full payload
  router.get("/snapshots/:id", async (req, res, next) => {
    try {
      const snap = await prisma.zoningSnapshot.findUniqueOrThrow({
        where: { id: req.params.id },
      });
      res.json(snap);
    } catch (err) { next(err); }
  });

  // POST /api/snapshots/capture  — manual snapshot
  router.post("/snapshots/capture", async (req, res, next) => {
    try {
      const { switchId, vsanId } = req.body as { switchId: string; vsanId: number };
      const sw = await prisma.switch.findUniqueOrThrow({ where: { id: switchId } });
      const client = buildClient(sw.id, sw.ipAddress);

      const payload = await zoningService.fetchLiveSnapshot(client, sw.ipAddress, vsanId);
      const snapshotId = await zoningService.saveSnapshot(
        switchId, vsanId, payload, "MANUAL"
      );
      res.status(201).json({ snapshotId });
    } catch (err) { next(err); }
  });

  // GET /api/snapshots/:id/diff  — compare with previous snapshot
  router.get("/snapshots/:id/diff", async (req, res, next) => {
    try {
      const snap = await prisma.zoningSnapshot.findUniqueOrThrow({ where: { id: req.params.id } });
      const prev = await prisma.zoningSnapshot.findFirst({
        where: {
          switchId: snap.switchId,
          vsanId: snap.vsanId,
          createdAt: { lt: snap.createdAt },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!prev) return res.json({ message: "No previous snapshot to diff against" });

      const { diffZoningSnapshots } = await import("../services/MdsZoningService");
      const diff = diffZoningSnapshots(
        prev.payload as any,
        snap.payload as any
      );
      res.json(diff);
    } catch (err) { next(err); }
  });


  // POST /api/snapshots/:id/restore
  // Restore a snapshot to the local DB as a new draft (does NOT push to switch).
  // The user can review the restored zones/aliases then decide to commit or discard.
  router.post("/snapshots/:id/restore", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const snap = await prisma.zoningSnapshot.findUniqueOrThrow({ where: { id: req.params.id } });
      const payload = snap.payload as any;

      const results = { aliasesRestored: 0, zonesRestored: 0, zoneSetsRestored: 0 };

      // Restore aliases as draft entries
      if (payload.deviceAliases?.length) {
        for (const alias of payload.deviceAliases) {
          await prisma.fcAlias.upsert({
            where:  { switchId_wwn: { switchId: snap.switchId, wwn: alias.wwn } },
            create: { switchId: snap.switchId, name: alias.name, wwn: alias.wwn, isOrphaned: false },
            update: { name: alias.name, isOrphaned: false },
          }).catch(() => {});
          results.aliasesRestored++;
        }
      }

      // Restore zones and zone sets as drafts
      for (const zoneSet of (payload.zoneSets ?? [])) {
        for (const zone of (zoneSet.zones ?? [])) {
          const existingZone = await prisma.zone.findFirst({
            where: { switchId: snap.switchId, name: zone.name, vsanId: snap.vsanId },
          });

          if (existingZone) {
            // Delete existing members and replace
            await prisma.zoneMember.deleteMany({ where: { zoneId: existingZone.id } });
            await prisma.zoneMember.createMany({
              data: (zone.members ?? []).map((m: any) => ({
                zoneId:     existingZone.id,
                memberType: m.type === "device_alias" ? "DEVICE_ALIAS" : m.type === "fcid" ? "FCID" : "PWWN",
                value:      m.value,
              })),
              skipDuplicates: true,
            });
            await prisma.zone.update({ where: { id: existingZone.id }, data: { isDraft: true } });
          } else {
            await prisma.zone.create({
              data: {
                switchId: snap.switchId,
                name:     zone.name,
                vsanId:   snap.vsanId,
                isDraft:  true,
                members: {
                  create: (zone.members ?? []).map((m: any) => ({
                    memberType: m.type === "device_alias" ? "DEVICE_ALIAS" : m.type === "fcid" ? "FCID" : "PWWN",
                    value:      m.value,
                  })),
                },
              },
            });
          }
          results.zonesRestored++;
        }

        // Restore zone set
        const zoneNames = (zoneSet.zones ?? []).map((z: any) => z.name);
        const zoneDbs   = await prisma.zone.findMany({
          where: { switchId: snap.switchId, vsanId: snap.vsanId, name: { in: zoneNames } },
          select: { id: true },
        });

        const existingZS = await prisma.zoneSet.findFirst({
          where: { switchId: snap.switchId, name: zoneSet.name, vsanId: snap.vsanId },
        });

        if (existingZS) {
          await prisma.zoneSetMember.deleteMany({ where: { zoneSetId: existingZS.id } });
          await prisma.zoneSetMember.createMany({
            data: zoneDbs.map(z => ({ zoneSetId: existingZS.id, zoneId: z.id })),
            skipDuplicates: true,
          });
          await prisma.zoneSet.update({ where: { id: existingZS.id }, data: { isDraft: true } });
        } else {
          const newZS = await prisma.zoneSet.create({
            data: { switchId: snap.switchId, name: zoneSet.name, vsanId: snap.vsanId, isDraft: true, isActive: false },
          });
          await prisma.zoneSetMember.createMany({
            data: zoneDbs.map(z => ({ zoneSetId: newZS.id, zoneId: z.id })),
            skipDuplicates: true,
          });
        }
        results.zoneSetsRestored++;
      }

      logger.info({ snapshotId: snap.id, ...results }, "Snapshot restored to draft");
      res.json({ success: true, snapshotId: snap.id, ...results });
    } catch (err) { next(err); }
  });


  // POST /api/zoning/sync
  // Pull the live zoneset + device-alias database from the switch and import
  // them into the local DB as draft records. This is the "sync from switch" button.
  router.post("/zoning/sync", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId, vsanId = 100 } = req.body as { switchId: string; vsanId?: number };
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      const sw = await prisma.switch.findUnique({ where: { id: switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const client = buildClient(switchId, sw.ipAddress);
      const stats = { zonesImported: 0, zoneSetsImported: 0, aliasesImported: 0 };

      // ── 1. Pull device-alias database ───────────────────────────────────────
      try {
        const aliasOut = await client.sendCommand<any>("show device-alias database");
        const rows = aliasOut.body.TABLE_device_alias_database?.ROW_device_alias_database ?? [];
        const aliasRows = Array.isArray(rows) ? rows : [rows];

        for (const row of aliasRows) {
          const name = row.dev_alias_name?.trim();
          const wwn  = row.pwwn?.trim();
          if (!name || !wwn) continue;

          await prisma.fcAlias.upsert({
            where:  { switchId_wwn: { switchId, wwn } },
            create: { switchId, name, wwn, isOrphaned: false },
            update: { name, isOrphaned: false },
          }).catch(() => {});
          stats.aliasesImported++;
        }
      } catch (err) {
        logger.warn({ err }, "device-alias sync skipped");
      }

      // ── 2. Pull zoneset for this VSAN ────────────────────────────────────────
      try {
        const zsOut = await client.sendCommand<any>(`show zoneset vsan ${vsanId}`);
        const zsBody = zsOut.body;
        const zsRows = zsBody.TABLE_zoneset?.ROW_zoneset;
        const zoneSetList = Array.isArray(zsRows) ? zsRows : (zsRows ? [zsRows] : []);

        for (const zs of zoneSetList) {
          const zsName   = zs.zoneset_name?.trim();
          const zsVsan   = parseInt(zs.zoneset_vsan ?? String(vsanId));
          const isActive = zs.zoneset_active === "true";

          if (!zsName) continue;

          // Upsert zone set
          const zoneSetRec = await prisma.zoneSet.upsert({
            where:  { switchId_name_vsanId: { switchId, name: zsName, vsanId: zsVsan } },
            create: { switchId, name: zsName, vsanId: zsVsan, isActive, isDraft: false },
            update: { isActive, isDraft: false },
          });
          stats.zoneSetsImported++;

          const zoneRows = zs.TABLE_zone?.ROW_zone;
          const zoneList = Array.isArray(zoneRows) ? zoneRows : (zoneRows ? [zoneRows] : []);

          for (const z of zoneList) {
            const zoneName = z.zone_name?.trim();
            if (!zoneName) continue;

            // Upsert zone
            const zoneRec = await prisma.zone.upsert({
              where:  { switchId_name_vsanId: { switchId, name: zoneName, vsanId: zsVsan } },
              create: { switchId, name: zoneName, vsanId: zsVsan, isDraft: false },
              update: { isDraft: false },
            });
            stats.zonesImported++;

            // Clear and re-import members
            await prisma.zoneMember.deleteMany({ where: { zoneId: zoneRec.id } });

            const memberRows = z.TABLE_zone_member?.ROW_zone_member;
            const memberList = Array.isArray(memberRows) ? memberRows : (memberRows ? [memberRows] : []);

            for (const m of memberList) {
              const pwwn  = m.wwn?.trim();
              const alias = m.device_alias?.trim();
              if (pwwn) {
                await prisma.zoneMember.create({
                  data: { zoneId: zoneRec.id, memberType: "PWWN", value: pwwn },
                }).catch(() => {});
              } else if (alias) {
                await prisma.zoneMember.create({
                  data: { zoneId: zoneRec.id, memberType: "DEVICE_ALIAS", value: alias },
                }).catch(() => {});
              }
            }

            // Link zone to zone set
            await prisma.zoneSetMember.upsert({
              where:  { zoneSetId_zoneId: { zoneSetId: zoneSetRec.id, zoneId: zoneRec.id } },
              create: { zoneSetId: zoneSetRec.id, zoneId: zoneRec.id },
              update: {},
            }).catch(() => {});
          }
        }
      } catch (err) {
        logger.warn({ err }, "zoneset sync failed");
        return res.status(502).json({ error: "Failed to read zone database from switch", detail: String(err) });
      }

      logger.info({ switchId, vsanId, ...stats }, "Zones synced from switch");
      res.json({ success: true, ...stats });
    } catch (err) { next(err); }
  });

  return router;
}
