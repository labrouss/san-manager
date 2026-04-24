// =============================================================================
// tests/commit-flow.test.ts
// Integration tests for the zoning commit pipeline.
// Uses a real in-memory PrismaClient mocked via vi.mock — no live DB required.
// Run with:  npx vitest run tests/commit-flow.test.ts
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MdsZoningService,
  diffZoningSnapshots,
  isValidWwn,
} from "../src/services/MdsZoningService";
import type { CommitRequest, ZoningDatabaseSnapshot } from "../src/types/zoning.types";

// ---------------------------------------------------------------------------
// Minimal Prisma mock — only the methods used by MdsZoningService
// ---------------------------------------------------------------------------
function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    zoningSnapshot: {
      findFirst:  vi.fn().mockResolvedValue(null),
      create:     vi.fn().mockResolvedValue({ id: "snap-001" }),
    },
    zoneSet: {
      findUnique:       vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany:       vi.fn().mockResolvedValue({ count: 0 }),
      update:           vi.fn().mockResolvedValue({}),
    },
    zone: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Minimal MdsClient mock
// ---------------------------------------------------------------------------
function makeMdsClientMock(overrides: Partial<{
  sendCommand: ReturnType<typeof vi.fn>;
  sendConfigBatch: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    sendCommand:     vi.fn().mockResolvedValue({ body: { TABLE_zoneset: { ROW_zoneset: [] }, TABLE_device_alias_database: { ROW_device_alias_database: [] } }, code: "200", input: "", msg: "Success" }),
    sendConfigBatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

// Shared zone set fixture used across tests
const ZONE_SET_FIXTURE = {
  id:       "zs-001",
  switchId: "sw-001",
  name:     "Production_ZoneSet",
  vsanId:   100,
  isActive: false,
  isDraft:  true,
  members: [
    {
      zoneId: "z-001",
      zone: {
        id:      "z-001",
        name:    "Zone_DB_to_Storage",
        members: [
          { id: "m-001", memberType: "PWWN",         value: "21:00:00:24:ff:8a:1b:2c" },
          { id: "m-002", memberType: "DEVICE_ALIAS", value: "Storage_Array_A_P1" },
        ],
      },
    },
    {
      zoneId: "z-002",
      zone: {
        id:      "z-002",
        name:    "Zone_App_to_Storage",
        members: [
          { id: "m-003", memberType: "PWWN", value: "21:00:00:24:ff:9b:2c:3d" },
        ],
      },
    },
  ],
};

// =============================================================================
describe("MdsZoningService.preFlightCheck", () => {
  it("passes when zone set is valid", async () => {
    const prisma = makePrismaMock({
      zoneSet: {
        findUnique: vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({}),
      },
    });
    const service = new MdsZoningService(prisma);
    const req: CommitRequest = { switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" };
    const errors = await service.preFlightCheck(req);
    expect(errors).toHaveLength(0);
  });

  it("fails when zone set belongs to wrong switch", async () => {
    const fixture = { ...ZONE_SET_FIXTURE, switchId: "sw-DIFFERENT" };
    const prisma = makePrismaMock({
      zoneSet: { findUnique: vi.fn().mockResolvedValue(fixture), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    });
    const service = new MdsZoningService(prisma);
    const errors = await service.preFlightCheck({ switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" });
    expect(errors.some((e) => e.includes("does not belong"))).toBe(true);
  });

  it("fails when zone set targets wrong VSAN", async () => {
    const fixture = { ...ZONE_SET_FIXTURE, vsanId: 200 };
    const prisma = makePrismaMock({
      zoneSet: { findUnique: vi.fn().mockResolvedValue(fixture), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    });
    const service = new MdsZoningService(prisma);
    const errors = await service.preFlightCheck({ switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" });
    expect(errors.some((e) => e.includes("VSAN 200"))).toBe(true);
  });

  it("fails when zone set has no zones", async () => {
    const fixture = { ...ZONE_SET_FIXTURE, members: [] };
    const prisma = makePrismaMock({
      zoneSet: { findUnique: vi.fn().mockResolvedValue(fixture), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    });
    const service = new MdsZoningService(prisma);
    const errors = await service.preFlightCheck({ switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" });
    expect(errors.some((e) => e.includes("no zones"))).toBe(true);
  });

  it("fails when a zone member has invalid WWN", async () => {
    const fixture = {
      ...ZONE_SET_FIXTURE,
      members: [{
        zoneId: "z-bad",
        zone: {
          id: "z-bad",
          name: "Zone_Bad",
          members: [{ id: "m-bad", memberType: "PWWN", value: "NOT_A_WWN" }],
        },
      }],
    };
    const prisma = makePrismaMock({
      zoneSet: { findUnique: vi.fn().mockResolvedValue(fixture), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    });
    const service = new MdsZoningService(prisma);
    const errors = await service.preFlightCheck({ switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" });
    expect(errors.some((e) => e.includes("Invalid WWN"))).toBe(true);
  });

  it("fails when a zone has no members", async () => {
    const fixture = {
      ...ZONE_SET_FIXTURE,
      members: [{
        zoneId: "z-empty",
        zone: { id: "z-empty", name: "Zone_Empty", members: [] },
      }],
    };
    const prisma = makePrismaMock({
      zoneSet: { findUnique: vi.fn().mockResolvedValue(fixture), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    });
    const service = new MdsZoningService(prisma);
    const errors = await service.preFlightCheck({ switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" });
    expect(errors.some((e) => e.includes("no members"))).toBe(true);
  });
});

// =============================================================================
describe("MdsZoningService.commitAndActivate", () => {
  it("takes a snapshot before writing and returns success", async () => {
    const snapshotCreate = vi.fn().mockResolvedValue({ id: "snap-abc" });
    const configBatch    = vi.fn().mockResolvedValue(undefined);

    const prisma = makePrismaMock({
      zoningSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    snapshotCreate,
      },
      zoneSet: {
        findUnique:        vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        findUniqueOrThrow: vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        updateMany:        vi.fn().mockResolvedValue({ count: 1 }),
        update:            vi.fn().mockResolvedValue({ ...ZONE_SET_FIXTURE, isActive: true, isDraft: false }),
      },
    });

    const client  = makeMdsClientMock({ sendConfigBatch: configBatch });
    const service = new MdsZoningService(prisma);

    const result = await service.commitAndActivate(
      { switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" },
      client,
      "192.168.1.100",
      "test-user"
    );

    expect(result.success).toBe(true);
    expect(snapshotCreate).toHaveBeenCalledTimes(1);    // auto-snapshot fired
    expect(configBatch).toHaveBeenCalledTimes(1);        // NX-API write called
    expect(result.snapshotId).toBe("snap-abc");
    expect(result.activatedZoneSet).toBe("Production_ZoneSet");
  });

  it("includes conf t and zoneset activate in commands", async () => {
    const configBatch = vi.fn().mockResolvedValue(undefined);
    const prisma = makePrismaMock({
      zoneSet: {
        findUnique:        vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        findUniqueOrThrow: vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        updateMany:        vi.fn().mockResolvedValue({ count: 0 }),
        update:            vi.fn().mockResolvedValue({}),
      },
    });

    const service = new MdsZoningService(prisma);
    const result  = await service.commitAndActivate(
      { switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" },
      makeMdsClientMock({ sendConfigBatch: configBatch }),
      "192.168.1.100"
    );

    expect(result.commandsExecuted[0]).toBe("conf t");
    const lastCmd = result.commandsExecuted[result.commandsExecuted.length - 1];
    expect(lastCmd).toMatch(/zoneset activate/);
  });

  it("saves snapshot even when NX-API write fails", async () => {
    const snapshotCreate = vi.fn().mockResolvedValue({ id: "snap-fail" });
    const configBatch    = vi.fn().mockRejectedValue(new Error("NX-API timeout"));

    const prisma = makePrismaMock({
      zoningSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create:    snapshotCreate,
      },
      zoneSet: {
        findUnique:        vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        findUniqueOrThrow: vi.fn().mockResolvedValue(ZONE_SET_FIXTURE),
        updateMany:        vi.fn().mockResolvedValue({ count: 0 }),
        update:            vi.fn().mockResolvedValue({}),
      },
    });

    const service = new MdsZoningService(prisma);
    const result  = await service.commitAndActivate(
      { switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" },
      makeMdsClientMock({ sendConfigBatch: configBatch }),
      "192.168.1.100"
    );

    expect(result.success).toBe(false);
    expect(snapshotCreate).toHaveBeenCalledTimes(1);   // snapshot still saved
    expect(result.snapshotId).toBe("snap-fail");        // ID returned to caller
    expect(result.errors?.[0]).toMatch(/NX-API write failed/);
  });

  it("returns pre-flight errors without touching the switch", async () => {
    const configBatch = vi.fn();
    const prisma = makePrismaMock({
      zoneSet: {
        findUnique: vi.fn().mockResolvedValue(null), // zone set not found
        findUniqueOrThrow: vi.fn(),
        updateMany: vi.fn(),
        update: vi.fn(),
      },
    });

    const service = new MdsZoningService(prisma);
    const result  = await service.commitAndActivate(
      { switchId: "sw-001", vsanId: 100, zoneSetId: "zs-MISSING" },
      makeMdsClientMock({ sendConfigBatch: configBatch }),
      "192.168.1.100"
    );

    expect(result.success).toBe(false);
    expect(configBatch).not.toHaveBeenCalled();         // switch never touched
    expect(result.snapshotId).toBe("");
  });
});

// =============================================================================
describe("Commit command sequence", () => {
  it("generates correct commands for multi-member zones", async () => {
    const capturedCommands: string[][] = [];
    const configBatch = vi.fn().mockImplementation((cmds: string[]) => {
      capturedCommands.push(cmds);
      return Promise.resolve();
    });

    const twoZoneSet = {
      ...ZONE_SET_FIXTURE,
      name: "Test_ZoneSet",
    };

    const prisma = makePrismaMock({
      zoneSet: {
        findUnique:        vi.fn().mockResolvedValue(twoZoneSet),
        findUniqueOrThrow: vi.fn().mockResolvedValue(twoZoneSet),
        updateMany:        vi.fn().mockResolvedValue({ count: 0 }),
        update:            vi.fn().mockResolvedValue({}),
      },
    });

    const service = new MdsZoningService(prisma);
    await service.commitAndActivate(
      { switchId: "sw-001", vsanId: 100, zoneSetId: "zs-001" },
      makeMdsClientMock({ sendConfigBatch: configBatch }),
      "192.168.1.100"
    );

    const cmds = capturedCommands[0];
    // Must start with conf t
    expect(cmds[0]).toBe("conf t");
    // Must include zone definitions for both zones
    expect(cmds.some((c) => c.includes("zone name Zone_DB_to_Storage vsan 100"))).toBe(true);
    expect(cmds.some((c) => c.includes("zone name Zone_App_to_Storage vsan 100"))).toBe(true);
    // PWWN members use "member pwwn"
    expect(cmds.some((c) => c.includes("member pwwn 21:00:00:24:ff:8a:1b:2c"))).toBe(true);
    // Device alias members use "member device-alias"
    expect(cmds.some((c) => c.includes("member device-alias Storage_Array_A_P1"))).toBe(true);
    // Zone set membership
    expect(cmds.some((c) => c.includes("zoneset name Test_ZoneSet vsan 100"))).toBe(true);
    // Activation command
    expect(cmds.some((c) => c.includes("zoneset activate name Test_ZoneSet vsan 100"))).toBe(true);
  });
});

// =============================================================================
describe("diffZoningSnapshots — edge cases", () => {
  function makeSnap(p: Partial<ZoningDatabaseSnapshot> = {}): ZoningDatabaseSnapshot {
    return {
      capturedAt: new Date().toISOString(),
      switchIp: "192.168.1.100",
      vsanId: 100,
      deviceAliases: [],
      zoneSets: [],
      activeZoneSetName: null,
      ...p,
    };
  }

  it("handles multiple simultaneous alias additions", () => {
    const before = makeSnap({ deviceAliases: [{ name: "Host_A", wwn: "aa:bb:cc:dd:ee:ff:00:01" }] });
    const after  = makeSnap({
      deviceAliases: [
        { name: "Host_A", wwn: "aa:bb:cc:dd:ee:ff:00:01" },
        { name: "Host_B", wwn: "aa:bb:cc:dd:ee:ff:00:02" },
        { name: "Host_C", wwn: "aa:bb:cc:dd:ee:ff:00:03" },
      ],
    });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.aliases.added).toHaveLength(2);
    expect(diff.aliases.removed).toHaveLength(0);
  });

  it("detects removal of a zone from a zone set", () => {
    const before = makeSnap({
      zoneSets: [{
        name: "ZS1", vsanId: 100, isActive: true,
        zones: [
          { name: "Zone_A", members: [{ type: "pwwn", value: "aa:bb:cc:dd:ee:ff:00:01" }] },
          { name: "Zone_B", members: [{ type: "pwwn", value: "aa:bb:cc:dd:ee:ff:00:02" }] },
        ],
      }],
    });
    const after = makeSnap({
      zoneSets: [{
        name: "ZS1", vsanId: 100, isActive: true,
        zones: [
          { name: "Zone_A", members: [{ type: "pwwn", value: "aa:bb:cc:dd:ee:ff:00:01" }] },
          // Zone_B removed
        ],
      }],
    });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.zones.removed).toContain("Zone_B");
  });

  it("correctly identifies no changes on identical snapshots with complex membership", () => {
    const members = [
      { type: "pwwn"         as const, value: "21:00:00:24:ff:8a:1b:2c" },
      { type: "device_alias" as const, value: "Storage_A" },
    ];
    const zoneSet = [{
      name: "ZS1", vsanId: 100, isActive: true,
      zones: [{ name: "Zone_A", members }],
    }];
    const aliases = [{ name: "Storage_A", wwn: "50:00:d3:10:00:5e:c4:01" }];

    const snap = makeSnap({ deviceAliases: aliases, zoneSets: zoneSet, activeZoneSetName: "ZS1" });
    const diff = diffZoningSnapshots(snap, { ...snap, capturedAt: new Date().toISOString() });

    expect(diff.aliases.added).toHaveLength(0);
    expect(diff.aliases.removed).toHaveLength(0);
    expect(diff.zones.membersAdded).toHaveLength(0);
    expect(diff.zones.membersRemoved).toHaveLength(0);
    expect(diff.zoneSets.activationChanged).toBe(false);
  });
});

// =============================================================================
describe("isValidWwn — exhaustive edge cases", () => {
  const valid = [
    "21:00:00:24:ff:8a:1b:2c",
    "50:00:d3:10:00:5e:c4:01",
    "20:00:00:25:B5:A0:00:01", // uppercase
    "FF:FF:FF:FF:FF:FF:FF:FF", // all Fs
    "00:00:00:00:00:00:00:00", // all zeros
  ];

  const invalid = [
    "21:00:00:24:ff:8a:1b",          // too short (7 octets)
    "21:00:00:24:ff:8a:1b:2c:3d",   // too long (9 octets)
    "21-00-00-24-ff-8a-1b-2c",       // dashes not colons
    "2100002458a1b2c",               // no separators
    "GG:00:00:24:ff:8a:1b:2c",      // invalid hex char G
    "",                               // empty
    "   ",                            // whitespace only
    "DB_Server_HBA",                  // alias name
  ];

  for (const w of valid)   it(`accepts "${w}"`,  () => expect(isValidWwn(w)).toBe(true));
  for (const w of invalid) it(`rejects "${w}"`, () => expect(isValidWwn(w)).toBe(false));
});
