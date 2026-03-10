# Quick Summary: Stuck Generations Issue

## The Problem
Generations get stuck in `processing` state and never complete. Happening randomly - same prompts that worked before now fail intermittently.

## When It Started
- ✅ **After** session feed stability refactor (Dec 17, 2025) - everything worked
- ❌ **Later same day** - started failing randomly

## What's Happening
1. User clicks "Generate" → Generation record created ✅
2. Server tries to trigger background process → **401 Unauthorized** ❌
3. Frontend fallback tries to trigger → **401 Unauthorized** ❌
4. Generation stuck forever in `processing` state ❌

## What We've Tried
- ✅ Added debug logging for `INTERNAL_API_SECRET` and auth checks
- ✅ Improved frontend fallback with retry logic (3 attempts)
- ✅ Added explicit `credentials: 'include'` for cookies
- ✅ Added dismiss button for stuck generations
- ❌ Issue persists

## Key Files
- `app/api/generate/route.ts` - Creates generation, tries server-side trigger
- `app/api/generate/process/route.ts` - Processes generation (requires auth)
- `hooks/useGenerateMutation.ts` - Frontend fallback trigger

## Environment Variable
- `INTERNAL_API_SECRET=<REDACTED — rotate this value>`
- ⚠️ Verify it's set for **all** environments (Production, Preview, Development)

## Next Steps
1. Verify `INTERNAL_API_SECRET` is available to all Vercel functions
2. Check Vercel logs for auth check details
3. Test both server-side and frontend triggers
4. Consider enabling queue system (`GENERATION_QUEUE_ENABLED=true`)

## Full Details
See [ISSUE.md](./ISSUE.md) for comprehensive breakdown.
