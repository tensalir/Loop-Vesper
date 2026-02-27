-- PDF Buckets: per-user reference image extraction from uploaded PDFs

CREATE TABLE IF NOT EXISTS pdf_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text,
  status text NOT NULL DEFAULT 'processing',
  page_count int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_buckets_project_user ON pdf_buckets(project_id, user_id);
CREATE INDEX idx_pdf_buckets_user ON pdf_buckets(user_id);

CREATE TABLE IF NOT EXISTS pdf_bucket_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id uuid NOT NULL REFERENCES pdf_buckets(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  storage_path text NOT NULL,
  width int,
  height int,
  page_index int,
  sort_order int NOT NULL DEFAULT 0,
  label text,
  source text NOT NULL DEFAULT 'embedded',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_bucket_images_bucket ON pdf_bucket_images(bucket_id);
CREATE INDEX idx_pdf_bucket_images_bucket_sort ON pdf_bucket_images(bucket_id, sort_order);
