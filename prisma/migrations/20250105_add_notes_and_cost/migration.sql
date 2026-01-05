-- Add cost column to generations table
ALTER TABLE "generations" ADD COLUMN IF NOT EXISTS "cost" DECIMAL(10,6);

-- Create notes table
CREATE TABLE IF NOT EXISTS "notes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "output_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "context" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- Create indexes for notes
CREATE INDEX IF NOT EXISTS "notes_user_id_idx" ON "notes"("user_id");
CREATE INDEX IF NOT EXISTS "notes_output_id_idx" ON "notes"("output_id");

-- Add foreign keys for notes
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'notes_user_id_fkey'
    ) THEN
        ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_fkey" 
            FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'notes_output_id_fkey'
    ) THEN
        ALTER TABLE "notes" ADD CONSTRAINT "notes_output_id_fkey" 
            FOREIGN KEY ("output_id") REFERENCES "outputs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

