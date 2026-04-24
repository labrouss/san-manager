// =============================================================================
// prisma/seed.ts
// Development seed: one MDS switch, 6 FC aliases, 3 zones, 1 zone set,
// 2 hours of synthetic port_metrics for trending charts.
// Run with:  npx tsx prisma/seed.ts
// =============================================================================

import { PrismaClient, SnapshotTrigger } from "@prisma/client";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Deterministic synthetic metric generator (no external dep required)
// ---------------------------------------------------------------------------
function syntheticMetrics(
  switchId: string,
  interfaceName: string,
  hoursBack: number,
  intervalMinutes: number
) {
  const records = [];
  const now = Date.now();
  const steps = (hoursBack * 60) / intervalMinutes;
  let crcAccum = 0n;

  for (let i = steps; i >= 0; i--) {
    const ts = new Date(now - i * intervalMinutes * 60 * 1000);

    // Simulate sinusoidal throughput with noise
    const phase    = (i / steps) * Math.PI * 4;
    const txMbps   = Math.max(0, 400 + Math.sin(phase) * 200 + (Math.random() - 0.5) * 50);
    const rxMbps   = Math.max(0, 380 + Math.cos(phase) * 180 + (Math.random() - 0.5) * 40);
    const txBytes  = BigInt(Math.round(txMbps * 1e6 * intervalMinutes * 60 * i));
    const rxBytes  = BigInt(Math.round(rxMbps * 1e6 * intervalMinutes * 60 * i));

    // Inject a CRC spike at 30% through
    if (i === Math.floor(steps * 0.7)) crcAccum += 3n;
    if (Math.random() < 0.01)          crcAccum += 1n;

    // RX power dips below threshold once (to trigger the alert badge in the UI)
    const rxPowerDbm =
      i === Math.floor(steps * 0.4)
        ? -11.2
        : -3.5 + Math.sin(phase * 0.5) * 0.8 + (Math.random() - 0.5) * 0.4;

    records.push({
      timestamp:     ts,
      switchId,
      interfaceName,
      txBytes,
      rxBytes,
      crcErrors:     crcAccum,
      linkFailures:  0n,
      txRateBps:     txMbps * 1e6,
      rxRateBps:     rxMbps * 1e6,
      rxPowerDbm,
      txPowerDbm:    -2.1 + (Math.random() - 0.5) * 0.3,
      temperature:   35.5 + Math.sin(phase) * 3,
      voltage:       3.31 + (Math.random() - 0.5) * 0.02,
      current:       6.5  + (Math.random() - 0.5) * 0.3,
    });
  }
  return records;
}

