-- Manual additive migration applied via `prisma db execute`.
--
-- Adds the three tables backing the headless Vesper API + MCP server
-- (and the new self-service /api/me/headless-credential endpoint):
--
--   - headless_credentials (the per-credential bearer tokens)
--   - headless_usage_logs  (per-request audit log)
--   - headless_rate_buckets (durable per-credential rate-limit buckets)
--
-- These models exist in prisma/schema.prisma but were never pushed to
-- this database. We do NOT use `prisma db push` because it also wants
-- to drop the `brand_worlds` table (which has real user data) and
-- rewrite legacy `id` defaults on timeline_* tables; both are out of
-- scope here.
--
-- The whole script is idempotent: `IF NOT EXISTS` on tables and
-- indexes; constraint adds wrapped in DO blocks that check
-- information_schema first. Safe to re-run.

CREATE TABLE IF NOT EXISTS "headless_credentials" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_per_minute" INTEGER,
    "rate_limit_per_day" INTEGER,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "headless_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "headless_usage_logs" (
    "id" UUID NOT NULL,
    "credential_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "surface" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "tool_name" TEXT,
    "model_id" TEXT,
    "status" TEXT NOT NULL,
    "http_status" INTEGER NOT NULL,
    "error_category" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "cost_usd" DECIMAL(10,6),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "headless_usage_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "headless_rate_buckets" (
    "id" UUID NOT NULL,
    "credential_id" UUID NOT NULL,
    "window" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "headless_rate_buckets_pkey" PRIMARY KEY ("id")
);

-- Unique + secondary indexes.
CREATE UNIQUE INDEX IF NOT EXISTS "headless_credentials_token_hash_key"
    ON "headless_credentials"("token_hash");
CREATE INDEX IF NOT EXISTS "headless_credentials_owner_id_idx"
    ON "headless_credentials"("owner_id");
CREATE INDEX IF NOT EXISTS "headless_credentials_token_prefix_idx"
    ON "headless_credentials"("token_prefix");
CREATE INDEX IF NOT EXISTS "headless_credentials_revoked_at_idx"
    ON "headless_credentials"("revoked_at");

CREATE INDEX IF NOT EXISTS "headless_usage_logs_credential_id_created_at_idx"
    ON "headless_usage_logs"("credential_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "headless_usage_logs_owner_id_created_at_idx"
    ON "headless_usage_logs"("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "headless_usage_logs_status_idx"
    ON "headless_usage_logs"("status");
CREATE INDEX IF NOT EXISTS "headless_usage_logs_created_at_idx"
    ON "headless_usage_logs"("created_at" DESC);

CREATE INDEX IF NOT EXISTS "headless_rate_buckets_credential_id_window_idx"
    ON "headless_rate_buckets"("credential_id", "window");
CREATE INDEX IF NOT EXISTS "headless_rate_buckets_bucket_idx"
    ON "headless_rate_buckets"("bucket");
CREATE UNIQUE INDEX IF NOT EXISTS "headless_rate_buckets_credential_id_window_bucket_key"
    ON "headless_rate_buckets"("credential_id", "window", "bucket");

-- Foreign keys. Postgres doesn't have `ADD CONSTRAINT IF NOT EXISTS`,
-- so each ADD is wrapped in a DO block that checks the catalog first.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'headless_credentials_owner_id_fkey'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE "headless_credentials"
      ADD CONSTRAINT "headless_credentials_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "profiles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'headless_usage_logs_credential_id_fkey'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE "headless_usage_logs"
      ADD CONSTRAINT "headless_usage_logs_credential_id_fkey"
      FOREIGN KEY ("credential_id") REFERENCES "headless_credentials"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'headless_rate_buckets_credential_id_fkey'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE "headless_rate_buckets"
      ADD CONSTRAINT "headless_rate_buckets_credential_id_fkey"
      FOREIGN KEY ("credential_id") REFERENCES "headless_credentials"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
