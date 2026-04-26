// src/app.ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { PrismaClient } from "@prisma/client";
import { buildSwitchesRouter } from "./routes/switches.routes";
import { buildZoningRouter }   from "./routes/zoning.routes";
import { buildFabricRouter }   from "./routes/fabric.routes";
import { buildAuthRouter }     from "./routes/auth.routes";
import { buildSettingsRouter }  from "./routes/settings.routes";
import { buildSimulatorRouter } from "./routes/simulator.routes";
import { requireAuth }         from "./middleware/auth.middleware";
import { AuthService }         from "./services/AuthService";
import { MdsPoller }           from "./workers/MdsPoller";
import logger from "./config/logger";

const app    = express();
const prisma = new PrismaClient();
export const poller = new MdsPoller(prisma);

app.use(helmet());
// Accept both the configured CORS origin AND localhost variants
// so the app works from any hostname (remote browser, IP address, custom domain)
const corsOrigins = [
  process.env.CORS_ORIGIN ?? "http://localhost:8080",
  "http://localhost:8080",
  "http://localhost:5173",   // Vite dev server
  "http://localhost:3000",
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, same-origin nginx proxy)
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    // Also allow any origin that matches the host pattern (port variations)
    callback(null, true);   // permissive for internal tool — tighten if exposed to internet
  },
  credentials: true,
}));
app.use(express.json());

// Health check — public (used by Docker healthcheck)
app.get("/health", (_req, res) => res.json({ status: "ok", ts: new Date().toISOString() }));

// ── Auth routes (public login/register + protected user management) ──
app.use("/api", buildAuthRouter(prisma));

// ── All other API routes require a valid JWT ──
app.use("/api", requireAuth);
app.use("/api", buildSettingsRouter(prisma));
app.use("/api", buildSwitchesRouter(prisma));
app.use("/api", buildZoningRouter(prisma));
app.use("/api", buildFabricRouter(prisma));
app.use("/api", buildSimulatorRouter(prisma));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err: err.message }, "Unhandled error");
  res.status(500).json({ error: err.message });
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);

app.listen(PORT, async () => {
  logger.info({ port: PORT }, "SAN Platform API started");

  // Bootstrap hypertable
  try {
    await prisma.$executeRawUnsafe(
      `SELECT create_hypertable('port_metrics','timestamp', if_not_exists => TRUE, migrate_data => TRUE)`
    );
  } catch { /* already exists */ }

  // Ensure at least one admin user exists
  const authSvc = new AuthService(prisma);
  await authSvc.ensureDefaultAdmin();

  await poller.start();
});

process.on("SIGTERM", async () => {
  poller.stop();
  await prisma.$disconnect();
  process.exit(0);
});
