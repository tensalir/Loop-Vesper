# Generation Parameters Payload Bloat

## Problem Summary
Reference images are passed as base64 data URLs, stored in `Generation.parameters`, and then returned wholesale from `/api/generations`. This makes each generation row large, slows queries and transfers, and causes the generations feed to ship unnecessary megabytes to the browser.

## Evidence
- `app/api/generate/route.ts` accepts and stores `referenceImage` and `referenceImages` inside `parameters`.
- `app/api/generate/process/route.ts` uses `parameters.referenceImages` and may rehydrate URLs, so large blobs persist in DB.
- `app/api/generations/route.ts` returns `parameters` for every generation, so base64 data and debug logs are sent to the client.

## Impact
- Slow pagination and longer response times as table grows
- Increased memory usage in serverless functions and browser
- Poor UX when scrolling large sessions

## Proposed Fix
1. Persist all reference images (single and multiple) to storage and store only pointers (IDs/paths) in `parameters`.
2. Sanitize generation payloads in `/api/generations`:
   - Remove `referenceImage`, `referenceImages`, `debugLogs`, and other large debug fields.
   - Keep only the minimal fields the UI needs.
3. Add an opt-in `includeParameters=true` query param for admin/debug views.
4. Optional: move reference image metadata to a dedicated table to avoid JSON bloat.

## Acceptance Criteria
- Generations list API returns small, stable payloads regardless of reference image size.
- No base64 blobs stored in `Generation.parameters` for new generations.
- UI behavior unchanged for reference image previews.

## Related Files
- `app/api/generate/route.ts`
- `app/api/generate/process/route.ts`
- `app/api/generations/route.ts`
