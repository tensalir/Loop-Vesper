# Checking and Recovering Stuck Generations

## Quick Check

Run this query in **Supabase SQL Editor** to find stuck generations:

```sql
SELECT 
  id,
  status,
  LEFT(prompt, 50) AS prompt_preview,
  model_id,
  created_at,
  NOW() - created_at AS age,
  EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 AS age_minutes,
  parameters->>'error' AS error_message,
  (SELECT COUNT(*) FROM outputs WHERE generation_id = generations.id) AS output_count
FROM generations
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes'
ORDER BY created_at DESC;
```

## Check Specific Generation

If you have the generation ID (e.g., from Vercel logs):

```sql
SELECT 
  id,
  status,
  prompt,
  model_id,
  created_at,
  NOW() - created_at AS age,
  parameters,
  (SELECT COUNT(*) FROM outputs WHERE generation_id = generations.id) AS output_count
FROM generations
WHERE id = 'YOUR_GENERATION_ID_HERE';
```

## Common Issues

### 1. Generation stuck in "processing" status
**Symptoms:** Status is "processing" but created_at is > 10 minutes ago, no outputs

**Likely cause:** Background processing trigger failed or process endpoint timed out

**Solution:**
```sql
-- Manually mark as failed
UPDATE generations
SET status = 'failed',
    parameters = jsonb_set(
      COALESCE(parameters, '{}'::jsonb),
      '{error}',
      '"Processing timed out - manually marked as failed"'
    )
WHERE id = 'YOUR_GENERATION_ID_HERE';
```

### 2. Process endpoint never called
**Symptoms:** Generation created in logs, but no `/api/generate/process` logs

**Likely cause:** Internal fetch to trigger background processing failed

**Solution:** Manually trigger the process endpoint:
- Use the API directly: `POST https://your-domain.vercel.app/api/generate/process`
- Body: `{ "generationId": "YOUR_GENERATION_ID_HERE" }`
- Or create a recovery script (see below)

### 3. Process endpoint hanging
**Symptoms:** Process endpoint called but no completion logs

**Likely cause:** Model API call timing out or hanging

**Solution:** The generation should eventually timeout at Vercel's limit (10s for Hobby, 60s for Pro). If stuck:
1. Check Vercel logs for timeout errors
2. Mark generation as failed manually if needed

## Recovery Script

Create a simple recovery endpoint to manually trigger stuck generations:

```typescript
// app/api/admin/recover-generation/route.ts
// (Add authentication!)

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  const { generationId } = await request.json()
  
  // Trigger the process endpoint
  const baseUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}`
    : request.nextUrl.origin
  
  try {
    const response = await fetch(`${baseUrl}/api/generate/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId }),
    })
    
    return NextResponse.json({ 
      success: response.ok,
      status: response.status,
      message: await response.text()
    })
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message 
    }, { status: 500 })
  }
}
```

## Prevention

To prevent stuck generations:

1. **Monitor processing time** - Set alerts for generations stuck > 10 minutes
2. **Add retry logic** - The generate endpoint already retries 3 times
3. **Add timeout handling** - Model adapters should have timeouts
4. **Better error logging** - Check Vercel function logs for clues

## Stopping/Cancelling Generations in Supabase

### Cancel a Specific Generation

If you know the generation ID and want to cancel it directly in Supabase:

```sql
UPDATE generations
SET status = 'cancelled',
    parameters = jsonb_set(
      jsonb_set(
        COALESCE(parameters, '{}'::jsonb),
        '{cancelledAt}',
        to_jsonb(NOW()::text)
      ),
      '{cancelledReason}',
      '"Cancelled manually in Supabase"'
    )
WHERE id = 'YOUR_GENERATION_ID_HERE'
  AND status = 'processing';
```

**Important:** The process endpoint now checks for `'cancelled'` status and will skip processing if a generation is cancelled. This means:
- Cancelling via the UI updates status to `'cancelled'`
- Cancelling via SQL also works
- If the background process hasn't started yet, it will see the cancelled status and skip
- If the background process is already running, it may still complete (though you can stop it by marking as cancelled, and it won't process new cancelled generations)

### Cancel All Processing Generations (Use with Caution!)

To cancel all generations that are stuck in processing status:

```sql
UPDATE generations
SET status = 'cancelled',
    parameters = jsonb_set(
      jsonb_set(
        COALESCE(parameters, '{}'::jsonb),
        '{cancelledAt}',
        to_jsonb(NOW()::text)
      ),
      '{cancelledReason}',
      '"Bulk cancelled via SQL"'
    )
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes';
```

### Cancel All Processing Generations in a Session

If you want to cancel all processing generations for a specific session:

```sql
UPDATE generations
SET status = 'cancelled',
    parameters = jsonb_set(
      jsonb_set(
        COALESCE(parameters, '{}'::jsonb),
        '{cancelledAt}',
        to_jsonb(NOW()::text)
      ),
      '{cancelledReason}',
      '"Cancelled via SQL for session cleanup"'
    )
WHERE session_id = 'YOUR_SESSION_ID_HERE'
  AND status = 'processing';
```

## Check Recent Activity

See all recent generations and their status:

```sql
SELECT 
  id,
  status,
  LEFT(prompt, 30) AS prompt_preview,
  model_id,
  created_at,
  NOW() - created_at AS age,
  (SELECT COUNT(*) FROM outputs WHERE generation_id = generations.id) AS output_count
FROM generations
ORDER BY created_at DESC
LIMIT 20;
```
