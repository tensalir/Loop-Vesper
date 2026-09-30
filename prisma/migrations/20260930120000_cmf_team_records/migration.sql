-- CMF, one engine behind both doors: the CMF team's records.
--
-- Additive and idempotent: safe to run twice, and code from before this change ignores it. Apply it
-- before deploying the code that writes it:
--   npx prisma db execute --file prisma/migrations/20260930120000_cmf_team_records/migration.sql --schema prisma/schema.prisma
-- Then, once, the move of the renders Claude made so far (dry run first; see the script):
--   npx tsx scripts/cmf-team-project.ts
--   npx tsx scripts/cmf-team-project.ts --apply
--
-- 1. The CMF team project: one per deployment, `projects.system_key = 'cmf'`. Every CMF render from
--    Claude or the CMF Studio is recorded in it (src/lib/creative/cmf/team-records.ts). The index
--    below keeps it one; `projects_owner_system_key_uq` (20260924120000) still keeps one "Claude"
--    project per owner. The project is made by the first render, or by the script, and is owned by
--    whoever made it: projects cascade with their owner, so the owner should be a profile that is
--    never deleted (the script takes --owner; soft deletes, which Vesper uses, cascade nothing).
--    If two team projects exist already, this index fails: keep the older one (the code reads the
--    oldest), move the other's sessions into it, and run the file again.
CREATE UNIQUE INDEX IF NOT EXISTS projects_cmf_team_uq
  ON projects (system_key) WHERE system_key = 'cmf';

-- 2. cmf_supplier_pdfs: a row for every supplier PDF cmf_pdf saves, from either door. The storage
--    path and link, the upload and SKU columns it was made from, the renders and the clown key (its
--    sha256 and who confirmed it), the workbook's file, sha256 and modified time as the footer
--    prints them, the read-back check (only a clean one is ever saved), the kit, who made it,
--    through which door, and when. `import_id` keeps the upload's id even if the upload row goes.
CREATE TABLE IF NOT EXISTS "cmf_supplier_pdfs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "storage_path" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "import_id" UUID NOT NULL,
  "tab" TEXT NOT NULL,
  "sku_columns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sku_names" JSONB NOT NULL DEFAULT '{}',
  "output_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "key_id" TEXT NOT NULL,
  "key_sha256" TEXT NOT NULL,
  "key_confirmed_by" TEXT,
  "workbook_file" TEXT,
  "workbook_sha256" TEXT,
  "workbook_modified" TEXT,
  "check" JSONB NOT NULL,
  "renders" JSONB NOT NULL DEFAULT '[]',
  "kit_version" TEXT,
  "kit_tag" TEXT,
  "kit_commit" TEXT,
  "made_by" UUID NOT NULL,
  "credential_id" UUID,
  "door" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cmf_supplier_pdfs_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "cmf_supplier_pdfs" ADD CONSTRAINT "cmf_supplier_pdfs_made_by_fkey"
    FOREIGN KEY ("made_by") REFERENCES "profiles" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cmf_supplier_pdfs" ADD CONSTRAINT "cmf_supplier_pdfs_credential_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "headless_credentials" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "cmf_supplier_pdfs" ADD CONSTRAINT "cmf_supplier_pdfs_door_chk" CHECK ("door" IN ('mcp', 'web'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "cmf_supplier_pdfs_created_idx" ON "cmf_supplier_pdfs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "cmf_supplier_pdfs_import_idx" ON "cmf_supplier_pdfs" ("import_id", "created_at" DESC);

-- Vesper reads and writes it with the service role; no policy opens it to a browser.
ALTER TABLE "cmf_supplier_pdfs" ENABLE ROW LEVEL SECURITY;
