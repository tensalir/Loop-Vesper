-- CreateTable
CREATE TABLE "brand_worlds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" UUID NOT NULL,
    "source_project_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_worlds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_worlds_owner_id_idx" ON "brand_worlds"("owner_id");

-- CreateIndex
CREATE INDEX "brand_worlds_updated_at_idx" ON "brand_worlds"("updated_at" DESC);

-- AddForeignKey
ALTER TABLE "brand_worlds" ADD CONSTRAINT "brand_worlds_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_worlds" ADD CONSTRAINT "brand_worlds_source_project_id_fkey" FOREIGN KEY ("source_project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
