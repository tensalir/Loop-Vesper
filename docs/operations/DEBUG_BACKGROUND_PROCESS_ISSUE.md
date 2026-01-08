# 🔍 Debugging Background Process Not Starting

## Problem

Generations are stuck with `last_step: "generate:create"` and `last_heartbeat: null`, meaning the `/api/generate/process` endpoint is **never being called**.

## Root Cause Analysis

Based on the logs:
- ✅ Generation is created successfully (`generate:create`)
- ❌ Background process trigger is failing silently
- ❌ No logs in Vercel showing `/api/generate/process` being called

## Possible Causes

### 1. VERCEL_URL Environment Variable Issue
- `VERCEL_URL` might not be set correctly
- URL might be missing protocol (`https://`)
- Internal fetch might be blocked

### 2. Vercel Internal Fetch Limitations
- Vercel serverless functions might not support internal HTTP calls during function execution
- The function might be ending before the fetch completes
- Fire-and-forget pattern might not work in Vercel

### 3. Network/Timeout Issues
- Fetch might be timing out silently
- Connection might be refused
- DNS resolution might fail

## What We've Added

1. **Better URL handling** - Checks for protocol, tries multiple env vars
2. **Enhanced logging** - Logs the URL being called, response status
3. **Timeout signal** - 10 second timeout to prevent hanging
4. **Better error logging** - Logs full error details including stack trace

## Next Steps to Debug

### Step 1: Check Vercel Logs

Look for these log messages in Vercel function logs:
- `[GENERATION_ID] Triggering background process at: ...`
- `[GENERATION_ID] Attempt 1: Calling ...`
- `[GENERATION_ID] Response status: ...`
- `[GENERATION_ID] Background processing trigger attempt X failed: ...`

### Step 2: Check Environment Variables

In Vercel Dashboard → Settings → Environment Variables, verify:
- `VERCEL_URL` is set (automatically set by Vercel)
- Check what value it has (should be your deployment URL)

### Step 3: Test Process Endpoint Directly

Try calling the process endpoint manually:

```bash
curl -X POST https://your-app.vercel.app/api/generate/process \
  -H "Content-Type: application/json" \
  -d '{"generationId": "YOUR_GENERATION_ID"}'
```

### Step 4: Alternative Solutions

If internal fetch doesn't work, consider:

1. **Vercel Cron Jobs** - Schedule a cron to check for pending generations
2. **Queue System** - Use Inngest, Trigger.dev, or similar
3. **Edge Functions** - Use Supabase Edge Functions which can run longer
4. **Polling Pattern** - Have the frontend poll and trigger the process endpoint

## Current Status

After deploying the improved logging, check Vercel logs for:
- What URL is being constructed
- Whether the fetch is being attempted
- What error (if any) is occurring

This will tell us if it's:
- ✅ **Our code** - URL construction issue, wrong endpoint
- ✅ **Vercel limitation** - Internal fetches not working
- ✅ **Network issue** - Timeout, connection refused

## Quick Fix: Manual Trigger

If you need to process a stuck generation immediately:

```bash
POST /api/generate/process
Body: { "generationId": "6fc2c175-4cef-47c2-902a-736993727266" }
```

Or use the Supabase SQL to manually update status to failed.

