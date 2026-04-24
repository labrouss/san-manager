// =============================================================================
// routes/auth.routes.ts
// POST /api/auth/login         — get JWT token
// POST /api/auth/register      — create first user or admin-only afterwards
// GET  /api/auth/me            — current user info
// GET  /api/users              — list users (ADMIN only)
// POST /api/users              — create user (ADMIN only)
// PATCH /api/users/:id         — update user (ADMIN or self)
// POST /api/users/:id/password — change password (ADMIN or self)
// DELETE /api/users/:id        — delete user (ADMIN only)
// =============================================================================

import { Router, Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { AuthService } from "../services/AuthService";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

export function buildAuthRouter(prisma: PrismaClient): Router {
  const router  = Router();
  const authSvc = new AuthService(prisma);

  // ── Public endpoints ────────────────────────────────────────────────────────

  // POST /api/auth/login
  router.post("/auth/login", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body as { username: string; password: string };
      if (!username || !password) {
        return res.status(422).json({ error: "username and password are required" });
      }
      const result = await authSvc.login(username, password);
      res.json(result);
    } catch (err) {
      // Return 401 for credential errors, not 500
      if (err instanceof Error && err.message === "Invalid credentials") {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      next(err);
    }
  });

  // POST /api/auth/register
  // Open only when NO users exist yet (first-time setup).
  // Subsequent registrations require ADMIN role.
  router.post("/auth/register", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, email, password, role = "OPERATOR" } = req.body as {
        username: string; email: string; password: string; role?: string;
      };

      if (!username || !email || !password) {
        return res.status(422).json({ error: "username, email, and password are required" });
      }

      const userCount = await prisma.user.count();
      if (userCount > 0) {
        // Not first-time setup — require admin token
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer ")) {
          return res.status(401).json({ error: "ADMIN token required to create additional users" });
        }
        try {
          const payload = authSvc.verifyToken(header.slice(7));
          if (payload.role !== "ADMIN") {
            return res.status(403).json({ error: "Only ADMINs can create users" });
          }
        } catch {
          return res.status(401).json({ error: "Invalid token" });
        }
      }

      const validRoles = ["ADMIN", "OPERATOR", "VIEWER"];
      const userRole = validRoles.includes(role.toUpperCase())
        ? (role.toUpperCase() as "ADMIN" | "OPERATOR" | "VIEWER")
        : "OPERATOR";

      const user = await authSvc.createUser(username, email, password, userCount === 0 ? "ADMIN" : userRole);
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof Error && (err.message.includes("Unique") || err.message.includes("unique"))) {
        return res.status(409).json({ error: "Username or email already exists" });
      }
      next(err);
    }
  });

  // ── Protected endpoints ─────────────────────────────────────────────────────

  // GET /api/auth/me
  router.get("/auth/me", requireAuth, (req: Request, res: Response) => {
    res.json(req.user);
  });

  // ── User management (ADMIN) ─────────────────────────────────────────────────

  // GET /api/users
  router.get("/users", requireAuth, requireRole("ADMIN"), async (_req, res, next) => {
    try {
      const users = await authSvc.listUsers();
      res.json(users);
    } catch (err) { next(err); }
  });

  // POST /api/users
  router.post("/users", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      const { username, email, password, role = "OPERATOR" } = req.body;
      if (!username || !email || !password) {
        return res.status(422).json({ error: "username, email, and password are required" });
      }
      const validRoles = ["ADMIN", "OPERATOR", "VIEWER"];
      const userRole = validRoles.includes(role.toUpperCase())
        ? (role.toUpperCase() as "ADMIN" | "OPERATOR" | "VIEWER")
        : "OPERATOR";
      const user = await authSvc.createUser(username, email, password, userRole);
      res.status(201).json(user);
    } catch (err) {
      if (err instanceof Error && err.message.includes("nique")) {
        return res.status(409).json({ error: "Username or email already exists" });
      }
      next(err);
    }
  });

  // PATCH /api/users/:id
  router.patch("/users/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Allow admin to edit anyone; operators/viewers can only edit themselves
      if (req.user!.role !== "ADMIN" && req.user!.id !== req.params.id) {
        return res.status(403).json({ error: "You can only edit your own profile" });
      }
      // Only admins can change roles
      if (req.body.role && req.user!.role !== "ADMIN") {
        return res.status(403).json({ error: "Only admins can change roles" });
      }
      const user = await authSvc.updateUser(req.params.id, req.body);
      res.json(user);
    } catch (err) { next(err); }
  });

  // POST /api/users/:id/password
  router.post("/users/:id/password", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user!.role !== "ADMIN" && req.user!.id !== req.params.id) {
        return res.status(403).json({ error: "You can only change your own password" });
      }
      const { currentPassword, newPassword } = req.body;
      if (!newPassword) return res.status(422).json({ error: "newPassword is required" });

      // Admins can change anyone's password without knowing the current one
      if (req.user!.role === "ADMIN" && req.user!.id !== req.params.id) {
        const hash = require("bcryptjs").hashSync(newPassword, 12);
        await prisma.user.update({ where: { id: req.params.id }, data: { passwordHash: hash } });
      } else {
        if (!currentPassword) return res.status(422).json({ error: "currentPassword is required" });
        await authSvc.changePassword(req.params.id, currentPassword, newPassword);
      }
      res.json({ success: true });
    } catch (err) {
      if (err instanceof Error && err.message === "Current password is incorrect") {
        return res.status(401).json({ error: err.message });
      }
      next(err);
    }
  });

  // DELETE /api/users/:id
  router.delete("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res, next) => {
    try {
      if (req.user!.id === req.params.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      await authSvc.deleteUser(req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  });

  return router;
}
