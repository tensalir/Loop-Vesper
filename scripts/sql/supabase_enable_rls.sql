-- ============================================================================
-- SUPABASE ROW LEVEL SECURITY (RLS) POLICIES — FULL COVERAGE
-- Run this in Supabase SQL Editor (idempotent: safe to re-run)
--
-- Generated: 2026-03-10
-- Tables covered: all public.* tables in the Prisma schema + brand_worlds
-- ============================================================================

-- ============================================================================
-- 1. ENABLE RLS ON ALL PUBLIC TABLES
--    RLS-on with zero policies = deny-all for non-service-role connections.
--    Tables that should be service-role-only simply get no permissive policies.
-- ============================================================================

ALTER TABLE public.profiles                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generation_jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outputs                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.output_analyses              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_model_pins              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflows                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookmarks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_enhancement_prompts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_renders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_chats                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_chat_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinned_images                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.output_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_counters           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_buckets                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_bucket_images            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_links                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_events                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_revisions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_cursors                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_world_project_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_worlds                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_sequences           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_tracks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_clips               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_transitions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_captions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_render_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._prisma_migrations           ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. PROFILES (id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================================
-- 3. PROJECTS (owner_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own projects"  ON public.projects;
DROP POLICY IF EXISTS "Users can create own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;

CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create own projects"
  ON public.projects FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE USING (auth.uid() = owner_id);

-- ============================================================================
-- 4. PROJECT_MEMBERS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view project memberships they're part of" ON public.project_members;
DROP POLICY IF EXISTS "Users can manage their own memberships"             ON public.project_members;

CREATE POLICY "Users can view project memberships they're part of"
  ON public.project_members FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own memberships"
  ON public.project_members FOR ALL USING (auth.uid() = user_id);

-- ============================================================================
-- 5. SESSIONS (via projects.owner_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view sessions in their projects"  ON public.sessions;
DROP POLICY IF EXISTS "Users can create sessions in their projects" ON public.sessions;
DROP POLICY IF EXISTS "Users can update sessions in their projects" ON public.sessions;
DROP POLICY IF EXISTS "Users can delete sessions in their projects" ON public.sessions;

CREATE POLICY "Users can view sessions in their projects"
  ON public.sessions FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE projects.id = sessions.project_id AND projects.owner_id = auth.uid())
  );
CREATE POLICY "Users can create sessions in their projects"
  ON public.sessions FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects WHERE projects.id = project_id AND projects.owner_id = auth.uid())
  );
CREATE POLICY "Users can update sessions in their projects"
  ON public.sessions FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.projects WHERE projects.id = sessions.project_id AND projects.owner_id = auth.uid())
  );
CREATE POLICY "Users can delete sessions in their projects"
  ON public.sessions FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.projects WHERE projects.id = sessions.project_id AND projects.owner_id = auth.uid())
  );

-- ============================================================================
-- 6. GENERATIONS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own generations"  ON public.generations;
DROP POLICY IF EXISTS "Users can create own generations" ON public.generations;
DROP POLICY IF EXISTS "Users can update own generations" ON public.generations;
DROP POLICY IF EXISTS "Users can delete own generations" ON public.generations;

CREATE POLICY "Users can view own generations"
  ON public.generations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own generations"
  ON public.generations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own generations"
  ON public.generations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own generations"
  ON public.generations FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 7. GENERATION_JOBS (via generations.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own generation jobs"  ON public.generation_jobs;
DROP POLICY IF EXISTS "Users can create own generation jobs" ON public.generation_jobs;
DROP POLICY IF EXISTS "Users can update own generation jobs" ON public.generation_jobs;

CREATE POLICY "Users can view own generation jobs"
  ON public.generation_jobs FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = generation_jobs.generation_id AND generations.user_id = auth.uid())
  );
CREATE POLICY "Users can create own generation jobs"
  ON public.generation_jobs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = generation_id AND generations.user_id = auth.uid())
  );
CREATE POLICY "Users can update own generation jobs"
  ON public.generation_jobs FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = generation_jobs.generation_id AND generations.user_id = auth.uid())
  );

