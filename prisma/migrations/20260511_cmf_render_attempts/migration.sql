-- CMF render attempts + packet document draft.
--
-- Before: each CmfRender held a single render image. Re-running a SKU
-- overwrote the previous image, which made it impossible to compare
-- Nano Banana attempts or roll back to a previously-approved render.
--
-- After: each CmfRender fans out to many CmfRenderAttempts. Approval is
-- separate from generation lifecycle (completed != approved). The packet
-- gains a `document_draft` JSON column so designers can adjust layout,
-- labels, ordering, and palette overrides in the HTML preview before
-- exporting the PDF, without touching the workbook source-of-truth.

-- 1. cmf_render_attempts
CREATE TABLE IF NOT EXISTS "cmf_render_attempts" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "render_id"        UUID NOT NULL,
  "attempt_number"   INTEGER NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'queued',
  "approval_status"  TEXT NOT NULL DEFAULT 'pending',

  "base_prompt"      TEXT,
  "enhanced_prompt"  TEXT,
  "model_id"         TEXT,

  "image_url"        TEXT,
  "image_path"       TEXT,
  "image_width"      INTEGER,
  "image_height"     INTEGER,

  "error"            TEXT,
  "cost_usd"         DECIMAL(10, 6),

  "triggered_by"     UUID,
  "approved_by"      UUID,
  "approved_at"      TIMESTAMP(3),
  "archived_at"      TIMESTAMP(3),

  "started_at"       TIMESTAMP(3),
  "completed_at"     TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cmf_render_attempts_render_id_fkey"
    FOREIGN KEY ("render_id") REFERENCES "cmf_renders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cmf_render_attempts_render_id_attempt_number_key"
  ON "cmf_render_attempts"("render_id", "attempt_number");

CREATE INDEX IF NOT EXISTS "cmf_render_attempts_render_id_idx"
  ON "cmf_render_attempts"("render_id");

CREATE INDEX IF NOT EXISTS "cmf_render_attempts_render_id_approval_status_idx"
  ON "cmf_render_attempts"("render_id", "approval_status");

CREATE INDEX IF NOT EXISTS "cmf_render_attempts_render_id_created_at_idx"
  ON "cmf_render_attempts"("render_id", "created_at" DESC);

-- 2. cmf_renders.selected_attempt_id — pointer to the canonical attempt.
ALTER TABLE "cmf_renders"
  ADD COLUMN IF NOT EXISTS "selected_attempt_id" UUID;

ALTER TABLE "cmf_renders"
  DROP CONSTRAINT IF EXISTS "cmf_renders_selected_attempt_id_fkey";
ALTER TABLE "cmf_renders"
  ADD CONSTRAINT "cmf_renders_selected_attempt_id_fkey"
  FOREIGN KEY ("selected_attempt_id") REFERENCES "cmf_render_attempts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. cmf_packets.document_draft — editable HTML/PDF overrides.
ALTER TABLE "cmf_packets"
  ADD COLUMN IF NOT EXISTS "document_draft" JSONB;
