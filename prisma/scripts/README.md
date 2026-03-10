# Supabase SQL Scripts

These scripts are for Supabase-specific operations that should be run manually in the Supabase SQL Editor.

They are **not** Prisma migrations and should not be run via `prisma migrate`.

## Scripts

### `enable_rls_policies.sql`
Row Level Security (RLS) policies for **all** public tables, plus view and function hardening. Run this in Supabase SQL Editor to enable RLS protection for direct database access via Supabase client.

The script is idempotent (safe to re-run) and should be updated whenever new tables are added to the Prisma schema. It also:
- Fixes the `failed_generations_view` security invoker setting
- Hardens the `handle_new_user()` function with `SET search_path = ''`

Note: API routes use Prisma which bypasses RLS, so these policies only apply to direct Supabase client queries.

### `make_vince_admin.sql`
Utility script to grant admin role to a user. Modify the email as needed.

## Usage

1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy and paste the script content
4. Run the script

