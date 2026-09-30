-- CMF, one engine behind both doors: the web CMF Studio's render jobs.
--
-- Additive and idempotent: safe to run twice, and code from before this change ignores it. Apply it
-- after 20260930120000_cmf_team_records and before deploying the code that writes it:
--   npx prisma db execute --file prisma/migrations/20260930140000_cmf_web_jobs/migration.sql --schema prisma/schema.prisma
--
-- A render started in the web CMF Studio (POST /api/cmf/v2/render) is planned and refused in the
-- request, then drawn after the response (up to ~280 s); the page polls this row
-- (GET /api/cmf/v2/render/{job}). Claude's long calls have `headless_mcp_jobs`, which needs a
-- credential; the web has none. The render itself is recorded in the CMF team project like any
-- other; this row says only whether it is still running and what came of it. A row still running
-- counts towards its maker's daily image allowance, as Claude's running calls do.
CREATE TABLE IF NOT EXISTS "cmf_web_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_id" UUID NOT NULL,
  "tool_name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "output_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "cmf_web_jobs_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "cmf_web_jobs" ADD CONSTRAINT "cmf_web_jobs_owner_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cmf_web_jobs" ADD CONSTRAINT "cmf_web_jobs_status_chk" CHECK ("status" IN ('processing', 'completed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "cmf_web_jobs_owner_idx" ON "cmf_web_jobs" ("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cmf_web_jobs_status_idx" ON "cmf_web_jobs" ("status", "updated_at");

-- Vesper reads and writes it with the service role; no policy opens it to a browser.
ALTER TABLE "cmf_web_jobs" ENABLE ROW LEVEL SECURITY;
