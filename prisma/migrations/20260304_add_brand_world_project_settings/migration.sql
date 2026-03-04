-- CreateTable
CREATE TABLE "brand_world_project_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "linked_by_user_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "brand_world_project_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_world_project_settings_project_id_key" ON "brand_world_project_settings"("project_id");

-- CreateIndex
CREATE INDEX "brand_world_project_settings_project_id_idx" ON "brand_world_project_settings"("project_id");

-- AddForeignKey
ALTER TABLE "brand_world_project_settings" ADD CONSTRAINT "brand_world_project_settings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_world_project_settings" ADD CONSTRAINT "brand_world_project_settings_linked_by_user_id_fkey" FOREIGN KEY ("linked_by_user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