-- ============================================================================
-- 8. OUTPUTS (via generations.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view outputs of their generations"  ON public.outputs;
DROP POLICY IF EXISTS "Users can create outputs for their generations" ON public.outputs;
DROP POLICY IF EXISTS "Users can update outputs of their generations" ON public.outputs;
DROP POLICY IF EXISTS "Users can delete outputs of their generations" ON public.outputs;

CREATE POLICY "Users can view outputs of their generations"
  ON public.outputs FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = outputs.generation_id AND generations.user_id = auth.uid())
  );
CREATE POLICY "Users can create outputs for their generations"
  ON public.outputs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = generation_id AND generations.user_id = auth.uid())
  );
CREATE POLICY "Users can update outputs of their generations"
  ON public.outputs FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = outputs.generation_id AND generations.user_id = auth.uid())
  );
CREATE POLICY "Users can delete outputs of their generations"
  ON public.outputs FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.generations WHERE generations.id = outputs.generation_id AND generations.user_id = auth.uid())
  );

-- ============================================================================
-- 9. OUTPUT_ANALYSES (via output -> generation.user_id)
--    Queue-managed by service role; authenticated users get read-only access
--    to analyses on their own outputs.
-- ============================================================================
DROP POLICY IF EXISTS "Users can view analyses of their outputs" ON public.output_analyses;

CREATE POLICY "Users can view analyses of their outputs"
  ON public.output_analyses FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.outputs o
      JOIN public.generations g ON g.id = o.generation_id
      WHERE o.id = output_analyses.output_id AND g.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 10. NOTES (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own notes"  ON public.notes;
DROP POLICY IF EXISTS "Users can create own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can update own notes" ON public.notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON public.notes;

CREATE POLICY "Users can view own notes"
  ON public.notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own notes"
  ON public.notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own notes"
  ON public.notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own notes"
  ON public.notes FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 11. MODELS — public read, service-role write
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can view models" ON public.models;

CREATE POLICY "Anyone can view models"
  ON public.models FOR SELECT USING (true);

-- ============================================================================
-- 12. USER_MODEL_PINS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own model pins"  ON public.user_model_pins;
DROP POLICY IF EXISTS "Users can create own model pins" ON public.user_model_pins;
DROP POLICY IF EXISTS "Users can delete own model pins" ON public.user_model_pins;

CREATE POLICY "Users can view own model pins"
  ON public.user_model_pins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own model pins"
  ON public.user_model_pins FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own model pins"
  ON public.user_model_pins FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 13. WORKFLOWS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own workflows"  ON public.workflows;
DROP POLICY IF EXISTS "Users can create own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Users can update own workflows" ON public.workflows;
DROP POLICY IF EXISTS "Users can delete own workflows" ON public.workflows;

CREATE POLICY "Users can view own workflows"
  ON public.workflows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own workflows"
  ON public.workflows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workflows"
  ON public.workflows FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workflows"
  ON public.workflows FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 14. BOOKMARKS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own bookmarks"  ON public.bookmarks;
DROP POLICY IF EXISTS "Users can create own bookmarks" ON public.bookmarks;
DROP POLICY IF EXISTS "Users can delete own bookmarks" ON public.bookmarks;

CREATE POLICY "Users can view own bookmarks"
  ON public.bookmarks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own bookmarks"
  ON public.bookmarks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own bookmarks"
  ON public.bookmarks FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 15. PROMPT_ENHANCEMENT_PROMPTS — public read, service-role write
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can view prompt enhancement prompts" ON public.prompt_enhancement_prompts;

CREATE POLICY "Anyone can view prompt enhancement prompts"
  ON public.prompt_enhancement_prompts FOR SELECT USING (true);

-- ============================================================================
-- 16. PRODUCT_RENDERS — public read (product catalog), service-role write
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can view product renders" ON public.product_renders;

CREATE POLICY "Anyone can view product renders"
  ON public.product_renders FOR SELECT USING (true);

-- ============================================================================
-- 17. PROJECT_CHATS (user_id = auth.uid(), scoped to project)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own project chats"  ON public.project_chats;
DROP POLICY IF EXISTS "Users can create own project chats" ON public.project_chats;
DROP POLICY IF EXISTS "Users can update own project chats" ON public.project_chats;
DROP POLICY IF EXISTS "Users can delete own project chats" ON public.project_chats;

CREATE POLICY "Users can view own project chats"
  ON public.project_chats FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own project chats"
  ON public.project_chats FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own project chats"
  ON public.project_chats FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own project chats"
  ON public.project_chats FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 18. PROJECT_CHAT_MESSAGES (via project_chats.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view messages in own chats"  ON public.project_chat_messages;
DROP POLICY IF EXISTS "Users can create messages in own chats" ON public.project_chat_messages;

CREATE POLICY "Users can view messages in own chats"
  ON public.project_chat_messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.project_chats WHERE project_chats.id = project_chat_messages.chat_id AND project_chats.user_id = auth.uid())
  );
