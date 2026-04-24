// =============================================================================
// services/MdsZoningService.ts
// Core zoning service: diff engine, pre-commit snapshot, NX-API write sequence,
// zoneset activate, alias sync (the "Alias Bridge").
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { MdsClient } from "./MdsClient";
import type { AnyMdsClient } from "./clientFactory";
import {
  ShowZoneSetBody,
  ShowDeviceAliasBody,
  ZoneSetRow,
  ZoneRow,
  ZoneMemberRow,
  DeviceAliasRow,
  ParsedDeviceAlias,
  ParsedZone,
  ParsedZoneMember,
  ParsedZoneSet,
  ZoningDatabaseSnapshot,
  ZoningDiff,
  CommitRequest,
  CommitResult,
  AliasSyncResult,
} from "../types/zoning.types";
import logger from "../config/logger";

// ---------------------------------------------------------------------------
// WWN validation regex  (format: XX:XX:XX:XX:XX:XX:XX:XX)
// ---------------------------------------------------------------------------
const WWN_REGEX = /^([0-9a-f]{2}:){7}[0-9a-f]{2}$/i;
export function isValidWwn(wwn: string): boolean {
  return WWN_REGEX.test(wwn.trim());
}

// ---------------------------------------------------------------------------
// Helper: normalise single-or-array NX-OS responses
// ---------------------------------------------------------------------------
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// =============================================================================
// Parsing functions (exported for unit tests)
// =============================================================================

export function parseDeviceAliases(body: ShowDeviceAliasBody): ParsedDeviceAlias[] {
  const rows = toArray(body.TABLE_device_alias_database?.ROW_device_alias_database);
  return rows.map((r: DeviceAliasRow) => ({
    name: r.dev_alias_name.trim(),
    wwn: r.pwwn.trim().toLowerCase(),
  }));
}

export function parseZoneSets(body: ShowZoneSetBody): ParsedZoneSet[] {
  const rows = toArray(body.TABLE_zoneset?.ROW_zoneset);
  return rows.map((zs: ZoneSetRow): ParsedZoneSet => {
    const zones = toArray(zs.TABLE_zone?.ROW_zone).map((z: ZoneRow): ParsedZone => {
      const members = toArray(z.TABLE_zone_member?.ROW_zone_member)
        .map((m: ZoneMemberRow): ParsedZoneMember => {
          if (m.device_alias) return { type: "device_alias", value: m.device_alias.trim() };
          if (m.fcid)         return { type: "fcid",         value: m.fcid.trim() };
          return { type: "pwwn", value: (m.wwn ?? "").trim().toLowerCase() };
        })
        .filter((m) => m.value !== "");
      return { name: z.zone_name.trim(), members };
    });

    return {
      name: zs.zoneset_name.trim(),
      vsanId: parseInt(zs.zoneset_vsan, 10),
      isActive: zs.zoneset_active?.toLowerCase() === "true",
      zones,
    };
  });
}

// =============================================================================
// Diff engine
// =============================================================================

