-- CMF clown assets become global / shared across the workspace.
--
-- Before: clowns were per-Profile and uniquely keyed on (owner_id,
-- product_slug, variant_slug). Each user maintained their own library.
--
-- After: there is exactly one canonical clown per (product_slug, variant_slug).
-- `owner_id` survives as a nullable audit column ("uploaded by") so we know who
-- contributed each asset, but reads and writes are no longer scoped by it.
-- The FK action also relaxes from CASCADE to SET NULL — deleting a profile
-- must not vapourise a canonical clown that the rest of the workspace depends
-- on.

-- 1. Defensive dedupe: if any pre-existing rows already collide on the new
-- key, keep the most recently created one. The current production library is
-- effectively empty, but we run this anyway so the unique index can be created
-- on any environment.
DELETE FROM "cmf_clown_assets" a
USING "cmf_clown_assets" b
WHERE a.product_slug = b.product_slug
  AND a.variant_slug = b.variant_slug
  AND (a.created_at < b.created_at
       OR (a.created_at = b.created_at AND a.id < b.id));

-- 2. Allow owner_id to be NULL (seed rows have no contributor).
ALTER TABLE "cmf_clown_assets" ALTER COLUMN "owner_id" DROP NOT NULL;

-- 3. Replace the FK so deleting a profile doesn't cascade-delete shared
-- clowns. Postgres can't ALTER a constraint in place; drop and re-add.
ALTER TABLE "cmf_clown_assets"
  DROP CONSTRAINT IF EXISTS "cmf_clown_assets_owner_id_fkey";
ALTER TABLE "cmf_clown_assets"
  ADD CONSTRAINT "cmf_clown_assets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Swap the unique index from per-owner to global.
DROP INDEX IF EXISTS "cmf_clown_assets_owner_id_product_slug_variant_slug_key";
CREATE UNIQUE INDEX IF NOT EXISTS "cmf_clown_assets_product_slug_variant_slug_key"
  ON "cmf_clown_assets"("product_slug", "variant_slug");
