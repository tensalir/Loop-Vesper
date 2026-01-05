# Generation Output Uploads Are Sequential

## Problem Summary
The generation process uploads outputs one-by-one. For multi-output image jobs this extends total processing time and increases timeout risk.

## Evidence
- `app/api/generate/process/route.ts` loops over outputs with `for` and awaits each upload in sequence.

## Impact
- Slower completion for multi-output generations
- Higher serverless runtime and timeout risk

## Proposed Fix
1. Use a concurrency limiter (`p-limit`) and upload outputs in parallel (limit 2-4).
2. Preserve ordering by mapping output index to storage path.
3. Keep current fallback behavior for failed uploads.

## Acceptance Criteria
- Multi-output generations complete faster.
- No increase in upload error rate.

## Related File
- `app/api/generate/process/route.ts`
