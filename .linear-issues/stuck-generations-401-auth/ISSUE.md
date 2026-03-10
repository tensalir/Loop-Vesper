# Stuck Generations with 401 Unauthorized Errors

## Problem Summary

Generations are getting stuck in `processing` state and never completing. The issue appears to be related to authentication failures (401 Unauthorized) when the background processing endpoint (`/api/generate/process`) is triggered. This is happening **intermittently** - the same prompt and settings that worked before are now failing randomly.

**Key Symptoms:**
- Generations stuck in `processing` state for 3+ minutes (some up to 22+ minutes)
- Console shows `status: 'processing', outputs: 0` for stuck generations
- 401 Unauthorized errors in logs when calling `/api/generate/process`
- Some generations complete successfully, others get stuck (same prompt/settings)
- Issue started appearing after the session feed stability refactor

## Timeline

### ✅ After Session Feed Stability Refactor (Dec 17, 2025)
- Successfully refactored session feed to fix disappearing/reappearing generations
- Implemented UUID-safe keyset pagination
- Added stable `clientId` for React keys
- Unified gallery rendering (status transitions update in-place)
- **Everything worked perfectly** - generations were completing successfully

### ❌ Issue Started (Dec 17, 2025 - Later Same Day)
- Generations started getting stuck randomly
- Same prompts that worked before now failing intermittently
- Multiple generations stuck: 22min, 8min, 3min (all same session)
- Console shows 401 errors when triggering background process

## Root Cause Analysis

### Primary Issue: Authentication Failure on Background Process Trigger

The flow is:
1. User clicks "Generate" → `/api/generate` creates generation record ✅
2. Server tries to trigger `/api/generate/process` internally → **401 Unauthorized** ❌
3. Frontend fallback tries to trigger `/api/generate/process` → **401 Unauthorized** ❌
4. Generation stays in `processing` state forever ❌

### Why It's Random

The randomness suggests:
1. **Environment variable availability** - `INTERNAL_API_SECRET` might not be consistently available across Vercel serverless functions
2. **Session cookie issues** - Frontend fallback relies on cookies, which might not always be sent correctly
3. **Race conditions** - Multiple triggers happening simultaneously might cause conflicts
4. **Vercel serverless limitations** - Internal server-to-server calls can be unreliable

## What We've Tried

### 1. ✅ Added Debug Logging
**Files Modified:**
- `app/api/generate/route.ts` - Logs `INTERNAL_API_SECRET` availability
- `app/api/generate/process/route.ts` - Logs auth check details

**What We Learned:**
- Need to verify if `INTERNAL_API_SECRET` is actually set in Vercel environment
- Need to see if cookies are being sent from frontend fallback

### 2. ✅ Improved Frontend Fallback Retry Logic
**File Modified:** `hooks/useGenerateMutation.ts`

**Changes:**
- Added retry logic (3 attempts with exponential backoff)
- Added explicit `credentials: 'include'` to ensure cookies are sent
- Better error handling for 401 vs other errors
- More detailed logging

**Status:** Deployed but issue persists

### 3. ✅ Added Dismiss Button for Stuck Generations
**Files Modified:**
- `components/generation/GenerationGallery.tsx` - Added dismiss button
- `components/generation/GenerationInterface.tsx` - Added dismiss handler

**Purpose:** Allow users to manually remove phantom generations that don't exist in database

### 4. 🔍 Identified Potential Issues

**Issue A: `INTERNAL_API_SECRET` Not Set**
- User confirmed it's set in Vercel: `INTERNAL_API_SECRET=<REDACTED — rotate this value>`
- But might not be available to all serverless functions
- Or might be scoped incorrectly (Production vs Preview)

**Issue B: Frontend Fallback Auth**
- Frontend fallback uses cookies for auth
- Cookies might not be sent correctly in some cases
- Session might expire between generation creation and process trigger

**Issue C: Server-Side Trigger Timing**
- Server-side trigger happens in fire-and-forget mode
- Vercel function might terminate before fetch completes
- Internal serverless-to-serverless calls can fail silently

## Evidence & Logs

### Console Logs (Browser)
```
[generation-id] Generation mutation success - status: processing
[generation-id] Frontend fallback: Triggering background process (attempt 1/3)
[generation-id] Frontend trigger failed (attempt 1): 401 Unauthorized
```

### Vercel Logs (Server)
```
[generation-id] Response status: 401 Unauthorized
[process] Auth check - received: NOT RECEIVED, expected: <REDACTED>, match: false
```

