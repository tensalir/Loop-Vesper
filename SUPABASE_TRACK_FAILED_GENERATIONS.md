# Tracking Failed Generations in Supabase

This guide shows you how to track and monitor failed generations directly in Supabase.

## Database Structure

Failed generations are stored in the `generations` table with:
- **`status`**: Set to `'failed'` when a generation fails
- **`parameters`**: JSON field containing error details:
  - `parameters.error`: Error message string
  - `parameters.errorContext`: Full error context object with:
    - `message`: Error message
    - `type`: Error type (e.g., 'ModelGenerationError', 'UnknownError')
    - `timestamp`: When the error occurred
    - `userId`: User who triggered the generation
    - `stack`: Stack trace (if available)

## SQL Queries for Supabase

### 1. Get All Failed Generations (Last 24 Hours)

```sql
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.prompt,
  g.status,
  g.created_at,
  g.parameters->>'error' as error_message,
  g.parameters->'errorContext' as error_context,
  p.display_name as user_display_name,
  p.username,
  s.name as session_name,
  pr.name as project_name
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
LEFT JOIN sessions s ON g.session_id = s.id
LEFT JOIN projects pr ON s.project_id = pr.id
WHERE g.status = 'failed'
  AND g.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY g.created_at DESC;
```

### 2. Get Failed Generations by User

```sql
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.prompt,
  g.parameters->>'error' as error_message,
  g.created_at,
  p.display_name as user_display_name,
  p.username
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
WHERE g.status = 'failed'
  AND g.user_id = 'YOUR_USER_ID_HERE'  -- Replace with actual user ID
ORDER BY g.created_at DESC
LIMIT 50;
```

### 3. Get Stuck Generations (Processing > 10 Minutes)

```sql
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.prompt,
  g.status,
  g.created_at,
  EXTRACT(EPOCH FROM (NOW() - g.created_at))/60 as age_minutes,
  p.display_name as user_display_name,
  p.username
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
WHERE g.status = 'processing'
  AND g.created_at < NOW() - INTERVAL '10 minutes'
ORDER BY g.created_at ASC;
```

### 4. Count Failed Generations by Model

```sql
SELECT 
  model_id,
  COUNT(*) as failure_count,
  COUNT(DISTINCT user_id) as affected_users
FROM generations
WHERE status = 'failed'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY model_id
ORDER BY failure_count DESC;
```

### 5. Get Failed Generations with Error Types

```sql
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.parameters->'errorContext'->>'type' as error_type,
  g.parameters->>'error' as error_message,
  g.created_at,
  p.display_name as user_display_name
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
WHERE g.status = 'failed'
  AND g.parameters->'errorContext'->>'type' IS NOT NULL
ORDER BY g.created_at DESC
LIMIT 100;
```

### 6. Get Recent Failures with Full Error Context

```sql
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.prompt,
  g.parameters->>'error' as error_message,
  g.parameters->'errorContext' as full_error_context,
  g.created_at,
  p.display_name as user_display_name,
  p.username
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
WHERE g.status = 'failed'
  AND g.created_at >= NOW() - INTERVAL '1 hour'
ORDER BY g.created_at DESC;
```

### 7. Get User Email from Supabase Auth (Requires Admin Access)

To get user emails, you'll need to use the Supabase Admin API or run this in the Supabase Dashboard SQL Editor with admin privileges:

```sql
-- This requires direct access to auth.users table
-- Usually only available via Supabase Admin API
SELECT 
  g.id as generation_id,
  g.user_id,
  g.parameters->>'error' as error_message,
  g.created_at,
  au.email as user_email
FROM generations g
LEFT JOIN auth.users au ON g.user_id = au.id::text
WHERE g.status = 'failed'
  AND g.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY g.created_at DESC;
```

**Note**: The `auth.users` table is not directly accessible via regular SQL queries. Use the API endpoints instead (see below).

## Using the API Endpoints

### Admin Endpoint (View All Failed Generations)

