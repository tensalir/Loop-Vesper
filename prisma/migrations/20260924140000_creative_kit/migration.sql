-- The creative kit Vesper reads from the Loop Creative plugin, and the reference pictures it pins.
--
-- Additive and idempotent: apply with
--   npx prisma db execute --file prisma/migrations/20260924140000_creative_kit/migration.sql --schema prisma/schema.prisma
-- before deploying the code that reads it. Code from before this migration ignores every table here.
--
-- creative_kits: one row per kit.json blob Vesper has read, valid or refused, with the kit and its
-- conformance vectors; the newest valid row is what Vesper falls back to when GitHub is unreachable
-- or a new kit is refused.
-- creative_kit_files: the files a kit names, per blob sha, checked against the sha256 the kit gives.
-- creative_pins: each pinned reference picture, by its id and sha256: where its unchanged bytes and
-- its preview sit in the private bucket `creative-pins`, its derived copy when the original is too
-- large for a model, its Gemini Files API upload, and whether it may be used.

CREATE TABLE IF NOT EXISTS "creative_kits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "blob_sha" TEXT NOT NULL,
  "commit_sha" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "schema" INTEGER NOT NULL,
  "json" JSONB NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "valid" BOOLEAN NOT NULL DEFAULT true,
  "error" TEXT,
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_kits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "creative_kits_blob_sha_key" ON "creative_kits" ("blob_sha");
CREATE INDEX IF NOT EXISTS "creative_kits_valid_fetched_idx" ON "creative_kits" ("valid", "fetched_at" DESC);

CREATE TABLE IF NOT EXISTS "creative_kit_files" (
  "blob_sha" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "commit_sha" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "content" BYTEA NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_kit_files_pkey" PRIMARY KEY ("blob_sha")
);

CREATE TABLE IF NOT EXISTS "creative_pins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product" TEXT NOT NULL,
  "pin_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT,
  "sha256" TEXT NOT NULL,
  "bytes" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "mime" TEXT,
  "storage_path" TEXT,
  "preview_path" TEXT,
  "derived_path" TEXT,
  "derived_sha256" TEXT,
  "derived_recipe" JSONB,
  "gemini_file_uri" TEXT,
  "gemini_file_expires_at" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_pins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "creative_pins_pin_id_sha256_key" ON "creative_pins" ("pin_id", "sha256");
CREATE INDEX IF NOT EXISTS "creative_pins_product_idx" ON "creative_pins" ("product");
CREATE INDEX IF NOT EXISTS "creative_pins_gemini_expiry_idx" ON "creative_pins" ("gemini_file_expires_at");

DO $$ BEGIN
  ALTER TABLE "creative_pins" ADD CONSTRAINT "creative_pins_status_chk"
    CHECK ("status" IN ('pending', 'ok', 'sha_mismatch', 'missing', 'needs_upload', 'needs_derived', 'error'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Server-side only: nothing reads these through Supabase's public API.
ALTER TABLE "creative_kits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creative_kit_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creative_pins" ENABLE ROW LEVEL SECURITY;