### Database State
- Generations stuck with `status: 'processing'`
- `outputs: 0` (no outputs created)
- `lastStep: 'generate:create'` (process never started)
- `lastHeartbeat: null` (no heartbeat updates)

## Relevant Files

### Core Files Modified
1. **`app/api/generate/route.ts`**
   - Creates generation record
   - Tries to trigger background process server-side
   - Includes debug logging for `INTERNAL_API_SECRET`

2. **`app/api/generate/process/route.ts`**
   - Processes generation asynchronously
   - Requires either `INTERNAL_API_SECRET` header OR user session
   - Includes detailed auth check logging

3. **`hooks/useGenerateMutation.ts`**
   - Frontend mutation hook
   - Includes fallback trigger with retry logic
   - Handles optimistic updates

4. **`components/generation/GenerationGallery.tsx`**
   - Displays generations
   - Shows "Stuck" badge for generations > 2 minutes
   - Includes dismiss button

5. **`components/generation/GenerationInterface.tsx`**
   - Main generation feed component
   - Handles dismiss action for stuck generations

### Related Files
- `hooks/useInfiniteGenerations.ts` - Fetches generations with pagination
- `hooks/useGenerationsRealtime.ts` - Real-time updates via Supabase
- `types/generation.ts` - Type definitions including `clientId`

## Environment Variables Required

### Vercel Environment Variables
- `INTERNAL_API_SECRET` - Must be set for **all environments** (Production, Preview, Development)
- Current value: `7b9b1a0c9f3f4d2a8e6c1d0b3a5f9e2c6a8d4f1b0c7e2a9d5f3c1e8b2a6d9c0f`

**⚠️ Important:** Verify this is set for **Preview** deployments (not just Production)

## Next Steps for Developer

### 1. Verify Environment Variables
- [ ] Check Vercel Dashboard → Settings → Environment Variables
- [ ] Confirm `INTERNAL_API_SECRET` is set for **all** environments
- [ ] Verify the value matches what's in the code

### 2. Check Vercel Logs
- [ ] Look for `Internal secret available: true/false` logs
- [ ] Look for `Auth check - received: ...` logs
- [ ] Check if secret is being received on process endpoint

### 3. Test Authentication Flow
- [ ] Test server-side trigger with `INTERNAL_API_SECRET` header
- [ ] Test frontend fallback with session cookies
- [ ] Verify cookies are being sent correctly

### 4. Potential Solutions

**Option A: Fix Server-Side Trigger**
- Ensure `INTERNAL_API_SECRET` is available to all functions
- Use Vercel's internal API for server-to-server calls
- Or use a queue system (already have `GENERATION_QUEUE_ENABLED` flag)

**Option B: Improve Frontend Fallback**
- Ensure cookies are always sent
- Add session refresh before triggering
- Add exponential backoff with jitter

**Option C: Use Queue System**
- Enable `GENERATION_QUEUE_ENABLED=true`
- Use background worker to process generations
- More reliable than fire-and-forget triggers

**Option D: Add Health Check**
- Periodically check for stuck generations
- Auto-retry failed triggers
- Mark as failed after timeout

## Questions to Investigate

1. **Why did it work after the refactor but fail later?**
   - Did we change something in the auth flow?
   - Did Vercel environment variables change?
   - Is there a rate limit we're hitting?

2. **Why is it random?**
   - Is it related to Vercel function cold starts?
   - Are some functions getting the env var and others not?
   - Is there a race condition?

3. **Why does the same prompt work sometimes but not others?**
   - Is it timing-related?
   - Is it function instance-related?
   - Is it session-related?

## Related Issues & Documentation

- `.cursor/plans/session_feed_stability_38ed3e63.plan.md` - Original refactor plan
- `STUCK_GENERATIONS_ANALYSIS.md` - Previous stuck generation analysis
- `DEBUG_BACKGROUND_PROCESS_ISSUE.md` - Background process debugging
- `docs/DEBUG_GENERATION_ERRORS.md` - General error debugging guide

## Impact

- **User Experience:** Generations appear to start but never complete
- **Data Integrity:** Stuck generations clutter the UI
- **Reliability:** Random failures make the system unpredictable
- **Trust:** Users lose confidence when same prompts fail randomly

---

**Created:** December 17, 2025  
**Status:** 🔴 Active Issue  
**Priority:** High  
**Assignee:** TBD