CREATE POLICY "Users can create messages in own chats"
  ON public.project_chat_messages FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.project_chats WHERE project_chats.id = chat_id AND project_chats.user_id = auth.uid())
  );

-- ============================================================================
-- 19. PINNED_IMAGES (pinned_by = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view pinned images in their projects" ON public.pinned_images;
DROP POLICY IF EXISTS "Users can pin images"                          ON public.pinned_images;
DROP POLICY IF EXISTS "Users can unpin own images"                    ON public.pinned_images;

CREATE POLICY "Users can view pinned images in their projects"
  ON public.pinned_images FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE projects.id = pinned_images.project_id AND projects.owner_id = auth.uid())
  );
CREATE POLICY "Users can pin images"
  ON public.pinned_images FOR INSERT WITH CHECK (auth.uid() = pinned_by);
CREATE POLICY "Users can unpin own images"
  ON public.pinned_images FOR DELETE USING (auth.uid() = pinned_by);

-- ============================================================================
-- 20. OUTPUT_EVENTS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own output events"  ON public.output_events;
DROP POLICY IF EXISTS "Users can create own output events" ON public.output_events;

CREATE POLICY "Users can view own output events"
  ON public.output_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own output events"
  ON public.output_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 21. PDF_BUCKETS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own pdf buckets"  ON public.pdf_buckets;
DROP POLICY IF EXISTS "Users can create own pdf buckets" ON public.pdf_buckets;
DROP POLICY IF EXISTS "Users can update own pdf buckets" ON public.pdf_buckets;
DROP POLICY IF EXISTS "Users can delete own pdf buckets" ON public.pdf_buckets;

CREATE POLICY "Users can view own pdf buckets"
  ON public.pdf_buckets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own pdf buckets"
  ON public.pdf_buckets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pdf buckets"
  ON public.pdf_buckets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own pdf buckets"
  ON public.pdf_buckets FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 22. PDF_BUCKET_IMAGES (via pdf_buckets.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view images in own pdf buckets" ON public.pdf_bucket_images;

CREATE POLICY "Users can view images in own pdf buckets"
  ON public.pdf_bucket_images FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.pdf_buckets WHERE pdf_buckets.id = pdf_bucket_images.bucket_id AND pdf_buckets.user_id = auth.uid())
  );

-- ============================================================================
-- 23. BRAND_WORLD_PROJECT_SETTINGS (via projects.owner_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can view brand world settings for own projects" ON public.brand_world_project_settings;
DROP POLICY IF EXISTS "Users can manage brand world settings for own projects" ON public.brand_world_project_settings;

CREATE POLICY "Users can view brand world settings for own projects"
  ON public.brand_world_project_settings FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.projects WHERE projects.id = brand_world_project_settings.project_id AND projects.owner_id = auth.uid())
  );
CREATE POLICY "Users can manage brand world settings for own projects"
  ON public.brand_world_project_settings FOR ALL USING (auth.uid() = linked_by_user_id);

-- ============================================================================
-- 24. BRAND_WORLDS — public read (shared brand library), service-role write
-- ============================================================================
DROP POLICY IF EXISTS "Anyone can view brand worlds" ON public.brand_worlds;

CREATE POLICY "Anyone can view brand worlds"
  ON public.brand_worlds FOR SELECT USING (true);

