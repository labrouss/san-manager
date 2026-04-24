// =============================================================================
// middleware/auth.middleware.ts
// Express middleware: verifies JWT, attaches user to request, enforces roles.
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/AuthService";
import { PrismaClient } from "@prisma/client";

// Extend Express Request with our user context
declare global {
  namespace Express {
    interface Request {
      user?: {
        id:       string;
        username: string;
        email:    string;
        role:     string;
      };
    }
  }
}

const authService = new AuthService(new PrismaClient());

// ---------------------------------------------------------------------------
// requireAuth — verifies the Bearer token and attaches req.user
// ---------------------------------------------------------------------------
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = authService.verifyToken(token);
    req.user = {
      id:       payload.sub,
      username: payload.username,
      email:    payload.email,
      role:     payload.role,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ---------------------------------------------------------------------------
// requireRole — role-based access control guard
// Usage: router.delete("/users/:id", requireAuth, requireRole("ADMIN"), handler)
// ---------------------------------------------------------------------------
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        error: `This action requires one of: ${roles.join(", ")}. Your role: ${req.user.role}`,
      });
      return;
    }
    next();
  };
}
