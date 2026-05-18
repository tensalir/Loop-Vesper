-- =============================================================================
-- Product Updates — Row Level Security
--
-- Applies the same RLS baseline used elsewhere in the schema:
--   * `product_updates` — readable to any authenticated user (release notes
--     are not secret). All writes happen via the service role from the auto
--     pipeline, so no INSERT/UPDATE/DELETE policy is required.
--   * `user_product_update_views` — each user can read and create their own
--     rows. Service role bypasses RLS for any admin tooling.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE public.product_updates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_product_update_views ENABLE ROW LEVEL SECURITY;

-- ── product_updates ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can read published updates"
  ON public.product_updates;

CREATE POLICY "Authenticated users can read published updates"
  ON public.product_updates
  FOR SELECT
  USING (auth.role() = 'authenticated' AND is_published = true);

-- ── user_product_update_views ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read their own update views"
  ON public.user_product_update_views;
DROP POLICY IF EXISTS "Users can create their own update views"
  ON public.user_product_update_views;

CREATE POLICY "Users can read their own update views"
  ON public.user_product_update_views
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own update views"
  ON public.user_product_update_views
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
