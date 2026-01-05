-- ============================================
-- SUPABASE ROW LEVEL SECURITY (RLS) POLICIES
-- Run this in Supabase SQL Editor
-- ============================================

-- ============================================
-- 1. ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_model_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_enhancement_prompts ENABLE ROW LEVEL SECURITY;

-- _prisma_migrations is internal, restrict to service role only
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 2. PROFILES - Users can only see/edit their own profile
-- (id column is the user's auth.uid())
-- ============================================

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============================================
-- 3. PROJECTS - Users can only access their own projects
-- (owner_id column references the user)
-- ============================================

CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = owner_id);

-- ============================================
-- 4. PROJECT_MEMBERS - Access based on membership
-- (user_id column references the member)
-- ============================================

CREATE POLICY "Users can view project memberships they're part of"
  ON public.project_members FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own memberships"
  ON public.project_members FOR ALL
  USING (auth.uid() = user_id);

-- ============================================
-- 5. SESSIONS - Users can only access sessions in their projects
-- (project_id references project, which has owner_id)
-- ============================================

CREATE POLICY "Users can view sessions in their projects"
  ON public.sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects 
      WHERE projects.id = sessions.project_id 
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can create sessions in their projects"
  ON public.sessions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects 
      WHERE projects.id = project_id 
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can update sessions in their projects"
  ON public.sessions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects 
      WHERE projects.id = sessions.project_id 
      AND projects.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete sessions in their projects"
  ON public.sessions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.projects 
      WHERE projects.id = sessions.project_id 
      AND projects.owner_id = auth.uid()
    )
  );

-- ============================================
-- 6. GENERATIONS - Users can only access their own generations
-- (user_id column references the creator)
-- ============================================

CREATE POLICY "Users can view own generations"
  ON public.generations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own generations"
  ON public.generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own generations"
  ON public.generations FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own generations"
  ON public.generations FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 7. OUTPUTS - Access based on generation ownership
-- (generation_id references generation, which has user_id)
-- ============================================

CREATE POLICY "Users can view outputs of their generations"
  ON public.outputs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = outputs.generation_id 
      AND generations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create outputs for their generations"
  ON public.outputs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = generation_id 
      AND generations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update outputs of their generations"
  ON public.outputs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = outputs.generation_id 
      AND generations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete outputs of their generations"
  ON public.outputs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = outputs.generation_id 
      AND generations.user_id = auth.uid()
    )
  );

-- ============================================
-- 8. MODELS - Public read, admin write
-- ============================================

CREATE POLICY "Anyone can view models"
  ON public.models FOR SELECT
  USING (true);

-- Only service role can modify models (no user-facing policy needed)

-- ============================================
-- 9. USER_MODEL_PINS - Users can only manage their own pins
-- (user_id column references the user)
-- ============================================

CREATE POLICY "Users can view own model pins"
  ON public.user_model_pins FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own model pins"
  ON public.user_model_pins FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own model pins"
  ON public.user_model_pins FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 10. WORKFLOWS - Users can only access their own workflows
-- (user_id column references the creator)
-- ============================================

CREATE POLICY "Users can view own workflows"
  ON public.workflows FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own workflows"
  ON public.workflows FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workflows"
  ON public.workflows FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workflows"
  ON public.workflows FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 11. BOOKMARKS - Users can only access their own bookmarks
-- (user_id column references the user)
-- ============================================

CREATE POLICY "Users can view own bookmarks"
  ON public.bookmarks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own bookmarks"
  ON public.bookmarks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own bookmarks"
  ON public.bookmarks FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 12. NOTES - Users can only access their own notes
-- (user_id column references the creator)
-- ============================================

CREATE POLICY "Users can view own notes"
  ON public.notes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own notes"
  ON public.notes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own notes"
  ON public.notes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notes"
  ON public.notes FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- 13. GENERATION_JOBS - Access based on related generation ownership
-- (generation_id references generation, which has user_id)
-- Note: generation_jobs doesn't have a direct user_id column
-- ============================================

CREATE POLICY "Users can view own generation jobs"
  ON public.generation_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = generation_jobs.generation_id 
      AND generations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create own generation jobs"
  ON public.generation_jobs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = generation_id 
      AND generations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own generation jobs"
  ON public.generation_jobs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.generations 
      WHERE generations.id = generation_jobs.generation_id 
      AND generations.user_id = auth.uid()
    )
  );

-- ============================================
-- 14. PROMPT_ENHANCEMENT_PROMPTS - Public read (system prompts)
-- ============================================

CREATE POLICY "Anyone can view prompt enhancement prompts"
  ON public.prompt_enhancement_prompts FOR SELECT
  USING (true);

-- Only service role can modify (admin only)

-- ============================================
-- 15. _PRISMA_MIGRATIONS - Service role only
-- ============================================

-- No policies needed - only service_role should access this
-- RLS enabled means no access without explicit policy

-- ============================================
-- 16. FIX SECURITY DEFINER VIEW
-- ============================================

-- Drop and recreate the view without SECURITY DEFINER
DROP VIEW IF EXISTS public.failed_generations_view;

CREATE VIEW public.failed_generations_view AS
SELECT 
  id,
  user_id,
  session_id,
  model_id,
  prompt,
  status,
  parameters,
  created_at
FROM public.generations
WHERE status = 'failed';

-- Grant access to authenticated users (view will respect RLS on generations table)
GRANT SELECT ON public.failed_generations_view TO authenticated;

-- ============================================
-- IMPORTANT NOTES
-- ============================================
-- 
-- 1. Your Prisma connection uses the database URL directly (not PostgREST)
--    so these RLS policies won't affect Prisma queries from API routes.
-- 
-- 2. RLS only applies to:
--    - Supabase client queries (anon/authenticated keys)
--    - PostgREST API calls
--
-- 3. Your API routes use Prisma, which bypasses RLS entirely.
--    This is fine as long as your API routes validate auth properly.
--
-- 4. If you use the Supabase JS client directly for queries in the future,
--    these policies will protect the data.
--
-- 5. Service role key (used by your backend) bypasses all RLS.
