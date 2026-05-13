-- Manual additive migration applied via `prisma db execute`. Mirrors
-- the pattern established by `2026-05-13-add-attempt-refinement.sql`.
--
-- Phase 2 of iterative refinement: adds the `reference_image_paths`
-- column to `cmf_render_attempts` so a designer can drop reference
-- images alongside the freeform refinement prompt — the model gets
-- the clown PLUS the refs as image context, and the prompt names
-- each ref's role explicitly.
--
-- Postgres array column (TEXT[]) so we can read/write arrays via
-- Prisma's `String[]` type without a separate join table. Cap at 4
-- per attempt is enforced in the upload route (server-side) since
-- a Postgres CHECK constraint can't easily express array length
-- limits without a custom function.
--
-- Default '{}' — empty array — so existing attempts naturally have
-- no references attached. Idempotent via IF NOT EXISTS.

ALTER TABLE "cmf_render_attempts"
  ADD COLUMN IF NOT EXISTS "reference_image_paths" TEXT[] NOT NULL DEFAULT '{}';
