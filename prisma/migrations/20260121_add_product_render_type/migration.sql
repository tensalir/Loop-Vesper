-- Add render_type column to product_renders table
ALTER TABLE "product_renders" ADD COLUMN "render_type" TEXT;

-- Add index for filtering by name + render_type
CREATE INDEX IF NOT EXISTS "product_renders_name_render_type_idx" ON "product_renders"("name", "render_type");
