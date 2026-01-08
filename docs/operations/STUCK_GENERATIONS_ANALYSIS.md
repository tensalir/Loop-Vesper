# 🔍 Stuck Generations Analysis & Solution Guide

## Problem Summary

Images are getting stuck at **95% "Finalizing output"** and never completing. This happens because:

1. **Vercel Serverless Function Timeouts**: The `/api/generate/process` endpoint exceeds Vercel's timeout limits
2. **No Timeout Detection**: Generations stay in "processing" status indefinitely when functions timeout
3. **Fake Progress Bar**: The UI shows 95% based on elapsed time, not actual generation progress
4. **No Automatic Cleanup**: Stuck generations never get marked as failed automatically

---

## Root Cause Analysis

### 1. Vercel Function Timeout Limits

**Vercel Plan Limits:**
- **Hobby Plan**: 10 seconds max execution time
- **Pro Plan**: 60 seconds max execution time

**What Happens:**
- `/api/generate/process` route calls `model.generate()` which can take:
  - **FAL adapter**: Up to 5 minutes (polls every 5s for 60 attempts)
  - **Gemini adapter**: 10-30 seconds typically
- Then uploads images to Supabase Storage (additional 5-10 seconds)
- **Total time can easily exceed 60 seconds** → Function times out → Generation never completes

### 2. Flow Breakdown

```
User clicks Generate
  ↓
/api/generate creates DB record (status: 'processing')
  ↓
Returns immediately (<500ms) ✅
  ↓
Triggers /api/generate/process (fire-and-forget)
  ↓
[Inside process route]
  - Calls model.generate() (30s - 5min)
  - Uploads to storage (5-10s)
  - Updates DB to 'completed'
  ↓
❌ FUNCTION TIMES OUT AT 60 SECONDS
  ↓
Generation stays "processing" forever
  ↓
Frontend shows "95% Finalizing output" (fake progress)
```

### 3. Current Code Issues

**`app/api/generate/process/route.ts`:**
- No timeout handling for long-running operations
- No retry mechanism if function times out
- Error handling catches exceptions but doesn't handle timeouts

**`components/generation/GenerationProgress.tsx`:**
- Shows fake progress (client-side timer)
- Caps at 95% until real completion
- No way to detect actual generation status

**`hooks/useGenerations.ts`:**
- Polls every 2 seconds but never detects stuck generations
- No automatic cleanup mechanism

---

## Diagnostic Steps

### Step 1: Check Current Stuck Generations

Run this SQL query in **Supabase SQL Editor**:

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
  parameters->>'lastStep' AS last_step,
  parameters->>'lastHeartbeatAt' AS last_heartbeat,
  (SELECT COUNT(*) FROM outputs WHERE generation_id = generations.id) AS output_count
FROM generations
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '2 minutes'
ORDER BY created_at DESC;
```

**Expected Results:**
- If you see generations older than 2 minutes still "processing" → They're stuck
- Check `last_step` and `last_heartbeat` to see where they stopped

### Step 2: Check Vercel Logs

1. Go to **Vercel Dashboard** → Your Project → **Logs**
2. Filter for `/api/generate/process`
3. Look for:
   - `FUNCTION_INVOCATION_TIMEOUT` errors
   - `Function execution timed out` messages
   - Generations that start but never complete

### Step 3: Check Function Execution Time

Look for patterns in logs:
- Generations completing in < 10 seconds → OK
- Generations taking 30-60 seconds → At risk
- Generations taking > 60 seconds → **Will timeout on Pro plan**

---

## Solutions

### ✅ Solution 1: Immediate Fix - Mark Stuck Generations as Failed

**For existing stuck generations**, run this SQL:

```sql
-- Mark all generations stuck > 5 minutes as failed
UPDATE generations
SET status = 'failed',
    parameters = jsonb_set(
      COALESCE(parameters, '{}'::jsonb),
      '{error}',
      '"Processing timed out - Vercel function execution limit exceeded"'
    )
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes';
```

### ✅ Solution 2: Add Automatic Timeout Detection (Recommended)

Create a new API endpoint to detect and cleanup stuck generations:

**File**: `app/api/admin/cleanup-stuck-generations/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

