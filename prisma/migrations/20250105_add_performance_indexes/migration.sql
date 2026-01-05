-- Performance indexes for optimized query patterns
-- These indexes support the single-SQL with-thumbnails endpoint and session visibility queries

-- Sessions: composite index for visibility queries (owner sees all, member sees public)
CREATE INDEX IF NOT EXISTS "sessions_project_is_private_idx" 
  ON "sessions"("project_id", "is_private");

-- Generations: index for finding latest completed generations efficiently
-- Used by thumbnail queries and generation listings
CREATE INDEX IF NOT EXISTS "generations_session_status_created_idx" 
  ON "generations"("session_id", "status", "created_at" DESC);

-- Generations: partial index for completed generations only (most common status filter)
-- This dramatically speeds up thumbnail queries since most generations become completed
CREATE INDEX IF NOT EXISTS "generations_completed_idx" 
  ON "generations"("session_id", "created_at" DESC)
  WHERE "status" = 'completed';

-- Outputs: index for finding latest image outputs efficiently
CREATE INDEX IF NOT EXISTS "outputs_generation_type_created_idx" 
  ON "outputs"("generation_id", "file_type", "created_at" DESC);

-- Outputs: partial index for image outputs only (most common file_type filter)
-- This speeds up thumbnail queries significantly
CREATE INDEX IF NOT EXISTS "outputs_images_idx" 
  ON "outputs"("generation_id", "created_at" DESC)
  WHERE "file_type" = 'image';

-- Projects: index for keyset pagination on (updated_at, id)
-- Used by the paginated projects list
CREATE INDEX IF NOT EXISTS "projects_updated_id_idx" 
  ON "projects"("updated_at" DESC, "id" DESC);

