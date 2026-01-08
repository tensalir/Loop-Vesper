# Debug: Generation Failed Errors

## Summary of Fixes Applied

### Issue 1: Request Body Read Twice ✅ **FIXED**
**Location**: `app/api/generate/process/route.ts`  
**Problem**: Error handler tried to read `request.json()` again after it was already consumed on line 13.  
**Fix**: Read body once and store in variable for use throughout function.

### Issue 2: Non-JSON Error Responses ✅ **FIXED**  
**Location**: `lib/models/adapters/replicate.ts`, `hooks/useGenerateMutation.ts`  
**Problem**: When API returns non-JSON error (e.g., "Request Error"), code tried to `.json()` it, causing "Unexpected token 'R'" error.  
**Fix**: Add defensive try-catch with fallback to `.text()`.

---

## How to Debug If Still Failing

### Step 1: Check Recent Logs in Vercel

1. Go to Vercel Dashboard → Your Project → Functions → Logs
2. Look for recent calls to `/api/generate` or `/api/generate/process`
3. Filter for **Error** level logs
4. Copy any error messages

### Step 2: Check Browser Console

1. Open DevTools (F12)
2. Go to Console tab
3. Trigger a generation
4. Look for:
   - Error messages from `useGenerateMutation.ts`
   - Network errors in Network tab
   - Red error messages

### Step 3: Check Network Tab

1. Open DevTools → Network tab
2. Trigger generation
3. Find the `/api/generate` request
4. Click on it to see:
   - **Request**: What was sent
   - **Response**: What was received
   - Check if Response tab shows "Request Error" or similar

### Step 4: Check Database

Query for recent generations:

```sql
SELECT 
  id,
  status,
  model_id,
  prompt,
  parameters->>'error' as error_message,
  created_at
FROM generations
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Common Error Scenarios

### Scenario 1: "Unexpected token 'R'" Error
**Cause**: API returned non-JSON response (likely "Request Error" as text)  
**Status**: ✅ Should be fixed by defensive parsing  
**Check**: Look for response body in Network tab

### Scenario 2: Generation Status Stuck at "processing"
**Cause**: Background process never completes or errors silently  
**Check**: Vercel logs for `/api/generate/process` endpoint  
**Fix**: Ensure environment variables are set (API keys)

### Scenario 3: "Generation Failed" But No Logs
**Cause**: Error happened in browser/client side  
**Check**: Browser console for errors  
**Fix**: Check if mutation is hitting catch block in `useGenerateMutation.ts`

---

## What to Look For

### In Vercel Logs:
- ✅ Look for: `/api/generate` with status 200
- ✅ Look for: `/api/generate/process` with status 200  
- ❌ Red error messages
- ❌ Timeouts
- ❌ Connection errors

### In Browser Console:
- ✅ "Generation mutation success" messages
- ❌ "Generation failed:" errors
- ❌ Fetch errors
- ❌ JSON parse errors

### In Network Tab:
- ✅ Response should be JSON with `{id, status: "processing"}`
- ❌ Response should NOT be plain text like "Request Error"
- ❌ Status code should be 200 (not 500, 502, etc.)

---

## Next Steps If Still Failing

1. Share the **exact error message** from browser console
2. Share the **Vercel log entry** for the failing request
3. Share the **Network tab response** for `/api/generate` request
4. Check if the issue is **model-specific** (Nano Banana vs Seedream 4)

**Important**: The fixes have been deployed. If you're still seeing errors, they may indicate a different root cause (e.g., invalid API keys, Replicate service issues, etc.)

