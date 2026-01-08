# Performance Optimization Testing Checklist

Use this checklist to verify all performance improvements are working correctly.

## Pre-Deployment Checks

- [ ] Environment variable `SUPABASE_SERVICE_ROLE_KEY` added to Vercel
- [ ] Prisma client regenerated (`npx prisma generate`)
- [ ] Supabase Realtime enabled for `generations` and `outputs` tables
- [ ] Storage buckets exist: `generated-images` and `generated-videos`
- [ ] Deployed to Vercel successfully
- [ ] Run `npm run test:e2e` locally (Playwright)

---

## Functional Tests

### ✅ Test 1: Async Generation (Issue #1)

**Goal**: Verify API returns immediately and progress bar shows

1. Open your app in browser
2. Open browser DevTools → Network tab
3. Click "Generate" with a prompt
4. **Expected Results**:
   - [ ] API `/api/generate` responds in < 1 second
   - [ ] Response status is `"processing"`
   - [ ] Progress bar appears immediately
   - [ ] Progress bar shows animated loading state
   - [ ] After 20-60 seconds, images appear
   - [ ] No timeout errors in console

**If failed**: Check Vercel logs for errors in `/api/generate/process`

---

### ✅ Test 2: Image Storage (Issue #2)

**Goal**: Verify images are uploaded to Supabase Storage, not stored as base64

1. Generate an image using Gemini (Nano Banana) model
2. Wait for completion
3. Go to Supabase Dashboard → Storage → `generated-images`
4. Navigate to your user folder
5. **Expected Results**:
   - [ ] Images are stored in Storage at path `{userId}/{generationId}/0.png`
   - [ ] Image URLs in database start with `https://` (not `data:image`)
   - [ ] Images load quickly in the gallery

**If failed**: 
- Check `SUPABASE_SERVICE_ROLE_KEY` is set
- Check Vercel logs for upload errors
- Verify storage bucket policies allow uploads

---

### ✅ Test 3: Real-Time Updates (Issue #3)

**Goal**: Verify Supabase Realtime triggers updates

1. Open browser DevTools → Console
2. Generate an image
3. Watch console logs
4. **Expected Results**:
   - [ ] See log: `🔴 Subscribing to real-time updates for session: {id}`
   - [ ] See log: `🔴 Realtime subscription status: SUBSCRIBED`
   - [ ] When generation completes, see: `🔴 Generation change detected`
   - [ ] Images appear instantly (not after 2 second poll delay)

**If failed**:
- Check Supabase Realtime is enabled for tables
- Polling should still work as fallback (2 second delay)

---

### ✅ Test 4: Pagination (Issue #4)

**Goal**: Verify API uses pagination

1. Open browser DevTools → Network tab
2. Load a session
3. Check the `/api/generations` request
4. **Expected Results**:
   - [ ] Request includes `?sessionId=xxx&limit=20`
   - [ ] Response has structure: `{ data: [...], pagination: { hasMore, nextCursor } }`
   - [ ] Only 20 generations loaded (not all 100+)
   - [ ] Page loads faster than before

**If failed**: Check API route changes were deployed

---

### ✅ Test 5: Image Browse Modal (Issue #6)

**Goal**: Verify modal uses optimized single-query endpoint

1. Open video session (or any session)
2. Click to browse for reference images
3. Open browser DevTools → Network tab
4. **Expected Results**:
   - [ ] Single request to `/api/projects/{id}/images`
   - [ ] No multiple requests to `/api/generations`
   - [ ] Modal loads in < 1 second
   - [ ] All project images shown

**If failed**: Check modal changes were deployed

---

## Performance Benchmarks

Run these tests and compare to "before" times:

| Test | Before | Target | Actual | Pass? |
|------|--------|--------|--------|-------|
| API response time | 30s-5min | <1s | ___ | [ ] |
| Progress bar appears | Never | Immediate | ___ | [ ] |
| Initial session load | 10-30s | <3s | ___ | [ ] |
| Image browse modal | 3-5s | <1s | ___ | [ ] |
| 4 image generation | 30-60s | 30-60s* | ___ | [ ] |

*Generation time won't change (AI is still slow), but UX is much better

---

## Stress Tests

### Test: Multiple Concurrent Generations

1. Open your app
2. Generate 4 images (Nano Banana, 4 outputs)
3. Immediately switch to another session
4. Generate 4 more images
5. **Expected Results**:
   - [ ] Both generations work simultaneously
   - [ ] No errors or conflicts
   - [ ] Both show progress bars
   - [ ] All complete successfully
   - [ ] No Vercel timeout errors

---

### Test: Large Session Load

1. Create a session with 30+ generations
2. Switch to that session
3. **Expected Results**:
   - [ ] Page loads in < 5 seconds
   - [ ] Only 20 generations shown (pagination)
   - [ ] Smooth scrolling
   - [ ] No browser lag