export function diffZoningSnapshots(
  before: ZoningDatabaseSnapshot,
  after: ZoningDatabaseSnapshot
): ZoningDiff {
  // --- Alias diff ---
  const beforeAliasMap = new Map(before.deviceAliases.map((a) => [a.wwn, a]));
  const afterAliasMap  = new Map(after.deviceAliases.map((a)  => [a.wwn, a]));

  const aliasesAdded    = after.deviceAliases.filter((a) => !beforeAliasMap.has(a.wwn));
  const aliasesRemoved  = before.deviceAliases.filter((a) => !afterAliasMap.has(a.wwn));
  const aliasesModified: ZoningDiff["aliases"]["modified"] = [];

  for (const [wwn, afterAlias] of afterAliasMap) {
    const beforeAlias = beforeAliasMap.get(wwn);
    if (beforeAlias && beforeAlias.name !== afterAlias.name) {
      aliasesModified.push({ before: beforeAlias, after: afterAlias });
    }
  }

  // --- Zone diff ---
  const beforeZoneMap = new Map<string, ParsedZone>();
  const afterZoneMap  = new Map<string, ParsedZone>();

  for (const zs of before.zoneSets) zs.zones.forEach((z) => beforeZoneMap.set(z.name, z));
  for (const zs of after.zoneSets)  zs.zones.forEach((z) => afterZoneMap.set(z.name, z));

  const zonesAdded   = [...afterZoneMap.values()].filter((z) => !beforeZoneMap.has(z.name));
  const zonesRemoved = [...beforeZoneMap.keys()].filter((n)  => !afterZoneMap.has(n));

  const membersAdded:   ZoningDiff["zones"]["membersAdded"]   = [];
  const membersRemoved: ZoningDiff["zones"]["membersRemoved"] = [];

  for (const [zoneName, afterZone] of afterZoneMap) {
    const beforeZone = beforeZoneMap.get(zoneName);
    if (!beforeZone) continue;

    const beforeVals = new Set(beforeZone.members.map((m) => m.value));
    const afterVals  = new Set(afterZone.members.map((m)  => m.value));

    for (const m of afterZone.members)  if (!beforeVals.has(m.value)) membersAdded.push({ zoneName, member: m });
    for (const m of beforeZone.members) if (!afterVals.has(m.value))  membersRemoved.push({ zoneName, member: m });
  }

  // --- ZoneSet activation diff ---
  const activationChanged = before.activeZoneSetName !== after.activeZoneSetName;

  return {
    aliases:  { added: aliasesAdded, removed: aliasesRemoved, modified: aliasesModified },
    zones:    { added: zonesAdded, removed: zonesRemoved, membersAdded, membersRemoved },
    zoneSets: { activationChanged, before: before.activeZoneSetName, after: after.activeZoneSetName },
  };
}

// =============================================================================
// MdsZoningService
// =============================================================================

export class MdsZoningService {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------------------------------------------------------------------------
  // Fetch + build a live snapshot from the switch
  // ---------------------------------------------------------------------------
  async fetchLiveSnapshot(
    client: AnyMdsClient,
    switchIp: string,
    vsanId: number
  ): Promise<ZoningDatabaseSnapshot> {
    const [zoneSetOutput, aliasOutput] = await Promise.all([
      client.sendCommand<ShowZoneSetBody>(`show zoneset vsan ${vsanId}`),
      client.sendCommand<ShowDeviceAliasBody>("show device-alias database"),
    ]);

    const zoneSets     = parseZoneSets(zoneSetOutput.body);
    const deviceAliases = parseDeviceAliases(aliasOutput.body);
    const active = zoneSets.find((zs) => zs.isActive)?.name ?? null;

    return {
      capturedAt: new Date().toISOString(),
      switchIp,
      vsanId,
      deviceAliases,
      zoneSets,
      activeZoneSetName: active,
    };
  }

  // ---------------------------------------------------------------------------
  // Persist a snapshot to Postgres
  // ---------------------------------------------------------------------------
  async saveSnapshot(
    switchId: string,
    vsanId: number,
    payload: ZoningDatabaseSnapshot,
    trigger: "PRE_COMMIT" | "MANUAL" | "SCHEDULED" = "MANUAL",
    triggeredBy?: string
  ): Promise<string> {
    // Compute diff against the most recent previous snapshot for the same vsan
    const prev = await this.prisma.zoningSnapshot.findFirst({
      where: { switchId, vsanId },
      orderBy: { createdAt: "desc" },
    });

    let diffSummary: unknown = null;
    if (prev) {
      try {
        const prevPayload = prev.payload as unknown as ZoningDatabaseSnapshot;
        diffSummary = diffZoningSnapshots(prevPayload, payload);
      } catch (e) {
        logger.warn({ e }, "Could not compute zoning diff");
      }
    }

    const snapshot = await this.prisma.zoningSnapshot.create({
      data: {
        switchId,
        vsanId,
        trigger,
        payload: payload as any,
        diffSummary: diffSummary as any,
        triggeredBy: triggeredBy ?? null,
      },
    });

    logger.info({ snapshotId: snapshot.id, trigger, vsanId }, "Zoning snapshot saved");
    return snapshot.id;
  }

