-- CMF (Color, Material, Finishing) Product Designer Workflow
-- Adds: cmf_clown_assets, cmf_imports, cmf_packets, cmf_renders
-- All tables are owned per-Profile; ownership checks happen at the API layer.

-- CreateTable: cmf_clown_assets
CREATE TABLE IF NOT EXISTS "cmf_clown_assets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "product_slug" TEXT NOT NULL,
    "variant_slug" TEXT NOT NULL DEFAULT 'default',
    "label" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "components" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmf_clown_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cmf_clown_assets_owner_id_product_slug_variant_slug_key"
    ON "cmf_clown_assets"("owner_id", "product_slug", "variant_slug");
CREATE INDEX IF NOT EXISTS "cmf_clown_assets_owner_id_idx" ON "cmf_clown_assets"("owner_id");
CREATE INDEX IF NOT EXISTS "cmf_clown_assets_product_slug_idx" ON "cmf_clown_assets"("product_slug");

ALTER TABLE "cmf_clown_assets"
ADD CONSTRAINT "cmf_clown_assets_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: cmf_imports
CREATE TABLE IF NOT EXISTS "cmf_imports" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT,
    "raw_rows" JSONB NOT NULL,
    "parsed_rows" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errors" JSONB,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmf_imports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cmf_imports_owner_id_idx" ON "cmf_imports"("owner_id");
CREATE INDEX IF NOT EXISTS "cmf_imports_owner_id_created_at_idx"
    ON "cmf_imports"("owner_id", "created_at" DESC);

ALTER TABLE "cmf_imports"
ADD CONSTRAINT "cmf_imports_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: cmf_packets
CREATE TABLE IF NOT EXISTS "cmf_packets" (
    "id" UUID NOT NULL,
    "import_id" UUID,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cmf_code" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pdf_url" TEXT,
    "pdf_path" TEXT,
    "pdf_error" TEXT,
    "generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmf_packets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cmf_packets_owner_id_idx" ON "cmf_packets"("owner_id");
CREATE INDEX IF NOT EXISTS "cmf_packets_owner_id_created_at_idx"
    ON "cmf_packets"("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cmf_packets_status_idx" ON "cmf_packets"("status");

ALTER TABLE "cmf_packets"
ADD CONSTRAINT "cmf_packets_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_packets"
ADD CONSTRAINT "cmf_packets_import_id_fkey"
FOREIGN KEY ("import_id") REFERENCES "cmf_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: cmf_renders
CREATE TABLE IF NOT EXISTS "cmf_renders" (
    "id" UUID NOT NULL,
    "packet_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "product_code" TEXT,
    "ean" TEXT,
    "product_slug" TEXT NOT NULL,
    "variant_slug" TEXT NOT NULL DEFAULT 'default',
    "colorway_name" TEXT,
    "clown_asset_id" UUID,
    "component_specs" JSONB NOT NULL DEFAULT '[]',
    "palette_swatches" JSONB NOT NULL DEFAULT '[]',
    "model_id" TEXT,
    "base_prompt" TEXT,
    "enhanced_prompt" TEXT,
    "render_url" TEXT,
    "render_path" TEXT,
    "render_width" INTEGER,
    "render_height" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "error" TEXT,
    "cost_usd" DECIMAL(10,6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmf_renders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cmf_renders_packet_id_idx" ON "cmf_renders"("packet_id");
CREATE INDEX IF NOT EXISTS "cmf_renders_packet_id_sort_order_idx"
    ON "cmf_renders"("packet_id", "sort_order");
CREATE INDEX IF NOT EXISTS "cmf_renders_owner_id_idx" ON "cmf_renders"("owner_id");
CREATE INDEX IF NOT EXISTS "cmf_renders_status_idx" ON "cmf_renders"("status");

ALTER TABLE "cmf_renders"
ADD CONSTRAINT "cmf_renders_packet_id_fkey"
FOREIGN KEY ("packet_id") REFERENCES "cmf_packets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_renders"
ADD CONSTRAINT "cmf_renders_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_renders"
ADD CONSTRAINT "cmf_renders_clown_asset_id_fkey"
FOREIGN KEY ("clown_asset_id") REFERENCES "cmf_clown_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS posture: API enforces owner_id scoping on every read/write through Prisma.
-- Service-role-only access at the storage layer; no anon policies are added.
