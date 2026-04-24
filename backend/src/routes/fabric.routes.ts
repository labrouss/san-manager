// =============================================================================
// routes/fabric.routes.ts
// Fabric discovery (FCNS/FCS), performance/top-ports, interface dropdowns,
// and switch registration with IP/user/password form.
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { MdsClient } from "../services/MdsClient";
import { MdsSimulator, isSim } from "../services/MdsSimulator";
import { buildClient as factoryBuildClient } from "../services/clientFactory";
import { MdsFabricService } from "../services/MdsFabricService";
import logger from "../config/logger";

// ---------------------------------------------------------------------------
// Helper: build client for switch registration/credential verification
// (takes explicit credentials; for normal operations use factoryBuildClient)
// ---------------------------------------------------------------------------
function buildClientWithCreds(ip: string, username: string, password: string, port = 443) {
  if (isSim()) return new MdsSimulator(ip) as any;
  return new MdsClient(ip, username, password, port);
}

// Credential store imported from shared module (used by clientFactory too)
import { credentialStore } from "../services/credentialStore";

export function buildFabricRouter(prisma: PrismaClient): Router {
  const router = Router();
  const fabricService = new MdsFabricService(prisma);

  // ==========================================================================
  // SWITCH REGISTRATION  (UI form — no CLI required)
  // ==========================================================================

  // POST /api/switches/register
  // Accepts ipAddress, username, password, optional hostname/model.
  // Tests connectivity before saving, stores credentials in memory.
  router.post("/switches/register", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        ipAddress,
        username,
        password,
        port = 443,
        hostname,
        model,
      } = req.body as {
        ipAddress: string;
        username:  string;
        password:  string;
        port?:     number;
        hostname?: string;
        model?:    string;
      };

      if (!ipAddress) {
        return res.status(422).json({ error: "ipAddress is required" });
      }

      const simMode = isSim();

      // In simulation mode credentials are not needed — skip connectivity check
      if (!simMode && (!username || !password)) {
        return res.status(422).json({ error: "username and password are required for real switches" });
      }

      let detectedHostname = hostname;
      let detectedModel    = model;

      if (simMode) {
        // Simulator — populate realistic defaults without contacting a real switch
        const sim = new MdsSimulator(ipAddress);
        try {
          const ver = await sim.sendCommand("show version") as any;
          detectedHostname = detectedHostname ?? ver.body?.header_str?.split("\n")[0]?.trim() ?? `MDS-SIM-${ipAddress}`;
          detectedModel    = detectedModel    ?? ver.body?.chassis_id?.trim() ?? "MDS 9396S (Simulated)";
        } catch {
          detectedHostname = detectedHostname ?? `MDS-SIM-${ipAddress}`;
          detectedModel    = detectedModel    ?? "MDS 9396S (Simulated)";
        }
        logger.info({ ip: ipAddress, model: detectedModel }, "Simulated switch registered");
      } else {
        // Real switch — verify NX-API connectivity first
        const client = buildClientWithCreds(ipAddress, username ?? "admin", password ?? "", port);
        try {
          const ver = await (client as import("../services/MdsClient").MdsClient)
            .sendCommand<{ header_str?: string; chassis_id?: string; sys_ver_str?: string }>(
            "show version"
          );
          detectedHostname = detectedHostname ?? ver.body.header_str?.split("\n")[0]?.trim();
          detectedModel    = detectedModel    ?? ver.body.chassis_id?.trim();
          logger.info({ ip: ipAddress, model: detectedModel }, "Switch connectivity verified");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return res.status(422).json({
            error: msg,
            detail: `Attempted connection to ${ipAddress}:${port}`,
          });
        }
      }

      // Upsert the switch record
      const sw = await prisma.switch.upsert({
        where:  { ipAddress },
        create: { ipAddress, hostname: detectedHostname, model: detectedModel, isActive: true, lastSeenAt: new Date() },
        update: { hostname: detectedHostname, model: detectedModel, isActive: true, lastSeenAt: new Date() },
      });

      // Store credentials in memory (not in DB)
      credentialStore.set(sw.id, { username, password, port: Number(port) });

      logger.info({ switchId: sw.id, ip: ipAddress }, "Switch registered via UI form");
      res.status(201).json({ ...sw, credentialsStored: true });
    } catch (err) { next(err); }
  });

  // GET /api/switches/credentials/:id  — check if credentials are cached
  router.get("/switches/credentials/:id", (req: Request, res: Response) => {
    const has = credentialStore.has(req.params.id);
    res.json({ credentialsStored: has });
  });

  // POST /api/switches/credentials/:id  — update stored credentials
  router.post("/switches/credentials/:id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password, port = 443 } = req.body as { username: string; password: string; port?: number };
      if (!username || !password) return res.status(422).json({ error: "username and password required" });

      const sw = await prisma.switch.findUnique({ where: { id: req.params.id } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      // Verify connectivity (skip for sim mode)
      const client = buildClientWithCreds(sw.ipAddress, username, password, Number(port));
      if (!isSim()) {
        try {
          await client.sendCommand("show version");
        } catch {
          return res.status(422).json({ error: "Cannot connect with provided credentials" });
        }
      }

      credentialStore.set(req.params.id, { username, password, port: Number(port) });
      res.json({ credentialsStored: true });
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // FABRIC DISCOVERY  (FCNS + FCS databases)
  // ==========================================================================

  // GET /api/fabric/fcns?switchId=&vsanId=
  router.get("/fabric/fcns", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId, vsanId } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      const sw = await prisma.switch.findUnique({ where: { id: switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const creds = credentialStore.get(switchId) ?? {
        username: process.env.MDS_USERNAME ?? "admin",
        password: process.env.MDS_PASSWORD ?? "",
        port:     parseInt(process.env.MDS_PORT ?? "443"),
      };

      const client = factoryBuildClient(switchId, sw.ipAddress);
      const entries = await fabricService.fetchFcnsDatabase(
        client,
        vsanId ? parseInt(vsanId) : undefined
      );

      res.json(entries);
    } catch (err) { next(err); }
  });

  // GET /api/fabric/discover?switchId=&vsanId=
  // Full fabric discovery: FCNS + FCS + auto alias bridge
  router.get("/fabric/discover", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId, vsanId = "100" } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      const sw = await prisma.switch.findUnique({ where: { id: switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const creds = credentialStore.get(switchId) ?? {
        username: process.env.MDS_USERNAME ?? "admin",
        password: process.env.MDS_PASSWORD ?? "",
        port:     parseInt(process.env.MDS_PORT ?? "443"),
      };

      const client = factoryBuildClient(switchId, sw.ipAddress);
      const result = await fabricService.fetchAndEnrichFabric(
        client, switchId, parseInt(vsanId)
      );

      res.json(result);
    } catch (err) { next(err); }
  });

  // GET /api/fabric/wwns?switchId=&vsanId=
  // Known WWNs for dropdown menus (from DB, fast, no live switch needed)
  router.get("/fabric/wwns", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId, vsanId = "100" } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      const wwns = await fabricService.getKnownWwns(switchId, parseInt(vsanId));
      res.json(wwns);
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // PERFORMANCE  — top ports + throughput
  // ==========================================================================

  // GET /api/performance/top?switchId=&vsanId=&topN=5
  router.get("/performance/top", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId, vsanId = "100", topN = "5" } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      const sw = await prisma.switch.findUnique({ where: { id: switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const creds = credentialStore.get(switchId) ?? {
        username: process.env.MDS_USERNAME ?? "admin",
        password: process.env.MDS_PASSWORD ?? "",
        port:     parseInt(process.env.MDS_PORT ?? "443"),
      };

      const client = factoryBuildClient(switchId, sw.ipAddress);
      const result = await fabricService.fetchTopPorts(
        client, switchId, parseInt(vsanId), parseInt(topN)
      );

      res.json(result);
    } catch (err) { next(err); }
  });

  // GET /api/performance/history?switchId=&interface=&window=24h
  // Delegates to the time-series query in switches.routes.ts  (same endpoint)
  // Kept here as an alias for the performance page

  // ==========================================================================
  // INTERFACE LIST  (for dropdowns)
  // ==========================================================================

  // GET /api/fabric/interfaces?switchId=
  router.get("/fabric/interfaces", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      const names = await fabricService.getInterfaceNames(switchId);

      // If no metrics yet (fresh install), try live query
      if (names.length === 0) {
        const sw = await prisma.switch.findUnique({ where: { id: switchId } });
        if (sw) {
          const creds = credentialStore.get(switchId) ?? {
            username: process.env.MDS_USERNAME ?? "admin",
            password: process.env.MDS_PASSWORD ?? "",
            port:     parseInt(process.env.MDS_PORT ?? "443"),
          };
          try {
            const client = factoryBuildClient(switchId, sw.ipAddress);
            const output = await (client as import("../services/MdsClient").MdsClient)
              .sendCommand<{ TABLE_interface_brief?: { ROW_interface_brief: any[] } }>(
              "show interface counters brief"
            );
            const rows = Array.isArray(output.body.TABLE_interface_brief?.ROW_interface_brief)
              ? output.body.TABLE_interface_brief!.ROW_interface_brief
              : [];
            const liveNames = rows
              .map((r: any) => r.interface as string)
              .filter((n: string) => /^fc\d+\/\d+/i.test(n))
              .sort();
            return res.json(liveNames);
          } catch { /* fall through */ }
        }
      }

      res.json(names);
    } catch (err) { next(err); }
  });

  // ==========================================================================
  // VSAN LIST  (for tab/selector)
  // ==========================================================================

  // GET /api/fabric/vsans?switchId=
  router.get("/fabric/vsans", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { switchId } = req.query as Record<string, string>;
      if (!switchId) return res.status(422).json({ error: "switchId required" });

      // Derive known VSANs from zone_sets table
      const rows = await prisma.zoneSet.findMany({
        where: { switchId },
        distinct: ["vsanId"],
        select: { vsanId: true },
        orderBy: { vsanId: "asc" },
      });

      let vsanIds = rows.map((r) => r.vsanId);

      // Fallback: if nothing in DB yet, return [100] as default
      if (vsanIds.length === 0) vsanIds = [100];

      res.json(vsanIds);
    } catch (err) { next(err); }
  });


  // DELETE /api/switches/:id/credentials  — clear cached credentials on switch removal
  // Called automatically by the frontend after DELETE /api/switches/:id
  router.delete("/switches/:id/credentials", (req: Request, res: Response) => {
    credentialStore.delete(req.params.id);
    logger.info({ switchId: req.params.id }, "Credentials cleared from store");
    res.status(204).send();
  });

  return router;
}

// credentialStore is exported from services/credentialStore.ts