  // ---------------------------------------------------------------------------
  // Pre-flight validation
  // Returns array of error strings (empty = all clear)
  // ---------------------------------------------------------------------------
  async preFlightCheck(request: CommitRequest): Promise<string[]> {
    const errors: string[] = [];

    const zoneSet = await this.prisma.zoneSet.findUnique({
      where: { id: request.zoneSetId },
      include: {
        members: {
          include: {
            zone: {
              include: { members: true },
            },
          },
        },
      },
    });

    if (!zoneSet) {
      errors.push(`ZoneSet ${request.zoneSetId} not found`);
      return errors;
    }

    if (zoneSet.switchId !== request.switchId) {
      errors.push("ZoneSet does not belong to the specified switch");
    }

    if (zoneSet.vsanId !== request.vsanId) {
      errors.push(`ZoneSet is for VSAN ${zoneSet.vsanId}, but commit targets VSAN ${request.vsanId}`);
    }

    if (zoneSet.members.length === 0) {
      errors.push("ZoneSet has no zones — add at least one zone before activating");
    }

    // Validate all PWWN members have correct format
    for (const zsm of zoneSet.members) {
      for (const member of zsm.zone.members) {
        if (member.memberType === "PWWN" && !isValidWwn(member.value)) {
          errors.push(
            `Invalid WWN "${member.value}" in zone "${zsm.zone.name}". Expected format: xx:xx:xx:xx:xx:xx:xx:xx`
          );
        }
      }
      if (zsm.zone.members.length === 0) {
        errors.push(`Zone "${zsm.zone.name}" has no members — empty zones cannot be activated`);
      }
    }

    // Check for duplicate zone names across the zone set
    const zoneNames = zoneSet.members.map((m) => m.zone.name);
    const dupes = zoneNames.filter((n, i) => zoneNames.indexOf(n) !== i);
    if (dupes.length > 0) {
      errors.push(`Duplicate zone names in zone set: ${[...new Set(dupes)].join(", ")}`);
    }

    return errors;
  }

