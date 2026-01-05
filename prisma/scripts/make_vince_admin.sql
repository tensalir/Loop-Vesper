-- Make vince@starhaven.ai an admin user
-- Run this SQL in Supabase SQL Editor

UPDATE profiles 
SET role = 'admin' 
WHERE id IN (
  SELECT id 
  FROM auth.users 
  WHERE email = 'vince@starhaven.ai'
);

-- Verify the update
SELECT 
  p.id,
  u.email,
  p.role,
  p.display_name
FROM profiles p
JOIN auth.users u ON p.id = u.id
WHERE u.email = 'vince@starhaven.ai';

