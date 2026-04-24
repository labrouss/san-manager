// =============================================================================
// services/AuthService.ts
// JWT-based authentication with bcrypt password hashing.
// Tokens are short-lived (8h); no refresh tokens needed for an internal tool.
// =============================================================================

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import logger from "../config/logger";

const JWT_SECRET  = process.env.JWT_SECRET ?? "san-platform-dev-secret-change-in-production";
const JWT_EXPIRES = process.env.JWT_EXPIRES ?? "8h";
const SALT_ROUNDS = 12;

export interface TokenPayload {
  sub:      string;   // user id
  username: string;
  email:    string;
  role:     string;
  iat:      number;
  exp:      number;
}

export interface AuthResult {
  token:    string;
  user: {
    id:       string;
    username: string;
    email:    string;
    role:     string;
  };
}

export class AuthService {
  constructor(private readonly prisma: PrismaClient) {}

  // ── Registration ────────────────────────────────────────────────────────────

  async createUser(
    username: string,
    email: string,
    password: string,
    role: "ADMIN" | "OPERATOR" | "VIEWER" = "OPERATOR"
  ) {
    if (password.length < 8) throw new Error("Password must be at least 8 characters");

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await this.prisma.user.create({
      data: { username: username.trim(), email: email.trim().toLowerCase(), passwordHash, role },
      select: { id: true, username: true, email: true, role: true, createdAt: true, isActive: true },
    });
    logger.info({ userId: user.id, username: user.username, role }, "User created");
    return user;
  }

  // ── Login ───────────────────────────────────────────────────────────────────

  async login(usernameOrEmail: string, password: string): Promise<AuthResult> {
    const identifier = usernameOrEmail.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: identifier, mode: "insensitive" } },
          { email:    identifier },
        ],
        isActive: true,
      },
    });

    if (!user) throw new Error("Invalid credentials");

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new Error("Invalid credentials");

    // Update lastLoginAt
    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    const token = jwt.sign(
      { sub: user.id, username: user.username, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES } as jwt.SignOptions
    );

    logger.info({ userId: user.id, username: user.username }, "User logged in");
    return {
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    };
  }

  // ── Token verification ──────────────────────────────────────────────────────

  verifyToken(token: string): TokenPayload {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  }

  // ── User management ─────────────────────────────────────────────────────────

  async listUsers() {
    return this.prisma.user.findMany({
      select: { id: true, username: true, email: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateUser(
    id: string,
    data: { username?: string; email?: string; role?: "ADMIN" | "OPERATOR" | "VIEWER"; isActive?: boolean }
  ) {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.username  && { username:  data.username.trim() }),
        ...(data.email     && { email:     data.email.trim().toLowerCase() }),
        ...(data.role      && { role:      data.role }),
        ...(data.isActive  !== undefined && { isActive: data.isActive }),
      },
      select: { id: true, username: true, email: true, role: true, isActive: true },
    });
    return user;
  }

  async changePassword(id: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new Error("Current password is incorrect");
    if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    logger.info({ userId: id }, "Password changed");
  }

  async deleteUser(id: string) {
    await this.prisma.user.delete({ where: { id } });
    logger.info({ userId: id }, "User deleted");
  }

  // ── Bootstrap: create default admin if no users exist ──────────────────────

  async ensureDefaultAdmin() {
    const count = await this.prisma.user.count();
    if (count > 0) return;

    const defaultPassword = process.env.ADMIN_PASSWORD ?? "Admin1234!";
    await this.createUser("admin", "admin@san-platform.local", defaultPassword, "ADMIN");
    logger.warn(
      { password: defaultPassword },
      "Default admin user created — change this password immediately!"
    );
  }
}