  // ---------------------------------------------------------------------------
  // Commit & Activate  — the main write flow
  // ---------------------------------------------------------------------------
  async commitAndActivate(
    request: CommitRequest,
    client: AnyMdsClient,
    switchIp: string,
    triggeredBy?: string
  ): Promise<CommitResult> {
    const commandsExecuted: string[] = [];

    // 1. Pre-flight
    const errors = await this.preFlightCheck(request);
    if (errors.length > 0) {
      return { success: false, snapshotId: "", activatedZoneSet: "", commandsExecuted, errors };
    }

    // 2. AUTO-SNAPSHOT — capture switch state BEFORE any write
    logger.info({ switchId: request.switchId }, "Taking pre-commit zoning snapshot");
    const liveSnapshot = await this.fetchLiveSnapshot(client, switchIp, request.vsanId);
    const snapshotId = await this.saveSnapshot(
      request.switchId,
      request.vsanId,
      liveSnapshot,
      "PRE_COMMIT",
      triggeredBy
    );

    // 3. Load the full zone set from DB
    const zoneSet = await this.prisma.zoneSet.findUniqueOrThrow({
      where: { id: request.zoneSetId },
      include: {
        members: {
          include: {
            zone: { include: { members: true } },
          },
        },
      },
    });

    try {
      // 4. Build and send NX-API commands in sequence
      //    NX-OS requires these in a specific order inside a single config session

      const cfgCommands: string[] = [`conf t`];

      // 4a. Write each Zone and its members
      for (const zsm of zoneSet.members) {
        const zone = zsm.zone;
        cfgCommands.push(`zone name ${zone.name} vsan ${request.vsanId}`);
        for (const member of zone.members) {
          if (member.memberType === "DEVICE_ALIAS") {
            cfgCommands.push(`  member device-alias ${member.value}`);
          } else if (member.memberType === "FCID") {
            cfgCommands.push(`  member fcid ${member.value}`);
          } else {
            cfgCommands.push(`  member pwwn ${member.value}`);
          }
        }
      }

      // 4b. Write the ZoneSet and link all zones
      cfgCommands.push(`zoneset name ${zoneSet.name} vsan ${request.vsanId}`);
      for (const zsm of zoneSet.members) {
        cfgCommands.push(`  member ${zsm.zone.name}`);
      }

      // 4c. Activate
      cfgCommands.push(`zoneset activate name ${zoneSet.name} vsan ${request.vsanId}`);

      // Send all commands to the switch (batch mode via semicolons)
      // NX-API config mode uses cli_conf type
      await client.sendConfigBatch(cfgCommands);
      commandsExecuted.push(...cfgCommands);

      logger.info(
        { zoneSet: zoneSet.name, vsan: request.vsanId, cmds: cfgCommands.length },
        "Zone commit commands sent successfully"
      );

      // 5. Update local DB to reflect active state
      await this.prisma.$transaction([
        // Clear any existing active zone set for this vsan
        this.prisma.zoneSet.updateMany({
          where: { switchId: request.switchId, vsanId: request.vsanId, isActive: true },
          data: { isActive: false },
        }),
        // Mark this zone set as active and no longer draft
        this.prisma.zoneSet.update({
          where: { id: request.zoneSetId },
          data: {
            isActive: true,
            isDraft: false,
            activatedAt: new Date(),
            syncedAt: new Date(),
          },
        }),
        // Mark all zones in this set as no longer draft
        ...zoneSet.members.map((zsm) =>
          this.prisma.zone.update({
            where: { id: zsm.zoneId },
            data: { isDraft: false, syncedAt: new Date() },
          })
        ),
      ]);

      return {
        success: true,
        snapshotId,
        activatedZoneSet: zoneSet.name,
        commandsExecuted,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, snapshotId }, "Zone commit failed — switch state may be partial");
      return {
        success: false,
        snapshotId,
        activatedZoneSet: zoneSet.name,
        commandsExecuted,
        errors: [`NX-API write failed: ${msg}. Pre-commit snapshot saved as ID ${snapshotId}.`],
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Push a single device-alias to the switch ("Alias Bridge")
  // ---------------------------------------------------------------------------
  async pushAlias(
    aliasName: string,
    wwn: string,
    client: AnyMdsClient
  ): Promise<void> {
    if (!isValidWwn(wwn)) throw new Error(`Invalid WWN format: ${wwn}`);
    await client.sendConfigBatch([
      "conf t",
      "device-alias database",
      `  device-alias name ${aliasName} pwwn ${wwn}`,
      "device-alias commit",
    ]);
    logger.info({ aliasName, wwn }, "Device alias pushed to switch");
  }

  // ---------------------------------------------------------------------------
  // Alias Sync — reconcile switch aliases with local DB
  // Detects: (a) aliases on switch but not in DB (new devices to name)
  //          (b) aliases in DB but not on switch (orphaned records)
  // ---------------------------------------------------------------------------
  async syncAliases(
    switchId: string,
    client: AnyMdsClient,
    switchIp: string
  ): Promise<AliasSyncResult> {
    const aliasOutput = await client.sendCommand<ShowDeviceAliasBody>(
      "show device-alias database"
    );
    const switchAliases = parseDeviceAliases(aliasOutput.body);
    const switchWwnSet  = new Set(switchAliases.map((a) => a.wwn));

    const dbAliases = await this.prisma.fcAlias.findMany({ where: { switchId } });
    const dbWwnSet  = new Set(dbAliases.map((a) => a.wwn));

    // New on switch but not in DB
    const newOnSwitch = switchAliases.filter((a) => !dbWwnSet.has(a.wwn));
    // In DB but missing from switch
    const orphanedInDb = dbAliases
      .filter((a) => !switchWwnSet.has(a.wwn))
      .map((a) => ({ name: a.name, wwn: a.wwn }));

    // Upsert all switch aliases into DB  (sync direction: switch → DB)
    let synced = 0;
    for (const alias of switchAliases) {
      await this.prisma.fcAlias.upsert({
        where: { switchId_wwn: { switchId, wwn: alias.wwn } },
        create: { switchId, name: alias.name, wwn: alias.wwn, syncedAt: new Date() },
        update: { name: alias.name, syncedAt: new Date(), isOrphaned: false },
      });
      synced++;
    }

    // Mark orphaned records in DB
    if (orphanedInDb.length > 0) {
      await this.prisma.fcAlias.updateMany({
        where: { switchId, wwn: { in: orphanedInDb.map((a) => a.wwn) } },
        data: { isOrphaned: true },
      });
    }

    logger.info({ switchId, synced, newOnSwitch: newOnSwitch.length }, "Alias sync complete");

    return {
      switchId,
      switchIp,
      newAliasesOnSwitch: newOnSwitch,
      orphanedAliasesInDb: orphanedInDb,
      synced,
    };
  }
}
