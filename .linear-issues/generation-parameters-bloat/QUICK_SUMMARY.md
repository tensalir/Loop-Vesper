# Quick Summary: Generation Parameters Payload Bloat

## The Problem
Reference images are stored as base64 in `Generation.parameters` and returned in the generations feed. This bloats DB rows, increases query time, and sends huge JSON payloads to the client.

## Impact
- Slow generation feed loads
- Higher bandwidth and memory usage
- Risk of timeouts and sluggish UI

## Quick Fix
1. Persist all reference images to storage and store only pointers/IDs.
2. Strip base64 blobs and debug logs from `/api/generations` responses.
3. Add an explicit `includeParameters=true` flag for the rare cases that need full payloads.

## Key Files
- `app/api/generate/route.ts`
- `app/api/generate/process/route.ts`
- `app/api/generations/route.ts`
