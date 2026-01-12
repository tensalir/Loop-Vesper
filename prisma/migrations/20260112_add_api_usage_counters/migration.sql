-- CreateTable
CREATE TABLE "api_usage_counters" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_usage_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_usage_counters_provider_scope_window_bucket_key" ON "api_usage_counters"("provider", "scope", "window", "bucket");

-- CreateIndex
CREATE INDEX "api_usage_counters_provider_scope_idx" ON "api_usage_counters"("provider", "scope");

-- CreateIndex
CREATE INDEX "api_usage_counters_bucket_idx" ON "api_usage_counters"("bucket");
