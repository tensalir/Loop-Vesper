-- Add angle and sort_order fields to product_renders table
ALTER TABLE "product_renders" 
ADD COLUMN IF NOT EXISTS "angle" TEXT,
ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Add composite index for product + colorway
CREATE INDEX IF NOT EXISTS "product_renders_name_colorway_idx" ON "product_renders"("name", "colorway");

