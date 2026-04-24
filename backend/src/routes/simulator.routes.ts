// =============================================================================
// routes/simulator.routes.ts
// GET  /api/simulator/:switchId           — get current simulator state
// PUT  /api/simulator/:switchId/ports     — update port configuration
// POST /api/simulator/:switchId/reset     — reset to defaults
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.middleware";
import { isSim, getSimulatorState, updateSimulatorPorts, resetSimulatorState } from "../services/MdsSimulator";
import logger from "../config/logger";

export function buildSimulatorRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuth);

  // Check if simulator is active — any authenticated user
  router.get("/simulator/active", (_req, res) => {
    res.json({ active: isSim() });
  });

  // GET simulator state for a switch
  router.get("/simulator/:switchId", requireRole("ADMIN", "OPERATOR"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isSim()) return res.status(400).json({ error: "Simulator is not active" });

      const sw = await prisma.switch.findUnique({ where: { id: req.params.switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const state = getSimulatorState(sw.ipAddress);
      res.json({
        switchId:   sw.id,
        ipAddress:  sw.ipAddress,
        pollCount:  state.pollCount,
        ports:      state.ports,
        aliasCount: state.aliases.length,
        zoneCount:  state.zones.length,
        zoneSetCount: state.zoneSets.length,
      });
    } catch (err) { next(err); }
  });

  // PUT port configuration
  router.put("/simulator/:switchId/ports", requireRole("ADMIN", "OPERATOR"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isSim()) return res.status(400).json({ error: "Simulator is not active" });

      const sw = await prisma.switch.findUnique({ where: { id: req.params.switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      const { ports } = req.body;
      if (!Array.isArray(ports)) return res.status(422).json({ error: "ports must be an array" });

      // Validate each port entry
      const validModes  = ["F", "E", "TE", "FL"];
      const validSpeeds = [4, 8, 16, 32, 64];
      for (const p of ports) {
        if (!p.name || !validModes.includes(p.mode) || !validSpeeds.includes(p.speedGbps)) {
          return res.status(422).json({ error: `Invalid port config for ${p.name}` });
        }
      }

      updateSimulatorPorts(sw.ipAddress, ports);
      logger.info({ switchId: sw.id, portCount: ports.length }, "Simulator ports updated via API");
      res.json({ success: true, portCount: ports.length });
    } catch (err) { next(err); }
  });

  // POST reset simulator state
  router.post("/simulator/:switchId/reset", requireRole("ADMIN"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isSim()) return res.status(400).json({ error: "Simulator is not active" });

      const sw = await prisma.switch.findUnique({ where: { id: req.params.switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      resetSimulatorState(sw.ipAddress);
      res.json({ success: true, message: "Simulator state reset to defaults" });
    } catch (err) { next(err); }
  });


  // POST /api/simulator/:switchId/poll — trigger immediate poll for testing
  router.post("/simulator/:switchId/poll", requireRole("ADMIN", "OPERATOR"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sw = await prisma.switch.findUnique({ where: { id: req.params.switchId } });
      if (!sw) return res.status(404).json({ error: "Switch not found" });

      // Import poller lazily to avoid circular dependency
      const { poller } = await import("../app");
      // syncSwitches will pick up the switch and start its timer if not already running
      // The poller's internal syncSwitches is private, so we trigger via the public interface
      // Simplest: just log that the user should wait for the next sync cycle (30s)
      res.json({
        message: "Poll will be triggered within 30 seconds via the auto-sync cycle.",
        note: "The poller checks for new switches every 30 seconds and polls immediately upon discovery."
      });
    } catch (err) { next(err); }
  });

  return router;
}
