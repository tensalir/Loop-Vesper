# Quick Summary: Generation Output Uploads Are Sequential

## The Problem
`/api/generate/process` uploads each output sequentially. For multi-output generations this extends latency and risks serverless timeouts.

## Impact
- Longer end-to-end generation time
- Higher timeout risk under load

## Quick Fix
- Upload outputs concurrently with a small concurrency limit (e.g., 2-4).

## Key File
- `app/api/generate/process/route.ts`
