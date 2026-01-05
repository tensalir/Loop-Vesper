# Supabase SQL Scripts

These scripts are for Supabase-specific operations that should be run manually in the Supabase SQL Editor.

They are **not** Prisma migrations and should not be run via `prisma migrate`.

## Scripts

### `enable_rls_policies.sql`
Row Level Security (RLS) policies for all tables. Run this in Supabase SQL Editor to enable RLS protection for direct database access via Supabase client.

Note: API routes use Prisma which bypasses RLS, so these policies only apply to direct Supabase client queries.

### `make_vince_admin.sql`
Utility script to grant admin role to a user. Modify the email as needed.

## Usage

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the script content
4. Run the script

