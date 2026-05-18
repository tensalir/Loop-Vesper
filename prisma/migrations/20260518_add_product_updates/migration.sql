-- CreateTable
CREATE TABLE "product_updates" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "snippets" JSONB NOT NULL DEFAULT '[]',
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "significance_score" DECIMAL(4, 3),
    "commit_range_start" TEXT,
    "commit_range_end" TEXT,
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_updates_slug_key" ON "product_updates"("slug");

-- CreateIndex
CREATE INDEX "product_updates_published_at_idx" ON "product_updates"("published_at" DESC);

-- CreateIndex
CREATE INDEX "product_updates_is_published_published_at_idx" ON "product_updates"("is_published", "published_at" DESC);

-- CreateIndex
CREATE INDEX "product_updates_commit_range_end_idx" ON "product_updates"("commit_range_end");

-- CreateTable
CREATE TABLE "user_product_update_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "update_id" UUID NOT NULL,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_product_update_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_product_update_views_user_id_update_id_key" ON "user_product_update_views"("user_id", "update_id");

-- CreateIndex
CREATE INDEX "user_product_update_views_user_id_idx" ON "user_product_update_views"("user_id");

-- CreateIndex
CREATE INDEX "user_product_update_views_update_id_idx" ON "user_product_update_views"("update_id");

-- AddForeignKey
ALTER TABLE "user_product_update_views" ADD CONSTRAINT "user_product_update_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_product_update_views" ADD CONSTRAINT "user_product_update_views_update_id_fkey" FOREIGN KEY ("update_id") REFERENCES "product_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
