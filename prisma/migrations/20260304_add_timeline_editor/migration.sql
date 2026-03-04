-- Timeline Editor Models

CREATE TABLE "timeline_sequences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "session_id" UUID,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Untitled Sequence',
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "fps" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "timeline_sequences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_tracks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sequence_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Track',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_muted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "timeline_tracks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_clips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "track_id" UUID NOT NULL,
    "output_id" UUID,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "in_point_ms" INTEGER NOT NULL DEFAULT 0,
    "out_point_ms" INTEGER NOT NULL,
    "source_duration_ms" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "timeline_clips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sequence_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'cross_dissolve',
    "from_clip_id" UUID NOT NULL,
    "to_clip_id" UUID NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 500,
    CONSTRAINT "timeline_transitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_captions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "track_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "style" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "timeline_captions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "timeline_render_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sequence_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "resolution" INTEGER NOT NULL DEFAULT 1080,
    "snapshot_json" JSONB,
    "output_url" TEXT,
    "output_id" UUID,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "timeline_render_jobs_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "timeline_sequences_project_id_idx" ON "timeline_sequences"("project_id");
CREATE INDEX "timeline_sequences_user_id_idx" ON "timeline_sequences"("user_id");
CREATE INDEX "timeline_sequences_project_id_updated_at_idx" ON "timeline_sequences"("project_id", "updated_at" DESC);

CREATE INDEX "timeline_tracks_sequence_id_idx" ON "timeline_tracks"("sequence_id");
CREATE INDEX "timeline_tracks_sequence_id_sort_order_idx" ON "timeline_tracks"("sequence_id", "sort_order");

CREATE INDEX "timeline_clips_track_id_idx" ON "timeline_clips"("track_id");
CREATE INDEX "timeline_clips_track_id_start_ms_idx" ON "timeline_clips"("track_id", "start_ms");

CREATE INDEX "timeline_transitions_sequence_id_idx" ON "timeline_transitions"("sequence_id");

CREATE INDEX "timeline_captions_track_id_idx" ON "timeline_captions"("track_id");
CREATE INDEX "timeline_captions_track_id_start_ms_idx" ON "timeline_captions"("track_id", "start_ms");

CREATE INDEX "timeline_render_jobs_sequence_id_idx" ON "timeline_render_jobs"("sequence_id");
CREATE INDEX "timeline_render_jobs_user_id_idx" ON "timeline_render_jobs"("user_id");
CREATE INDEX "timeline_render_jobs_status_idx" ON "timeline_render_jobs"("status");

-- Foreign keys
ALTER TABLE "timeline_sequences" ADD CONSTRAINT "timeline_sequences_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_sequences" ADD CONSTRAINT "timeline_sequences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_tracks" ADD CONSTRAINT "timeline_tracks_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "timeline_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_clips" ADD CONSTRAINT "timeline_clips_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "timeline_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_transitions" ADD CONSTRAINT "timeline_transitions_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "timeline_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_captions" ADD CONSTRAINT "timeline_captions_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "timeline_tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timeline_render_jobs" ADD CONSTRAINT "timeline_render_jobs_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "timeline_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timeline_render_jobs" ADD CONSTRAINT "timeline_render_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
