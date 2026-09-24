-- Grant Claude-connector access (profiles.mcp_access) to the first people.
--
-- Run after 20260924130000_mcp_oauth. Idempotent. Admins pass without the flag.
-- Replace the placeholder with the owner's list: the people of the first wave (the owner, the
-- studio, Damien). Profiles are keyed by the Supabase auth user id; the email lives in auth.users.
--
--   npx prisma db execute --file prisma/migrations/manual/2026-09-24-grant-mcp-access.sql --schema prisma/schema.prisma

UPDATE "profiles" p
SET "mcp_access" = true
FROM auth.users u
WHERE u.id = p.id
  AND lower(u.email) IN (
    'someone@loopearplugs.com'   -- placeholder: replace with the owner's list
  );
