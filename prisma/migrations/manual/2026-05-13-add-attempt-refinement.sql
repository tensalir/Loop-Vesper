-- Manual additive migration applied via `prisma db execute`. Mirrors
-- the pattern established by `2026-05-12-add-cmf-access.sql`.
--
-- Adds the iterative-refinement fields to `cmf_render_attempts`:
--   refinement_prompt  — the freeform "what to change" copy a
--                        designer typed (e.g. "make the black more
--                        holographic"). The render service appends
--                        this to the spec-derived prompt with an
--                        explicit REFINEMENT INSTRUCTIONS section.
--   parent_attempt_id  — points at the attempt being refined so we
--                        can render a "refines #N" lineage subtitle
--                        on the gallery card and (later) a tree view.
--                        FK uses ON DELETE SET NULL so deleting an
--                        attempt doesn't cascade into refinements
--                        downstream.
--
-- No backfill: null on existing rows is exactly the right "this
-- attempt was not a refinement" signal. Idempotent via IF NOT EXISTS.

ALTER TABLE "cmf_render_attempts"
  ADD COLUMN IF NOT EXISTS "refinement_prompt" TEXT,
  ADD COLUMN IF NOT EXISTS "parent_attempt_id" UUID;

-- FK to the parent attempt. ON DELETE SET NULL — if a parent gets
-- pruned for any reason, downstream refinements survive but lose
-- their lineage pointer, which is the correct "history-preserving"
-- behaviour for an audit trail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'cmf_render_attempts_parent_attempt_id_fkey'
      AND table_name = 'cmf_render_attempts'
  ) THEN
    ALTER TABLE "cmf_render_attempts"
      ADD CONSTRAINT "cmf_render_attempts_parent_attempt_id_fkey"
      FOREIGN KEY ("parent_attempt_id")
      REFERENCES "cmf_render_attempts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- Index for the "show refinements of this attempt" lookup the gallery
-- + future lineage view needs.
CREATE INDEX IF NOT EXISTS "cmf_render_attempts_parent_attempt_id_idx"
  ON "cmf_render_attempts"("parent_attempt_id");
