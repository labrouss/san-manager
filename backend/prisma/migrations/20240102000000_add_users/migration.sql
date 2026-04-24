-- Migration: 20240102000000_add_users
-- Adds the users table for authentication

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

CREATE TABLE "users" (
  "id"            TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "email"         TEXT NOT NULL,
  "username"      TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role"          "UserRole" NOT NULL DEFAULT 'OPERATOR',
  "is_active"     BOOLEAN NOT NULL DEFAULT true,
  "last_login_at" TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key"    ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
