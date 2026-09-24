-- Per-person sign-in for the Claude connector (OAuth 2.1).
--
-- Additive and idempotent: apply with
--   npx prisma db execute --file prisma/migrations/20260924130000_mcp_oauth/migration.sql --schema prisma/schema.prisma
-- before deploying the code that reads it. Code from before this migration ignores every column
-- and table here.
--
-- One headless_credentials row per person and client (kind 'oauth', no token hash of its own):
-- the rate buckets, usage logs, async jobs and storage paths stay on that row across token
-- refreshes. The short-lived access tokens and rotating refresh tokens live in mcp_oauth_tokens,
-- hashed; the single-use authorization codes in mcp_oauth_codes, hashed.

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "mcp_access" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "headless_credentials"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'static',
  ADD COLUMN IF NOT EXISTS "oauth_client_id" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_client_name" TEXT,
  ADD COLUMN IF NOT EXISTS "oauth_client_key" TEXT,
  ADD COLUMN IF NOT EXISTS "subject_email" TEXT;

-- An OAuth credential has no bearer token of its own. The unique index stays; NULLs never collide.
ALTER TABLE "headless_credentials" ALTER COLUMN "token_hash" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "headless_credentials"
    ADD CONSTRAINT "headless_credentials_kind_chk" CHECK ("kind" IN ('static', 'oauth'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One live OAuth credential per person and client key (claude.ai, claude.com, loopback).
CREATE UNIQUE INDEX IF NOT EXISTS "headless_credentials_oauth_active_uq"
  ON "headless_credentials" ("owner_id", "oauth_client_key")
  WHERE "kind" = 'oauth' AND "revoked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "mcp_oauth_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code_hash" TEXT NOT NULL,
  "profile_id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "client_id" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "code_challenge" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_codes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_codes_code_hash_key" ON "mcp_oauth_codes" ("code_hash");
CREATE INDEX IF NOT EXISTS "mcp_oauth_codes_expires_at_idx" ON "mcp_oauth_codes" ("expires_at");
DO $$ BEGIN
  ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mcp_oauth_codes" ADD CONSTRAINT "mcp_oauth_codes_credential_id_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "headless_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "mcp_oauth_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "credential_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "family_id" UUID NOT NULL,
  "parent_id" UUID,
  "code_id" UUID,
  "client_id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "family_expires_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_oauth_tokens_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_kind_chk" CHECK ("kind" IN ('access', 'refresh'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_tokens_token_hash_key" ON "mcp_oauth_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "mcp_oauth_tokens_credential_id_idx" ON "mcp_oauth_tokens" ("credential_id");
CREATE INDEX IF NOT EXISTS "mcp_oauth_tokens_family_id_idx" ON "mcp_oauth_tokens" ("family_id");
CREATE INDEX IF NOT EXISTS "mcp_oauth_tokens_expires_at_idx" ON "mcp_oauth_tokens" ("expires_at");
DO $$ BEGIN
  ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_credential_id_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "headless_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mcp_oauth_tokens" ADD CONSTRAINT "mcp_oauth_tokens_code_id_fkey"
    FOREIGN KEY ("code_id") REFERENCES "mcp_oauth_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Only the service role reads these tables; nothing in the browser should.
ALTER TABLE "mcp_oauth_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mcp_oauth_tokens" ENABLE ROW LEVEL SECURITY;
