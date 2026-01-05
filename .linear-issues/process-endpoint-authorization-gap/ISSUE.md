# Process Endpoint Authorization Gap

## Problem Summary
The process endpoint accepts authenticated users but does not verify that the user owns the generation or has access to its project. A user can send any `generationId` and trigger expensive processing.

## Evidence
- `app/api/generate/process/route.ts` checks for a valid session but never verifies generation ownership or project membership before calling `processGenerationById`.

## Impact
- Security exposure (cross-user processing)
- Cost/performance risk (unbounded processing requests)

## Proposed Fix
1. If `x-internal-secret` is valid, keep current behavior.
2. Otherwise, load the generation and verify:
   - `generation.userId === session.user.id`, OR
   - `generation.session.project` contains the user as owner or member.
3. Return 403 if unauthorized.

## Acceptance Criteria
- Unauthorized users cannot process generations they do not own or have access to.
- Internal calls via secret still work for background processing.

## Related File
- `app/api/generate/process/route.ts`
