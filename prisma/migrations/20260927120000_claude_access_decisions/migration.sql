-- Claude access for Loop accounts on first connect, and an admin's decision that always wins.
--
-- Additive and idempotent: apply with
--   npx prisma db execute --file prisma/migrations/20260927120000_claude_access_decisions/migration.sql --schema prisma/schema.prisma
-- before deploying the code that reads it. Code from before this migration ignores every column
-- here. Nullable, no backfill.
--
-- mcp_access_decided_at / mcp_access_decided_by: set by the admin switch under Users (on or off).
--   A profile with a decision is never changed by automatic access, so someone an admin turned
--   off stays off. Rows from before this migration have no decision: anyone an admin switched
--   off before it should be switched off once more, which records the decision.
-- mcp_access_auto_granted_at: when Vesper turned mcp_access on by itself, the first time the
--   person connected Claude with a confirmed email on a CLAUDE_ACCESS_DOMAINS domain.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "mcp_access_decided_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mcp_access_decided_by" UUID,
  ADD COLUMN IF NOT EXISTS "mcp_access_auto_granted_at" TIMESTAMP(3);