```bash
# Get all failed and stuck generations
GET /api/admin/failed-generations?status=all&hoursAgo=24

# Get only failed generations
GET /api/admin/failed-generations?status=failed&hoursAgo=24

# Get only stuck generations
GET /api/admin/failed-generations?status=stuck&hoursAgo=24

# Filter by specific user
GET /api/admin/failed-generations?userId=xxx&status=failed

# Custom time range and limit
GET /api/admin/failed-generations?status=all&hoursAgo=48&limit=100
```

**Response includes:**
- `total`: Total count
- `summary`: Breakdown of failed vs stuck
- `byUser`: Grouped by user with email addresses
- `generations`: Full list with error messages

### User-Facing Endpoint (View Own Failed Generations)

```bash
# Get user's own failed generations
GET /api/generations/failed?hoursAgo=24

# Filter by session
GET /api/generations/failed?sessionId=xxx&hoursAgo=24
```

## Setting Up Monitoring in Supabase

### 1. Create a View for Failed Generations

Run this in Supabase SQL Editor:

```sql
CREATE OR REPLACE VIEW failed_generations_view AS
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.prompt,
  g.status,
  g.created_at,
  g.parameters->>'error' as error_message,
  g.parameters->'errorContext'->>'type' as error_type,
  p.display_name as user_display_name,
  p.username,
  s.name as session_name,
  pr.name as project_name
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
LEFT JOIN sessions s ON g.session_id = s.id
LEFT JOIN projects pr ON s.project_id = pr.id
WHERE g.status = 'failed';
```

### 2. Create a Function to Get Failure Stats

```sql
CREATE OR REPLACE FUNCTION get_failure_stats(hours_back INTEGER DEFAULT 24)
RETURNS TABLE (
  model_id TEXT,
  failure_count BIGINT,
  affected_users BIGINT,
  latest_failure TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    g.model_id,
    COUNT(*) as failure_count,
    COUNT(DISTINCT g.user_id) as affected_users,
    MAX(g.created_at) as latest_failure
  FROM generations g
  WHERE g.status = 'failed'
    AND g.created_at >= NOW() - (hours_back || ' hours')::INTERVAL
  GROUP BY g.model_id
  ORDER BY failure_count DESC;
END;
$$ LANGUAGE plpgsql;

-- Usage:
SELECT * FROM get_failure_stats(24);  -- Last 24 hours
SELECT * FROM get_failure_stats(168); -- Last 7 days
```

### 3. Set Up Database Webhooks (Optional)

You can set up Supabase Database Webhooks to get notified when a generation fails:

1. Go to **Supabase Dashboard** → **Database** → **Webhooks**
2. Create a new webhook
3. Set trigger on `INSERT` and `UPDATE` on `generations` table
4. Add filter: `status = 'failed'`
5. Configure webhook URL to send notifications (e.g., Slack, email, etc.)

## Quick Reference

### Status Values
- `'queued'`: Generation is queued for processing
- `'processing'`: Generation is currently being processed
- `'completed'`: Generation completed successfully
- `'failed'`: Generation failed (check `parameters.error` for details)
- `'cancelled'`: Generation was cancelled by user

### Error Information Location
- **Error Message**: `parameters->>'error'` (text)
- **Full Error Context**: `parameters->'errorContext'` (JSON object)
- **Error Type**: `parameters->'errorContext'->>'type'`
- **Timestamp**: `parameters->'errorContext'->>'timestamp'`

## Example: Finding Rate Limit Errors

```sql
SELECT 
  g.id,
  g.user_id,
  g.model_id,
  g.parameters->>'error' as error_message,
  g.created_at,
  p.display_name as user_display_name
FROM generations g
LEFT JOIN profiles p ON g.user_id = p.id
WHERE g.status = 'failed'
  AND (
    g.parameters->>'error' ILIKE '%rate limit%'
    OR g.parameters->>'error' ILIKE '%429%'
    OR g.parameters->'errorContext'->>'type' = 'RateLimitError'
  )
ORDER BY g.created_at DESC;
```

## Tips

1. **Regular Monitoring**: Run queries daily to catch patterns
2. **User Impact**: Use the `byUser` grouping in the API to see which users are most affected
3. **Model-Specific Issues**: Group by `model_id` to identify problematic models
4. **Time Patterns**: Check if failures cluster at certain times (might indicate rate limits)
5. **Error Types**: Group by error type to identify common failure modes
