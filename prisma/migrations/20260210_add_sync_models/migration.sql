-- CreateTable
CREATE TABLE "sync_links" (
    "id" UUID NOT NULL,
    "monday_item_id" TEXT,
    "monday_board_id" TEXT,
    "figma_file_key" TEXT,
    "figma_node_id" TEXT,
    "frontify_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_events" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "link_id" UUID,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_revisions" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "id" UUID NOT NULL,
    "integration" TEXT NOT NULL,
    "cursor_key" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sync_events_idempotency_key_key" ON "sync_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "sync_events_link_id_occurred_at_idx" ON "sync_events"("link_id", "occurred_at");

-- CreateIndex
CREATE INDEX "sync_events_source_external_id_idx" ON "sync_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "sync_events_occurred_at_idx" ON "sync_events"("occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sync_links_monday_item_id_monday_board_id_key" ON "sync_links"("monday_item_id", "monday_board_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_links_figma_file_key_figma_node_id_key" ON "sync_links"("figma_file_key", "figma_node_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_links_frontify_asset_id_key" ON "sync_links"("frontify_asset_id");

-- CreateIndex
CREATE INDEX "sync_links_monday_item_id_idx" ON "sync_links"("monday_item_id");

-- CreateIndex
CREATE INDEX "sync_links_figma_file_key_idx" ON "sync_links"("figma_file_key");

-- CreateIndex
CREATE INDEX "sync_links_frontify_asset_id_idx" ON "sync_links"("frontify_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_revisions_link_id_source_key" ON "sync_revisions"("link_id", "source");

-- CreateIndex
CREATE INDEX "sync_revisions_link_id_idx" ON "sync_revisions"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_integration_cursor_key_key" ON "sync_cursors"("integration", "cursor_key");

-- CreateIndex
CREATE INDEX "sync_cursors_integration_idx" ON "sync_cursors"("integration");

-- AddForeignKey
ALTER TABLE "sync_events" ADD CONSTRAINT "sync_events_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "sync_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_revisions" ADD CONSTRAINT "sync_revisions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "sync_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
