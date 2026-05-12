-- Manual additive migration applied via `prisma db execute`, NOT via
-- `prisma db push` (which would also try to drop the `brand_worlds`
-- table that exists in the DB but is not modelled in Prisma). Mirrors
-- the pattern established by `2026-05-04-add-headless-access.sql`.
--
-- Adds the per-user `cmf_access` flag that gates WRITE access to the
-- CMF Studio (importing workbooks, editing SKUs, generating renders /
-- PDFs, approving attempts). Reads stay open to any authenticated
-- profile so the workbook + render library acts as a single
-- ground-truth visible to every teammate.
--
-- Defaults to false. Admins always have write access regardless of
-- the flag (the API-layer guard checks `role = 'admin' OR cmf_access`).
--
-- Backfill: grant `cmf_access = true` to every profile that already
-- owns or is an active member of any CMF packet, so nobody who was
-- working with CMF loses the ability to keep editing on rollout.

ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "cmf_access" BOOLEAN NOT NULL DEFAULT false;

UPDATE "profiles"
SET "cmf_access" = true
WHERE "id" IN (
  SELECT DISTINCT "owner_id" FROM "cmf_packets"
  UNION
  SELECT DISTINCT "user_id" FROM "cmf_packet_members"
)
AND "cmf_access" = false;

-- Smart-import lookup index: createPacketFromRows queries by
-- (cmf_code, productSlug-of-first-render) to decide whether to merge or
-- create a new packet. The cmf_code filter is the selective half so an
-- index on it keeps the lookup constant-time as the library grows past
-- a few hundred packets.
CREATE INDEX IF NOT EXISTS "cmf_packets_cmf_code_idx"
  ON "cmf_packets"("cmf_code");