---

## Error Handling Tests

### Test: Failed Generation

1. Generate with invalid API key (temporarily)
2. **Expected Results**:
   - [ ] Progress bar appears
   - [ ] After timeout, shows error state
   - [ ] Error message is clear
   - [ ] Can retry generation

---

### Test: Network Interruption

1. Start generation
2. Go offline (disable network)
3. Wait 30 seconds
4. Go back online
5. **Expected Results**:
   - [ ] Polling resumes automatically
   - [ ] Generation status updates
   - [ ] Images appear when complete

---

## Browser Console Checks

Look for these log messages during generation:

**On Generate Click**:
```
[{generationId}] Generation created, starting async processing
✓ Replacing optimistic generation: temp-xxx → real-id
📊 Polling: 1 generation(s) in progress (occasional)
```

**On Completion**:
```
[{generationId}] Generation completed successfully
🔴 Generation change detected: UPDATE {id}
```

**Realtime Connection**:
```
🔴 Subscribing to real-time updates for session: {id}
🔴 Realtime subscription status: SUBSCRIBED
```

---

## Vercel Logs to Check

Go to Vercel → Deployments → Your deployment → Functions

**Look for**:

1. **`/api/generate`** - Should show:
   ```
   [{generationId}] Generation created, starting async processing
   ```
   Duration: < 1 second

2. **`/api/generate/process`** - Should show:
   ```
   [{generationId}] Starting generation with model {modelId}
   [{generationId}] Generation result: completed
   [{generationId}] Uploading base64 image 0 to storage
   [{generationId}] Uploaded to: https://...
   [{generationId}] Generation completed successfully
   ```
   Duration: 20-60 seconds

**Red flags**:
- ❌ Timeout errors
- ❌ "Storage upload failed" errors
- ❌ "SUPABASE_SERVICE_ROLE_KEY not set"
- ❌ 500 errors

---

## Database Verification

Check PostgreSQL directly (via Supabase SQL Editor):

```sql
-- Check generation statuses
SELECT status, COUNT(*) 
FROM generations 
GROUP BY status;

-- Check recent outputs have Supabase URLs (not data URLs)
SELECT 
  id,
  CASE 
    WHEN file_url LIKE 'data:%' THEN 'BASE64 ❌'
    WHEN file_url LIKE 'https://%' THEN 'URL ✅'
    ELSE 'UNKNOWN'
  END as url_type,
  LENGTH(file_url) as url_length
FROM outputs
ORDER BY created_at DESC
LIMIT 10;
```

**Expected**:
- All recent outputs should have `url_type = 'URL ✅'`
- URL length should be < 500 characters
- No `BASE64 ❌` entries (except old ones before this update)

---

## Common Issues & Solutions

### Issue: "Progress bar doesn't show"
**Debug**:
1. Check browser console for errors
2. Verify `/api/generate` returns `{ status: 'processing' }`
3. Check React Query DevTools - should show processing generation
4. Verify polling is active

**Solution**: Clear browser cache and retry

---

### Issue: "Images still load slowly"
**Debug**:
1. Check image URLs in database - should be `https://`, not `data:`
2. Check Supabase Storage - should have files
3. Check Vercel logs for upload errors

**Solution**: 
- Add `SUPABASE_SERVICE_ROLE_KEY`
- Fix storage bucket policies
- Check firewall/CORS settings

---

### Issue: "Realtime not working"
**Debug**:
1. Check console for "Realtime subscription status"
2. Verify Supabase Realtime is enabled for tables
3. Check browser allows WebSocket connections

**Solution**: 
- Enable Realtime in Supabase
- Polling works as fallback anyway

---

### Issue: "Background processor fails"
**Debug**:
1. Check Vercel function logs
2. Look for API key errors
3. Check AI service rate limits

**Solution**:
- Verify all API keys are set
- Check API service status pages
- Wait for rate limit reset

---

## Success Criteria

All tests pass when:

- ✅ API responds in < 1 second
- ✅ Progress bar shows immediately
- ✅ Images load within expected AI generation time (20-60s)
- ✅ No timeout errors
- ✅ Images stored in Supabase Storage
- ✅ Database queries are fast
- ✅ Multiple generations work concurrently
- ✅ Real-time updates work (or polling fallback)
- ✅ No errors in console or Vercel logs

---

## After Testing

If all tests pass:
- ✅ Mark todos as complete
- ✅ Update PROGRESS.md
- ✅ Close performance issue tickets
- ✅ Celebrate! 🎉

If tests fail:
- Review error logs
- Check ENV_UPDATE_REQUIRED.md
- Check PERFORMANCE_IMPLEMENTATION_SUMMARY.md troubleshooting section
- Open GitHub issue with specific error details

