-- CreateTable
CREATE TABLE "pinned_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "image_url" TEXT NOT NULL,
    "label" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinned_by" UUID NOT NULL,

    CONSTRAINT "pinned_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pinned_images_project_id_idx" ON "pinned_images"("project_id");

-- CreateIndex
CREATE INDEX "pinned_images_project_id_sort_order_idx" ON "pinned_images"("project_id", "sort_order");

-- AddForeignKey
ALTER TABLE "pinned_images" ADD CONSTRAINT "pinned_images_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_images" ADD CONSTRAINT "pinned_images_pinned_by_fkey" FOREIGN KEY ("pinned_by") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
