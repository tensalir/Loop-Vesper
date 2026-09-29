-- Feedback on the Loop Creative plugin, filed from Claude as GitHub issues through Vesper's App.
--
-- Additive and idempotent: apply with
--   npx prisma db execute --file prisma/migrations/20260924160000_feedback_submissions/migration.sql --schema prisma/schema.prisma
-- before deploying the code that reads it. Code from before this migration ignores the table.
--
-- feedback_submissions: one row per preview a person made (status previewed), taken to filing when
-- they said yes (filing), and its outcome (filed, labels_failed, failed). The per-person limits count
-- here (20 previews an hour; 5 filed an hour and 20 a day), and preview_hash, the sha256 of the
-- rendered issue, is unique, so the same preview is filed at most once.

CREATE TABLE IF NOT EXISTS "feedback_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "preview_hash" TEXT NOT NULL,
  "profile_id" UUID NOT NULL,
  "credential_id" UUID,
  "repo" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "issue_number" INTEGER,
  "comment_id" BIGINT,
  "title" TEXT,
  "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "target" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "surface" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'previewed',
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "filed_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "feedback_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "feedback_submissions_preview_hash_key" ON "feedback_submissions" ("preview_hash");
CREATE INDEX IF NOT EXISTS "feedback_submissions_profile_created_idx" ON "feedback_submissions" ("profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "feedback_submissions_profile_filed_idx" ON "feedback_submissions" ("profile_id", "filed_at");

DO $$ BEGIN
  ALTER TABLE "feedback_submissions"
    ADD CONSTRAINT "feedback_submissions_profile_id_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_status_chk"
    CHECK ("status" IN ('previewed', 'filing', 'filed', 'labels_failed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_mode_chk"
    CHECK ("mode" IN ('issue', 'comment'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "feedback_submissions" ENABLE ROW LEVEL SECURITY;
