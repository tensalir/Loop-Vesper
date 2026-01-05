# Quick Summary: Process Endpoint Authorization Gap

## The Problem
`/api/generate/process` accepts any authenticated user and processes any `generationId` without ownership checks. This is a security risk and can be abused to waste compute.

## Impact
- Unauthorized users can trigger processing for other users' generations
- Potential DoS and cost amplification

## Quick Fix
- When no internal secret is used, verify the generation belongs to the current user or their project membership before processing.

## Key File
- `app/api/generate/process/route.ts`
