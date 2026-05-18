-- Fix Supabase Auth user creation failing with:
-- "Database error creating new user"
--
-- Cause: auth.users has an AFTER INSERT trigger that creates public.profiles,
-- but profiles.updated_at is NOT NULL and had no database default. Prisma
-- normally fills @updatedAt, but this trigger bypasses Prisma.

ALTER TABLE public.profiles
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    username,
    display_name,
    avatar_url,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
