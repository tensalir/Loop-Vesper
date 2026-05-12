-- Manual additive migration applied via `prisma db execute`. Mirrors
-- the pattern established by `2026-05-04-add-headless-access.sql` and
-- the broader RLS surface in `prisma/scripts/enable_rls_policies.sql`.
--
-- Defense-in-depth Row Level Security on the CMF library tables. Most
-- access is enforced at the API layer (Prisma uses the Supabase
-- service role, which bypasses RLS), but enabling RLS here means a
-- direct PostgREST / authenticated supabase-js connection is bound by
-- the same global-library posture as the API:
--
--   READ   — any authenticated profile can SELECT every row
--            (the library is one ground-truth visible to everyone).
--   WRITE  — only profiles with `cmf_access = true` OR `role = 'admin'`
--            can INSERT/UPDATE/DELETE.
--
-- The clown library was made globally readable in 2026-05-08; this
-- migration extends the same posture to packets, renders, render
-- attempts, comments, and activity. Members + imports follow the same
-- gating because they're metadata for those tables.
--
-- Idempotent: every CREATE POLICY is guarded by a DROP POLICY IF EXISTS
-- so re-runs land cleanly across environments.

-- ─── Helper expressions ────────────────────────────────────────────────────
-- Inline a "caller has CMF write access" check so every policy reads
-- the same way. Postgres can't define inline functions in a single
-- migration without elevation, so we repeat the EXISTS clause.

-- ─── Enable RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.cmf_packets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmf_renders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmf_render_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmf_comments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmf_activity        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmf_imports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cmf_packet_members  ENABLE ROW LEVEL SECURITY;

-- ─── cmf_packets ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cmf_packets_read_authenticated"  ON public.cmf_packets;
DROP POLICY IF EXISTS "cmf_packets_insert_cmf_writer"   ON public.cmf_packets;
DROP POLICY IF EXISTS "cmf_packets_update_cmf_writer"   ON public.cmf_packets;
DROP POLICY IF EXISTS "cmf_packets_delete_cmf_writer"   ON public.cmf_packets;

CREATE POLICY "cmf_packets_read_authenticated"
  ON public.cmf_packets FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_packets_insert_cmf_writer"
  ON public.cmf_packets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_packets_update_cmf_writer"
  ON public.cmf_packets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_packets_delete_cmf_writer"
  ON public.cmf_packets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── cmf_renders ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cmf_renders_read_authenticated"  ON public.cmf_renders;
DROP POLICY IF EXISTS "cmf_renders_insert_cmf_writer"   ON public.cmf_renders;
DROP POLICY IF EXISTS "cmf_renders_update_cmf_writer"   ON public.cmf_renders;
DROP POLICY IF EXISTS "cmf_renders_delete_cmf_writer"   ON public.cmf_renders;

CREATE POLICY "cmf_renders_read_authenticated"
  ON public.cmf_renders FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_renders_insert_cmf_writer"
  ON public.cmf_renders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_renders_update_cmf_writer"
  ON public.cmf_renders FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_renders_delete_cmf_writer"
  ON public.cmf_renders FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── cmf_render_attempts ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "cmf_render_attempts_read_authenticated"  ON public.cmf_render_attempts;
DROP POLICY IF EXISTS "cmf_render_attempts_insert_cmf_writer"   ON public.cmf_render_attempts;
DROP POLICY IF EXISTS "cmf_render_attempts_update_cmf_writer"   ON public.cmf_render_attempts;
DROP POLICY IF EXISTS "cmf_render_attempts_delete_cmf_writer"   ON public.cmf_render_attempts;

CREATE POLICY "cmf_render_attempts_read_authenticated"
  ON public.cmf_render_attempts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_render_attempts_insert_cmf_writer"
  ON public.cmf_render_attempts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_render_attempts_update_cmf_writer"
  ON public.cmf_render_attempts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_render_attempts_delete_cmf_writer"
  ON public.cmf_render_attempts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── cmf_comments ──────────────────────────────────────────────────────────
