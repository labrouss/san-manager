// =============================================================================
// tests/zoning-service.test.ts
// Unit tests for all parsing and diff functions — run with: npx vitest
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  parseDeviceAliases,
  parseZoneSets,
  diffZoningSnapshots,
  isValidWwn,
} from "../src/services/MdsZoningService";
import type {
  ShowDeviceAliasBody,
  ShowZoneSetBody,
  ZoningDatabaseSnapshot,
} from "../src/types/zoning.types";

// ---------------------------------------------------------------------------
// isValidWwn
// ---------------------------------------------------------------------------
describe("isValidWwn", () => {
  it("accepts valid lower-case WWN", () => {
    expect(isValidWwn("21:00:00:24:ff:8a:1b:2c")).toBe(true);
  });
  it("accepts valid upper-case WWN", () => {
    expect(isValidWwn("20:00:00:25:B5:A0:00:01")).toBe(true);
  });
  it("rejects WWN with wrong separator", () => {
    expect(isValidWwn("2100002458a1b2c")).toBe(false);
  });
  it("rejects WWN with too few octets", () => {
    expect(isValidWwn("21:00:00:24:ff:8a:1b")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isValidWwn("")).toBe(false);
  });
  it("rejects alias name (not a WWN)", () => {
    expect(isValidWwn("DB_Server_HBA_A")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseDeviceAliases
// ---------------------------------------------------------------------------
describe("parseDeviceAliases", () => {
  it("parses a single alias", () => {
    const body: ShowDeviceAliasBody = {
      TABLE_device_alias_database: {
        ROW_device_alias_database: {
          dev_alias_name: "DB_Server_01",
          pwwn: "21:00:00:24:ff:8a:1b:2c",
        },
      },
    };
    const result = parseDeviceAliases(body);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("DB_Server_01");
    expect(result[0].wwn).toBe("21:00:00:24:ff:8a:1b:2c");
  });

  it("parses multiple aliases (array response)", () => {
    const body: ShowDeviceAliasBody = {
      TABLE_device_alias_database: {
        ROW_device_alias_database: [
          { dev_alias_name: "Host_A", pwwn: "21:00:00:24:ff:01:00:01" },
          { dev_alias_name: "Storage_B", pwwn: "50:00:d3:10:00:5e:c4:02" },
        ],
      },
    };
    const result = parseDeviceAliases(body);
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe("Storage_B");
  });

  it("returns empty array when no alias table present", () => {
    const body: ShowDeviceAliasBody = {};
    expect(parseDeviceAliases(body)).toHaveLength(0);
  });

  it("normalises WWN to lowercase", () => {
    const body: ShowDeviceAliasBody = {
      TABLE_device_alias_database: {
        ROW_device_alias_database: {
          dev_alias_name: "Host_X",
          pwwn: "  20:00:00:25:B5:A0:00:01  ", // with spaces + uppercase
        },
      },
    };
    const result = parseDeviceAliases(body);
    expect(result[0].wwn).toBe("20:00:00:25:b5:a0:00:01");
  });
});

// ---------------------------------------------------------------------------
// parseZoneSets
// ---------------------------------------------------------------------------
describe("parseZoneSets", () => {
  const body: ShowZoneSetBody = {
    TABLE_zoneset: {
      ROW_zoneset: {
        zoneset_name: "Production_ZS",
        zoneset_vsan: "100",
        zoneset_active: "true",
        TABLE_zone: {
          ROW_zone: [
            {
              zone_name: "Zone_DB_to_Storage",
              TABLE_zone_member: {
                ROW_zone_member: [
                  { device_alias: "DB_Server_01" },
                  { wwn: "50:00:d3:10:00:5e:c4:02" },
                ],
              },
            },
            {
              zone_name: "Zone_App_to_Storage",
              TABLE_zone_member: {
                ROW_zone_member: { wwn: "21:00:00:24:ff:aa:bb:cc" },
              },
            },
          ],
        },
      },
    },
  };

  it("parses zone set name, vsan, active flag", () => {
    const result = parseZoneSets(body);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Production_ZS");
    expect(result[0].vsanId).toBe(100);
    expect(result[0].isActive).toBe(true);
  });

  it("parses nested zones", () => {
    const result = parseZoneSets(body);
    expect(result[0].zones).toHaveLength(2);
    expect(result[0].zones[0].name).toBe("Zone_DB_to_Storage");
  });

  it("parses zone members with correct types", () => {
    const result = parseZoneSets(body);
    const members = result[0].zones[0].members;
    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({ type: "device_alias", value: "DB_Server_01" });
    expect(members[1]).toEqual({ type: "pwwn", value: "50:00:d3:10:00:5e:c4:02" });
  });

  it("handles single zone member (not array)", () => {
    const result = parseZoneSets(body);
    const zone2members = result[0].zones[1].members;
    expect(zone2members).toHaveLength(1);
    expect(zone2members[0].type).toBe("pwwn");
  });

  it("handles empty TABLE_zoneset gracefully", () => {
    expect(parseZoneSets({})).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// diffZoningSnapshots
// ---------------------------------------------------------------------------
function makeSnap(overrides: Partial<ZoningDatabaseSnapshot> = {}): ZoningDatabaseSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    switchIp: "192.168.1.100",
    vsanId: 100,
    deviceAliases: [],
    zoneSets: [],
    activeZoneSetName: null,
    ...overrides,
  };
}

describe("diffZoningSnapshots", () => {
  it("detects a new alias", () => {
    const before = makeSnap({ deviceAliases: [] });
    const after  = makeSnap({ deviceAliases: [{ name: "New_Host", wwn: "21:00:00:24:ff:01:00:01" }] });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.aliases.added).toHaveLength(1);
    expect(diff.aliases.added[0].name).toBe("New_Host");
  });

  it("detects a removed alias", () => {
    const before = makeSnap({ deviceAliases: [{ name: "Old_Host", wwn: "21:00:00:24:ff:01:00:01" }] });
    const after  = makeSnap({ deviceAliases: [] });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.aliases.removed).toHaveLength(1);
  });

  it("detects an alias rename (same WWN, different name)", () => {
    const wwn = "21:00:00:24:ff:01:00:01";
    const before = makeSnap({ deviceAliases: [{ name: "Host_Old", wwn }] });
    const after  = makeSnap({ deviceAliases: [{ name: "Host_New", wwn }] });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.aliases.modified).toHaveLength(1);
    expect(diff.aliases.modified[0].after.name).toBe("Host_New");
  });

  it("detects a new zone member", () => {
    const before = makeSnap({
      zoneSets: [{ name: "ZS1", vsanId: 100, isActive: true,
        zones: [{ name: "Zone_A", members: [{ type: "pwwn", value: "aa:bb:cc:dd:ee:ff:00:01" }] }] }],
    });
    const after = makeSnap({
      zoneSets: [{ name: "ZS1", vsanId: 100, isActive: true,
        zones: [{ name: "Zone_A", members: [
          { type: "pwwn", value: "aa:bb:cc:dd:ee:ff:00:01" },
          { type: "pwwn", value: "aa:bb:cc:dd:ee:ff:00:02" }, // new
        ] }] }],
    });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.zones.membersAdded).toHaveLength(1);
    expect(diff.zones.membersAdded[0].member.value).toBe("aa:bb:cc:dd:ee:ff:00:02");
  });

  it("detects active zone set change", () => {
    const before = makeSnap({ activeZoneSetName: "ZS_Prod" });
    const after  = makeSnap({ activeZoneSetName: "ZS_DR" });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.zoneSets.activationChanged).toBe(true);
    expect(diff.zoneSets.before).toBe("ZS_Prod");
    expect(diff.zoneSets.after).toBe("ZS_DR");
  });

  it("reports no changes when snapshots are identical", () => {
    const aliases = [{ name: "Host_A", wwn: "11:22:33:44:55:66:77:88" }];
    const before = makeSnap({ deviceAliases: aliases, activeZoneSetName: "ZS1" });
    const after  = makeSnap({ deviceAliases: aliases, activeZoneSetName: "ZS1" });
    const diff = diffZoningSnapshots(before, after);
    expect(diff.aliases.added).toHaveLength(0);
    expect(diff.aliases.removed).toHaveLength(0);
    expect(diff.aliases.modified).toHaveLength(0);
    expect(diff.zoneSets.activationChanged).toBe(false);
  });
});
