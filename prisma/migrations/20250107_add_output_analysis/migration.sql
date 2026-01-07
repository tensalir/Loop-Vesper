-- Create OutputAnalysis table for semantic analysis results
CREATE TABLE IF NOT EXISTS "output_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "output_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "run_after" TIMESTAMP(3),
    "error" TEXT,
    "gemini_caption" TEXT,
    "gemini_model" TEXT,
    "claude_parsed" JSONB,
    "claude_model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "output_analyses_pkey" PRIMARY KEY ("id")
);

-- Create unique index on output_id (one analysis per output)
CREATE UNIQUE INDEX IF NOT EXISTS "output_analyses_output_id_key" ON "output_analyses"("output_id");

-- Create indexes for queue processing
CREATE INDEX IF NOT EXISTS "output_analyses_status_locked_at_idx" ON "output_analyses"("status", "locked_at");
CREATE INDEX IF NOT EXISTS "output_analyses_status_run_after_idx" ON "output_analyses"("status", "run_after");

-- Add foreign key constraint
ALTER TABLE "output_analyses" 
ADD CONSTRAINT "output_analyses_output_id_fkey" 
FOREIGN KEY ("output_id") 
REFERENCES "outputs"("id") 
ON DELETE CASCADE 
ON UPDATE CASCADE;

-- Add trigger to update updated_at on changes
CREATE OR REPLACE FUNCTION update_output_analyses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS output_analyses_updated_at_trigger ON "output_analyses";
CREATE TRIGGER output_analyses_updated_at_trigger
    BEFORE UPDATE ON "output_analyses"
    FOR EACH ROW
    EXECUTE FUNCTION update_output_analyses_updated_at();