async function main() {
  console.log("🌱  Seeding SAN Zoning database…");

  // -------------------------------------------------------------------------
  // 1. Switch
  // -------------------------------------------------------------------------
  const sw = await prisma.switch.upsert({
    where: { ipAddress: "192.168.1.100" },
    create: {
      ipAddress:    "192.168.1.100",
      hostname:     "mds-9396s-core-a",
      model:        "MDS 9396S",
      serialNumber: "JAE2312ABCD",
      nxosVersion:  "9.3(8)",
      isActive:     true,
      lastSeenAt:   new Date(),
    },
    update: { lastSeenAt: new Date() },
  });
  console.log(`  ✓ Switch  ${sw.hostname} (${sw.id})`);

  // -------------------------------------------------------------------------
  // 2. FC Aliases
  // -------------------------------------------------------------------------
  const aliasData = [
    { name: "DB_Server_01_HBA_A", wwn: "21:00:00:24:ff:8a:1b:2c", description: "Oracle DB primary HBA" },
    { name: "DB_Server_01_HBA_B", wwn: "21:00:00:24:ff:8a:1b:2d", description: "Oracle DB secondary HBA" },
    { name: "App_Server_02_HBA_A", wwn: "21:00:00:24:ff:9b:2c:3d", description: "App tier, rack 3" },
    { name: "Storage_Array_A_P1",  wwn: "50:00:d3:10:00:5e:c4:01", description: "Pure Storage FA-X20 port 1" },
    { name: "Storage_Array_A_P2",  wwn: "50:00:d3:10:00:5e:c4:02", description: "Pure Storage FA-X20 port 2" },
    { name: "Backup_Host_HBA_A",   wwn: "20:00:00:25:b5:a0:00:01", description: "Veeam proxy HBA" },
  ];

  const aliases: Record<string, { id: string; wwn: string }> = {};
  for (const a of aliasData) {
    const alias = await prisma.fcAlias.upsert({
      where: { switchId_wwn: { switchId: sw.id, wwn: a.wwn } },
      create: { switchId: sw.id, ...a, syncedAt: new Date() },
      update: { name: a.name, syncedAt: new Date() },
    });
    aliases[a.name] = { id: alias.id, wwn: alias.wwn };
    console.log(`  ✓ Alias  ${a.name}`);
  }

  // -------------------------------------------------------------------------
  // 3. Zones (VSAN 100)
  // -------------------------------------------------------------------------
  const vsanId = 100;

  async function upsertZone(name: string, members: { type: string; value: string }[]) {
    const existing = await prisma.zone.findFirst({ where: { switchId: sw.id, name, vsanId } });
    if (existing) {
      await prisma.zone.update({ where: { id: existing.id }, data: { isDraft: false, syncedAt: new Date() } });
      return existing;
    }
    return prisma.zone.create({
      data: {
        switchId: sw.id,
        name,
        vsanId,
        isDraft: false,
        syncedAt: new Date(),
        members: {
          create: members.map((m) => ({
            memberType: m.type as any,
            value: m.value,
          })),
        },
      },
    });
  }

  const zoneDB = await upsertZone("Zone_DB_to_Storage", [
    { type: "PWWN",         value: "21:00:00:24:ff:8a:1b:2c" },
    { type: "PWWN",         value: "21:00:00:24:ff:8a:1b:2d" },
    { type: "DEVICE_ALIAS", value: "Storage_Array_A_P1" },
    { type: "DEVICE_ALIAS", value: "Storage_Array_A_P2" },
  ]);

  const zoneApp = await upsertZone("Zone_App_to_Storage", [
    { type: "PWWN",         value: "21:00:00:24:ff:9b:2c:3d" },
    { type: "DEVICE_ALIAS", value: "Storage_Array_A_P1" },
  ]);

  const zoneBackup = await upsertZone("Zone_Backup_to_Storage", [
    { type: "PWWN",         value: "20:00:00:25:b5:a0:00:01" },
    { type: "DEVICE_ALIAS", value: "Storage_Array_A_P2" },
  ]);

  console.log(`  ✓ Zones  ${[zoneDB, zoneApp, zoneBackup].map((z) => z.name).join(", ")}`);

  // -------------------------------------------------------------------------
  // 4. Zone Set
  // -------------------------------------------------------------------------
  let zoneSet = await prisma.zoneSet.findFirst({
    where: { switchId: sw.id, name: "Production_ZoneSet", vsanId },
  });

  if (!zoneSet) {
    zoneSet = await prisma.zoneSet.create({
      data: {
        switchId:    sw.id,
        name:        "Production_ZoneSet",
        vsanId,
        isActive:    true,
        isDraft:     false,
        activatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        syncedAt:    new Date(),
        members: {
          create: [
            { zoneId: zoneDB.id },
            { zoneId: zoneApp.id },
            { zoneId: zoneBackup.id },
          ],
        },
      },
    });
  }
  console.log(`  ✓ ZoneSet  ${zoneSet.name}  (active)`);

  // -------------------------------------------------------------------------
  // 5. Initial zoning snapshot (simulate what a PRE_COMMIT would save)
  // -------------------------------------------------------------------------
  const snapshotPayload = {
    capturedAt:          new Date().toISOString(),
    switchIp:            sw.ipAddress,
    vsanId,
    activeZoneSetName:   "Production_ZoneSet",
    deviceAliases:       aliasData.map((a) => ({ name: a.name, wwn: a.wwn })),
    zoneSets: [
      {
        name:     "Production_ZoneSet",
        vsanId,
        isActive: true,
        zones: [
          {
            name: "Zone_DB_to_Storage",
            members: [
              { type: "pwwn",         value: "21:00:00:24:ff:8a:1b:2c" },
              { type: "pwwn",         value: "21:00:00:24:ff:8a:1b:2d" },
              { type: "device_alias", value: "Storage_Array_A_P1" },
              { type: "device_alias", value: "Storage_Array_A_P2" },
            ],
          },
          {
            name: "Zone_App_to_Storage",
            members: [
              { type: "pwwn",         value: "21:00:00:24:ff:9b:2c:3d" },
              { type: "device_alias", value: "Storage_Array_A_P1" },
            ],
          },
          {
            name: "Zone_Backup_to_Storage",
            members: [
              { type: "pwwn",         value: "20:00:00:25:b5:a0:00:01" },
              { type: "device_alias", value: "Storage_Array_A_P2" },
            ],
          },
        ],
      },
    ],
  };

  await prisma.zoningSnapshot.create({
    data: {
      switchId:    sw.id,
      vsanId,
      trigger:     SnapshotTrigger.MANUAL,
      triggeredBy: "seed",
      payload:     snapshotPayload as any,
    },
  });
  console.log("  ✓ Zoning snapshot created");

  // -------------------------------------------------------------------------
  // 6. Synthetic port_metrics (2 hours × 1 min intervals, 3 interfaces)
  // -------------------------------------------------------------------------
  const interfaces = ["fc1/1", "fc1/2", "fc1/3"];

  for (const iface of interfaces) {
    const records = syntheticMetrics(sw.id, iface, 2, 1);

    // Insert in batches to avoid hitting parameter limits
    const batchSize = 200;
    for (let i = 0; i < records.length; i += batchSize) {
      await prisma.portMetrics.createMany({
        data: records.slice(i, i + batchSize) as any,
        skipDuplicates: true,
      });
    }
    console.log(`  ✓ Metrics  ${iface}  (${records.length} rows)`);
  }

  // -------------------------------------------------------------------------
  // 7. Draft zone for UI demo (shows "draft" badge)
  // -------------------------------------------------------------------------
  const draftExists = await prisma.zone.findFirst({
    where: { switchId: sw.id, name: "Zone_DR_to_Storage_NEW", vsanId },
  });
  if (!draftExists) {
    await prisma.zone.create({
      data: {
        switchId: sw.id,
        name:     "Zone_DR_to_Storage_NEW",
        vsanId,
        isDraft:  true,
        members: {
          create: [
            { memberType: "PWWN", value: "20:00:00:25:b5:a0:00:01" },
          ],
        },
      },
    });
    console.log("  ✓ Draft zone created (Zone_DR_to_Storage_NEW)");
  }

  console.log("\n✅  Seed complete.");
  console.log(`   Switch ID: ${sw.id}`);
  console.log(`   Dashboard: http://localhost:5173`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
