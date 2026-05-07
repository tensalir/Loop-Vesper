-- CMF Layer 1 Collaboration: packet members, comments, activity log.
-- All tables are scoped to a packet via FK; access checks happen at the
-- API layer (owner OR member) since the rest of the CMF tables already
-- follow that pattern.

-- CreateTable: cmf_packet_members
CREATE TABLE IF NOT EXISTS "cmf_packet_members" (
    "id" UUID NOT NULL,
    "packet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "invited_by" UUID NOT NULL,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),

    CONSTRAINT "cmf_packet_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cmf_packet_members_packet_id_user_id_key"
    ON "cmf_packet_members"("packet_id", "user_id");
CREATE INDEX IF NOT EXISTS "cmf_packet_members_packet_id_idx"
    ON "cmf_packet_members"("packet_id");
CREATE INDEX IF NOT EXISTS "cmf_packet_members_user_id_idx"
    ON "cmf_packet_members"("user_id");

ALTER TABLE "cmf_packet_members"
ADD CONSTRAINT "cmf_packet_members_packet_id_fkey"
FOREIGN KEY ("packet_id") REFERENCES "cmf_packets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_packet_members"
ADD CONSTRAINT "cmf_packet_members_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_packet_members"
ADD CONSTRAINT "cmf_packet_members_invited_by_fkey"
FOREIGN KEY ("invited_by") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: cmf_comments
CREATE TABLE IF NOT EXISTS "cmf_comments" (
    "id" UUID NOT NULL,
    "packet_id" UUID NOT NULL,
    "render_id" UUID,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmf_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cmf_comments_packet_id_created_at_idx"
    ON "cmf_comments"("packet_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cmf_comments_render_id_idx"
    ON "cmf_comments"("render_id");
CREATE INDEX IF NOT EXISTS "cmf_comments_user_id_idx"
    ON "cmf_comments"("user_id");

ALTER TABLE "cmf_comments"
ADD CONSTRAINT "cmf_comments_packet_id_fkey"
FOREIGN KEY ("packet_id") REFERENCES "cmf_packets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_comments"
ADD CONSTRAINT "cmf_comments_render_id_fkey"
FOREIGN KEY ("render_id") REFERENCES "cmf_renders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_comments"
ADD CONSTRAINT "cmf_comments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_comments"
ADD CONSTRAINT "cmf_comments_resolved_by_fkey"
FOREIGN KEY ("resolved_by") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: cmf_activity
CREATE TABLE IF NOT EXISTS "cmf_activity" (
    "id" UUID NOT NULL,
    "packet_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmf_activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cmf_activity_packet_id_created_at_idx"
    ON "cmf_activity"("packet_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "cmf_activity_user_id_created_at_idx"
    ON "cmf_activity"("user_id", "created_at" DESC);

ALTER TABLE "cmf_activity"
ADD CONSTRAINT "cmf_activity_packet_id_fkey"
FOREIGN KEY ("packet_id") REFERENCES "cmf_packets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cmf_activity"
ADD CONSTRAINT "cmf_activity_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: ownership/membership is enforced at the API layer; tables stay
-- service-role-only on the storage side, mirroring the rest of CMF.
