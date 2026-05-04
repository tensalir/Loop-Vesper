-- Headless Vesper API + MCP credentials, audit log, and durable rate buckets.
-- Scoped machine-to-machine credentials owned by Profiles. Provider keys are
-- never exposed to external callers; they receive `vsp_...` bearer tokens.

-- CreateTable: headless_credentials
CREATE TABLE "headless_credentials" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rate_limit_per_minute" INTEGER,
    "rate_limit_per_day" INTEGER,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "headless_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "headless_credentials_token_hash_key" ON "headless_credentials"("token_hash");
CREATE INDEX "headless_credentials_owner_id_idx" ON "headless_credentials"("owner_id");
CREATE INDEX "headless_credentials_token_prefix_idx" ON "headless_credentials"("token_prefix");
CREATE INDEX "headless_credentials_revoked_at_idx" ON "headless_credentials"("revoked_at");

-- AddForeignKey
ALTER TABLE "headless_credentials"
ADD CONSTRAINT "headless_credentials_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: headless_usage_logs
CREATE TABLE "headless_usage_logs" (
    "id" UUID NOT NULL,
    "credential_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "surface" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "tool_name" TEXT,
    "model_id" TEXT,
    "status" TEXT NOT NULL,
    "http_status" INTEGER NOT NULL,
    "error_category" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "cost_usd" DECIMAL(10,6),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "headless_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "headless_usage_logs_credential_id_created_at_idx"
    ON "headless_usage_logs"("credential_id", "created_at" DESC);
CREATE INDEX "headless_usage_logs_owner_id_created_at_idx"
    ON "headless_usage_logs"("owner_id", "created_at" DESC);
CREATE INDEX "headless_usage_logs_status_idx" ON "headless_usage_logs"("status");
CREATE INDEX "headless_usage_logs_created_at_idx"
    ON "headless_usage_logs"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "headless_usage_logs"
ADD CONSTRAINT "headless_usage_logs_credential_id_fkey"
FOREIGN KEY ("credential_id") REFERENCES "headless_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: headless_rate_buckets
CREATE TABLE "headless_rate_buckets" (
    "id" UUID NOT NULL,
    "credential_id" UUID NOT NULL,
    "window" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "headless_rate_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "headless_rate_buckets_credential_id_window_bucket_key"
    ON "headless_rate_buckets"("credential_id", "window", "bucket");
CREATE INDEX "headless_rate_buckets_credential_id_window_idx"
    ON "headless_rate_buckets"("credential_id", "window");
CREATE INDEX "headless_rate_buckets_bucket_idx"
    ON "headless_rate_buckets"("bucket");

-- AddForeignKey
ALTER TABLE "headless_rate_buckets"
ADD CONSTRAINT "headless_rate_buckets_credential_id_fkey"
FOREIGN KEY ("credential_id") REFERENCES "headless_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
