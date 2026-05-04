-- Manual additive migration applied via `prisma db execute`, NOT via
-- `prisma db push` (which would also try to drop the `brand_worlds`
-- table that exists in the DB but is not modelled in Prisma).
--
-- Adds the per-user `headless_access` flag that gates the private
-- `/headless` landing page. Defaults to false so no existing user
-- gains access automatically; admins still see the page implicitly
-- via their role. `IF NOT EXISTS` makes the statement idempotent.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "headless_access" BOOLEAN NOT NULL DEFAULT false;
