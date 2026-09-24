-- MCP jobs run once; MCP draws are recorded as generations in the owner's "Claude" project.
-- Additive and idempotent: safe to run twice, and code from before this change ignores it.
-- Apply with: npx prisma db execute --file prisma/migrations/20260924120000_mcp_jobs_records/migration.sql --schema prisma/schema.prisma

ALTER TABLE headless_mcp_jobs
  ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS output_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS headless_mcp_jobs_owner_created_idx
  ON headless_mcp_jobs (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS headless_mcp_jobs_status_updated_idx
  ON headless_mcp_jobs (status, updated_at);

-- Queued rows written by the old code still carry `async: true`; running them
-- as stored would queue yet another job. Strip the flag so the sweeper runs them once.
UPDATE headless_mcp_jobs SET request = request - 'async' WHERE status = 'queued' AND request ? 'async';

ALTER TABLE projects ADD COLUMN IF NOT EXISTS system_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_system_key_uq
  ON projects (owner_id, system_key) WHERE system_key IS NOT NULL;