-- ============================================================================
-- 25. TIMELINE_SEQUENCES (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own timeline sequences"  ON public.timeline_sequences;
DROP POLICY IF EXISTS "Users can create own timeline sequences" ON public.timeline_sequences;
DROP POLICY IF EXISTS "Users can update own timeline sequences" ON public.timeline_sequences;
DROP POLICY IF EXISTS "Users can delete own timeline sequences" ON public.timeline_sequences;

CREATE POLICY "Users can view own timeline sequences"
  ON public.timeline_sequences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own timeline sequences"
  ON public.timeline_sequences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own timeline sequences"
  ON public.timeline_sequences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own timeline sequences"
  ON public.timeline_sequences FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- 26. TIMELINE_TRACKS (via timeline_sequences.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can manage tracks in own sequences" ON public.timeline_tracks;

CREATE POLICY "Users can manage tracks in own sequences"
  ON public.timeline_tracks FOR ALL USING (
    EXISTS (SELECT 1 FROM public.timeline_sequences WHERE timeline_sequences.id = timeline_tracks.sequence_id AND timeline_sequences.user_id = auth.uid())
  );

-- ============================================================================
-- 27. TIMELINE_CLIPS (via track -> sequence.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can manage clips in own sequences" ON public.timeline_clips;

CREATE POLICY "Users can manage clips in own sequences"
  ON public.timeline_clips FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.timeline_tracks t
      JOIN public.timeline_sequences s ON s.id = t.sequence_id
      WHERE t.id = timeline_clips.track_id AND s.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 28. TIMELINE_TRANSITIONS (via timeline_sequences.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can manage transitions in own sequences" ON public.timeline_transitions;

CREATE POLICY "Users can manage transitions in own sequences"
  ON public.timeline_transitions FOR ALL USING (
    EXISTS (SELECT 1 FROM public.timeline_sequences WHERE timeline_sequences.id = timeline_transitions.sequence_id AND timeline_sequences.user_id = auth.uid())
  );

-- ============================================================================
-- 29. TIMELINE_CAPTIONS (via track -> sequence.user_id)
-- ============================================================================
DROP POLICY IF EXISTS "Users can manage captions in own sequences" ON public.timeline_captions;

CREATE POLICY "Users can manage captions in own sequences"
  ON public.timeline_captions FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.timeline_tracks t
      JOIN public.timeline_sequences s ON s.id = t.sequence_id
      WHERE t.id = timeline_captions.track_id AND s.user_id = auth.uid()
    )
  );

-- ============================================================================
-- 30. TIMELINE_RENDER_JOBS (user_id = auth.uid())
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own render jobs"  ON public.timeline_render_jobs;
DROP POLICY IF EXISTS "Users can create own render jobs" ON public.timeline_render_jobs;

CREATE POLICY "Users can view own render jobs"
  ON public.timeline_render_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own render jobs"
  ON public.timeline_render_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- 31-34. SERVICE-ROLE-ONLY TABLES
--    RLS is enabled but no permissive policies exist, so only service_role
--    (used by Prisma / API routes) can access these.
-- ============================================================================

-- api_usage_counters: internal rate-limit bookkeeping
-- sync_links, sync_events, sync_revisions, sync_cursors: webhook-driven
-- _prisma_migrations: Prisma internal

-- No policies needed — deny-all for anon/authenticated is the desired state.

-- ============================================================================
-- 35. FIX SECURITY DEFINER VIEW
--    The Supabase Security Advisor flags views created without
--    security_invoker = true.  Recreate with the correct option so the view
--    respects the caller's RLS context instead of the definer's.
-- ============================================================================

DROP VIEW IF EXISTS public.failed_generations_view;

CREATE VIEW public.failed_generations_view
  WITH (security_invoker = true)
AS
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

GRANT SELECT ON public.failed_generations_view TO authenticated;

-- ============================================================================
-- 36. HARDEN handle_new_user() FUNCTION
--    The existing function uses SECURITY DEFINER without restricting
--    search_path, which the Security Advisor flags.  Recreate with
--    SET search_path = '' to prevent search-path injection.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, username, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Ensure the trigger exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- NOTES
-- ============================================================================
-- 1. Prisma connects via DATABASE_URL (service role) and bypasses RLS.
--    These policies protect against direct Supabase client / PostgREST access.
-- 2. Service role key (SUPABASE_SERVICE_ROLE_KEY) bypasses all RLS.
-- 3. This script is idempotent: DROP POLICY IF EXISTS before each CREATE.
-- 4. Run this whenever new tables are added to the Prisma schema.
-- ============================================================================