/**
 * Cleanup endpoint for stuck generations
 * Marks generations as failed if they've been processing > 5 minutes
 * Can be called manually or via cron job
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find generations stuck > 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    
    const stuckGenerations = await prisma.generation.findMany({
      where: {
        status: 'processing',
        createdAt: {
          lt: fiveMinutesAgo,
        },
      },
    })

    if (stuckGenerations.length === 0) {
      return NextResponse.json({ 
        message: 'No stuck generations found',
        cleaned: 0 
      })
    }

    // Mark as failed
    const result = await prisma.generation.updateMany({
      where: {
        id: {
          in: stuckGenerations.map(g => g.id),
        },
        status: 'processing',
      },
      data: {
        status: 'failed',
        parameters: {
          // Preserve existing parameters
          ...(stuckGenerations[0].parameters as any || {}),
          error: 'Processing timed out - exceeded Vercel function execution limit',
          timeoutDetectedAt: new Date().toISOString(),
        },
      },
    })

    return NextResponse.json({
      message: `Cleaned up ${result.count} stuck generation(s)`,
      cleaned: result.count,
      generationIds: stuckGenerations.map(g => g.id),
    })
  } catch (error: any) {
    console.error('Error cleaning up stuck generations:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to cleanup stuck generations' },
      { status: 500 }
    )
  }
}
```

**Call this endpoint:**
```bash
# Via curl or fetch
POST /api/admin/cleanup-stuck-generations
```

### ✅ Solution 3: Add Timeout Handling to Process Route

**Modify**: `app/api/generate/process/route.ts`

Add timeout wrapper around the model.generate() call:

```typescript
// Add at top of file
const MAX_GENERATION_TIME = 50 * 1000 // 50 seconds (leave buffer for Vercel)

// Wrap model.generate() call with timeout
const generationPromise = model.generate({
  prompt: generation.prompt,
  negativePrompt: generation.negativePrompt || undefined,
  referenceImage,
  referenceImageUrl,
  parameters: otherParameters,
  ...otherParameters,
})

const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => {
    reject(new Error('Generation timeout - exceeded maximum execution time'))
  }, MAX_GENERATION_TIME)
})

let result
try {
  result = await Promise.race([generationPromise, timeoutPromise])
} catch (error: any) {
  if (error.message.includes('timeout')) {
    // Mark as failed due to timeout
    await prisma.generation.update({
      where: { id: generation.id },
      data: { 
        status: 'failed',
        parameters: {
          ...(generation.parameters as any),
          error: 'Generation timed out - exceeded Vercel function execution limit',
        }
      },
    })
    return NextResponse.json({
      id: generation.id,
      status: 'failed',
      error: 'Generation timed out',
    })
  }
  throw error
}
```

### ✅ Solution 4: Upgrade to Vercel Pro Plan (If Possible)

**Vercel Pro Plan Benefits:**
- 60-second timeout (vs 10s on Hobby)
- Better for long-running operations
- Still may timeout for FAL generations (5 minutes max)

**Cost**: ~$20/month per member

### ✅ Solution 5: Use External Queue System (Best Long-term Solution)

**Options:**
1. **Vercel Cron Jobs** + Background Worker
   - Create a separate worker that processes generations
   - Use cron to trigger stuck generation cleanup
   
2. **Inngest** (Recommended)
   - Built for serverless background jobs
   - Handles retries, timeouts, and monitoring
   - Free tier available

3. **Supabase Edge Functions**
   - Can run longer than Vercel functions
   - Integrated with your database

4. **Custom Worker Service**
   - Separate Node.js service running on Railway/Render
   - Processes generations queue

---

## Immediate Action Plan

### Step 1: Clean Up Existing Stuck Generations (5 minutes)

```sql
-- Run in Supabase SQL Editor
UPDATE generations
SET status = 'failed',
    parameters = jsonb_set(
      COALESCE(parameters, '{}'::jsonb),
      '{error}',
      '"Processing timed out - manually marked as failed"'
    )
WHERE status = 'processing'
  AND created_at < NOW() - INTERVAL '5 minutes';
```

### Step 2: Add Cleanup Endpoint (15 minutes)

1. Create `app/api/admin/cleanup-stuck-generations/route.ts` (see Solution 2 above)
2. Test it by calling the endpoint
3. Optionally set up a cron job to call it every 5 minutes

### Step 3: Add Timeout Handling (30 minutes)

1. Modify `app/api/generate/process/route.ts` to add timeout (see Solution 3)
2. Test with a generation to ensure it fails gracefully

### Step 4: Monitor and Adjust (Ongoing)

1. Check Vercel logs weekly for timeout patterns
2. Adjust timeout values based on actual generation times
3. Consider upgrading to Pro plan or implementing queue system

---

## Prevention

### Short-term (Next Week)
- ✅ Add automatic cleanup endpoint
- ✅ Add timeout handling to process route
- ✅ Monitor Vercel logs for timeout patterns

### Medium-term (Next Month)
- ⚠️ Upgrade to Vercel Pro (if budget allows)
- ⚠️ Implement Inngest or similar queue system
- ⚠️ Add retry logic for failed generations

### Long-term (Next Quarter)
- 🎯 Move to dedicated background worker service
- 🎯 Implement proper job queue (BullMQ, Inngest, etc.)
- 🎯 Add generation progress tracking from actual API responses

---

## Testing Checklist

After implementing fixes:

- [ ] Run cleanup endpoint - should mark stuck generations as failed
- [ ] Create new generation - should complete or fail gracefully
- [ ] Check Vercel logs - should see timeout errors handled properly
- [ ] Verify frontend - stuck generations should show as failed
- [ ] Test with FAL model - should timeout gracefully if > 50 seconds
- [ ] Test with Gemini model - should complete normally

---

## Questions to Answer

1. **What's your Vercel plan?** (Hobby = 10s timeout, Pro = 60s timeout)
2. **Which models are failing?** (Check `model_id` in stuck generations)
3. **What's the average generation time?** (Check logs)
4. **Budget for solutions?** (Pro plan vs. queue system)

---

## Related Files

- `app/api/generate/process/route.ts` - Background processor (needs timeout handling)
- `app/api/generate/route.ts` - Main generation endpoint
- `components/generation/GenerationProgress.tsx` - Fake progress bar (needs real status)
- `hooks/useGenerations.ts` - Polling hook (needs stuck detection)
- `docs/CHECK_STUCK_GENERATIONS.md` - Existing documentation

---

## Next Steps

1. **Immediate**: Clean up existing stuck generations
2. **This Week**: Add cleanup endpoint and timeout handling
3. **This Month**: Evaluate Vercel Pro upgrade or queue system
4. **This Quarter**: Implement proper background job system

