-- CreateTable
CREATE TABLE "output_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "output_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "output_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "output_events_output_id_idx" ON "output_events"("output_id");

-- CreateIndex
CREATE INDEX "output_events_user_id_idx" ON "output_events"("user_id");

-- CreateIndex
CREATE INDEX "output_events_event_type_idx" ON "output_events"("event_type");

-- CreateIndex
CREATE INDEX "output_events_created_at_idx" ON "output_events"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "output_events" ADD CONSTRAINT "output_events_output_id_fkey" FOREIGN KEY ("output_id") REFERENCES "outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "output_events" ADD CONSTRAINT "output_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
