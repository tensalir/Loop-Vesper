-- CreateTable
CREATE TABLE "product_renders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "colorway" TEXT,
    "image_url" TEXT NOT NULL,
    "storage_path" TEXT,
    "source" TEXT NOT NULL DEFAULT 'local',
    "frontify_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_renders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_renders_name_idx" ON "product_renders"("name");

-- CreateIndex
CREATE INDEX "product_renders_source_idx" ON "product_renders"("source");