-- Comments inherit the same posture (read = anyone authenticated;
-- write = cmfAccess/admin). Authorship gating on body edits stays in
-- the API layer because RLS can't easily express "author OR
-- cmf_access" in a single CHECK without dropping into a function.
DROP POLICY IF EXISTS "cmf_comments_read_authenticated"  ON public.cmf_comments;
DROP POLICY IF EXISTS "cmf_comments_insert_cmf_writer"   ON public.cmf_comments;
DROP POLICY IF EXISTS "cmf_comments_update_cmf_writer"   ON public.cmf_comments;
DROP POLICY IF EXISTS "cmf_comments_delete_cmf_writer"   ON public.cmf_comments;

CREATE POLICY "cmf_comments_read_authenticated"
  ON public.cmf_comments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_comments_insert_cmf_writer"
  ON public.cmf_comments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_comments_update_cmf_writer"
  ON public.cmf_comments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_comments_delete_cmf_writer"
  ON public.cmf_comments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── cmf_activity ──────────────────────────────────────────────────────────
-- Activity is append-only logically. We allow INSERTs from any cmf
-- writer (the API attributes via auth.uid() server-side) and disable
-- UPDATE/DELETE entirely so a writer can't tamper with their trail.
DROP POLICY IF EXISTS "cmf_activity_read_authenticated" ON public.cmf_activity;
DROP POLICY IF EXISTS "cmf_activity_insert_cmf_writer"  ON public.cmf_activity;

CREATE POLICY "cmf_activity_read_authenticated"
  ON public.cmf_activity FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_activity_insert_cmf_writer"
  ON public.cmf_activity FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── cmf_imports ───────────────────────────────────────────────────────────
-- Reads stay open for the activity drawer; only cmf writers can
-- create / mutate import records.
DROP POLICY IF EXISTS "cmf_imports_read_authenticated"  ON public.cmf_imports;
DROP POLICY IF EXISTS "cmf_imports_insert_cmf_writer"   ON public.cmf_imports;
DROP POLICY IF EXISTS "cmf_imports_update_cmf_writer"   ON public.cmf_imports;
DROP POLICY IF EXISTS "cmf_imports_delete_cmf_writer"   ON public.cmf_imports;

CREATE POLICY "cmf_imports_read_authenticated"
  ON public.cmf_imports FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_imports_insert_cmf_writer"
  ON public.cmf_imports FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_imports_update_cmf_writer"
  ON public.cmf_imports FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_imports_delete_cmf_writer"
  ON public.cmf_imports FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── cmf_packet_members ────────────────────────────────────────────────────
-- Audit metadata only under the new model. Read is open; writes still
-- require cmf write access.
DROP POLICY IF EXISTS "cmf_packet_members_read_authenticated" ON public.cmf_packet_members;
DROP POLICY IF EXISTS "cmf_packet_members_insert_cmf_writer"  ON public.cmf_packet_members;
DROP POLICY IF EXISTS "cmf_packet_members_update_cmf_writer"  ON public.cmf_packet_members;
DROP POLICY IF EXISTS "cmf_packet_members_delete_cmf_writer"  ON public.cmf_packet_members;

CREATE POLICY "cmf_packet_members_read_authenticated"
  ON public.cmf_packet_members FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "cmf_packet_members_insert_cmf_writer"
  ON public.cmf_packet_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_packet_members_update_cmf_writer"
  ON public.cmf_packet_members FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

CREATE POLICY "cmf_packet_members_delete_cmf_writer"
  ON public.cmf_packet_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.cmf_access = true)
    )
  );

-- ─── Notes ────────────────────────────────────────────────────────────────
-- The CMF storage bucket remains service-role-only (uploads/serves go
-- through `uploadBase64ToStorage` and signed URLs). Storage policies
-- live separately and aren't part of this migration.
