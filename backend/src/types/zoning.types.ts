// =============================================================================
// types/zoning.types.ts
// NX-API response shapes + clean domain types for zoning operations
// =============================================================================

// ---------------------------------------------------------------------------
// NX-API raw response types  (show zoneset active / show zone)
// ---------------------------------------------------------------------------

export interface ShowZoneSetBody {
  TABLE_zoneset?: {
    ROW_zoneset: ZoneSetRow | ZoneSetRow[];
  };
}

export interface ZoneSetRow {
  zoneset_name: string;
  zoneset_vsan: string;
  zoneset_active?: string;   // "true" | "false"
  TABLE_zone?: {
    ROW_zone: ZoneRow | ZoneRow[];
  };
}

export interface ZoneRow {
  zone_name: string;
  TABLE_zone_member?: {
    ROW_zone_member: ZoneMemberRow | ZoneMemberRow[];
  };
}

export interface ZoneMemberRow {
  wwn?: string;
  device_alias?: string;
  fcid?: string;
}

// show device-alias database
export interface ShowDeviceAliasBody {
  TABLE_device_alias_database?: {
    ROW_device_alias_database: DeviceAliasRow | DeviceAliasRow[];
  };
}

export interface DeviceAliasRow {
  dev_alias_name: string;
  pwwn: string;
}

// ---------------------------------------------------------------------------
// Clean domain types (output of parsing functions)
// ---------------------------------------------------------------------------

export interface ParsedDeviceAlias {
  name: string;
  wwn: string;
}

export interface ParsedZoneMember {
  type: "pwwn" | "device_alias" | "fcid";
  value: string;
}

export interface ParsedZone {
  name: string;
  members: ParsedZoneMember[];
}

export interface ParsedZoneSet {
  name: string;
  vsanId: number;
  isActive: boolean;
  zones: ParsedZone[];
}

/** Full snapshot payload — what gets stored as JSON in ZoningSnapshot */
export interface ZoningDatabaseSnapshot {
  capturedAt: string;       // ISO timestamp
  switchIp: string;
  vsanId: number;
  deviceAliases: ParsedDeviceAlias[];
  zoneSets: ParsedZoneSet[];
  activeZoneSetName: string | null;
}

// ---------------------------------------------------------------------------
// Diff types — what changed between two snapshots
// ---------------------------------------------------------------------------

export interface ZoningDiff {
  aliases: {
    added: ParsedDeviceAlias[];
    removed: ParsedDeviceAlias[];
    modified: { before: ParsedDeviceAlias; after: ParsedDeviceAlias }[];
  };
  zones: {
    added: ParsedZone[];
    removed: string[];        // zone names
    membersAdded: { zoneName: string; member: ParsedZoneMember }[];
    membersRemoved: { zoneName: string; member: ParsedZoneMember }[];
  };
  zoneSets: {
    activationChanged: boolean;
    before: string | null;
    after: string | null;
  };
}

// ---------------------------------------------------------------------------
// Commit request body  (POST /api/zoning/commit)
// ---------------------------------------------------------------------------

export interface CommitRequest {
  switchId: string;
  vsanId: number;
  zoneSetId: string;          // the ZoneSet to activate
  /** Optional: explicit list of zone IDs to include. If omitted, all ZoneSet members are used. */
  zoneIds?: string[];
}

export interface CommitResult {
  success: boolean;
  snapshotId: string;         // the pre-commit snapshot ID
  activatedZoneSet: string;
  commandsExecuted: string[];
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Alias sync result  (from poller's alias bridge)
// ---------------------------------------------------------------------------

export interface AliasSyncResult {
  switchId: string;
  switchIp: string;
  newAliasesOnSwitch: ParsedDeviceAlias[];    // on switch but not in DB
  orphanedAliasesInDb: ParsedDeviceAlias[];   // in DB but not on switch
  synced: number;
}
