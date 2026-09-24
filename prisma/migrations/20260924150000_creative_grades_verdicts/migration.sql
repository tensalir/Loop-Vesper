-- What Vesper keeps of the creative work: every grade and every decider's answer.
--
-- Additive and idempotent: apply with
--   npx prisma db execute --file prisma/migrations/20260924150000_creative_grades_verdicts/migration.sql --schema prisma/schema.prisma
-- before deploying the code that writes them. Code from before this migration ignores both tables.
--
-- creative_grades: one row per grade of one picture. `judge` says whose: 'vesper' (Vesper's scripted
-- reads, `judge <model> vesper x<reads>`) or 'chat' (Claude's own look, recorded with record_grade).
-- The two are never pooled. `runs` keeps each read; `fails` counts, per check, the reads that failed it.
-- creative_verdicts: one row per answer a decider gave, attributed to the signed-in person, with the
-- grade it answers and, for a picture in Frontify, the comment line the person's connector posts.

CREATE TABLE IF NOT EXISTS "creative_grades" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product" TEXT NOT NULL,
  "owner_id" UUID NOT NULL,
  "credential_id" UUID,
  "output_id" UUID,
  "image_url" TEXT,
  "frontify_asset_id" TEXT,
  "image_sha256" TEXT NOT NULL,
  "colourway" TEXT,
  "view" TEXT,
  "view_assumed" BOOLEAN NOT NULL DEFAULT false,
  "claim_source" TEXT,
  "judge" TEXT NOT NULL,
  "judge_model" TEXT,
  "reads" INTEGER NOT NULL,
  "template_id" TEXT,
  "kit_version" TEXT NOT NULL,
  "kit_commit" TEXT NOT NULL,
  "rubric_version" TEXT NOT NULL,
  "runs" JSONB NOT NULL,
  "fails" JSONB NOT NULL,
  "failed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "failed_advisory" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "verdict" TEXT NOT NULL,
  "verdict_majority" TEXT,
  "unstable" BOOLEAN NOT NULL DEFAULT false,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "references" JSONB NOT NULL DEFAULT '[]',
  "latency_ms" INTEGER,
  "cost_usd" DECIMAL(10, 6),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_grades_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "creative_grades" ADD CONSTRAINT "creative_grades_owner_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "profiles" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_grades" ADD CONSTRAINT "creative_grades_credential_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "headless_credentials" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_grades" ADD CONSTRAINT "creative_grades_output_fkey"
    FOREIGN KEY ("output_id") REFERENCES "outputs" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_grades" ADD CONSTRAINT "creative_grades_judge_chk" CHECK ("judge" IN ('vesper', 'chat'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "creative_grades_output_idx" ON "creative_grades" ("output_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "creative_grades_product_idx" ON "creative_grades" ("product", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "creative_grades_sha_idx" ON "creative_grades" ("image_sha256");
CREATE INDEX IF NOT EXISTS "creative_grades_frontify_idx" ON "creative_grades" ("frontify_asset_id");
CREATE INDEX IF NOT EXISTS "creative_grades_created_idx" ON "creative_grades" ("created_at");

CREATE TABLE IF NOT EXISTS "creative_verdicts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product" TEXT NOT NULL,
  "profile_id" UUID NOT NULL,
  "credential_id" UUID,
  "grade_id" UUID,
  "output_id" UUID,
  "image_url" TEXT,
  "frontify_asset_id" TEXT,
  "image_sha256" TEXT,
  "answer" TEXT NOT NULL,
  "remark" TEXT,
  "decoded" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "decoded_unconfirmed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "route" TEXT NOT NULL,
  "comment_line" TEXT,
  "kit_version" TEXT NOT NULL,
  "rubric_version" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "creative_verdicts_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "creative_verdicts" ADD CONSTRAINT "creative_verdicts_profile_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "profiles" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_verdicts" ADD CONSTRAINT "creative_verdicts_credential_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "headless_credentials" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_verdicts" ADD CONSTRAINT "creative_verdicts_grade_fkey"
    FOREIGN KEY ("grade_id") REFERENCES "creative_grades" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_verdicts" ADD CONSTRAINT "creative_verdicts_output_fkey"
    FOREIGN KEY ("output_id") REFERENCES "outputs" ("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_verdicts" ADD CONSTRAINT "creative_verdicts_answer_chk" CHECK ("answer" IN ('yes', 'no'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "creative_verdicts" ADD CONSTRAINT "creative_verdicts_route_chk" CHECK ("route" IN ('frontify-comment', 'vesper'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "creative_verdicts_product_idx" ON "creative_verdicts" ("product", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "creative_verdicts_created_idx" ON "creative_verdicts" ("created_at");

ALTER TABLE "creative_grades" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "creative_verdicts" ENABLE ROW LEVEL SECURITY;
