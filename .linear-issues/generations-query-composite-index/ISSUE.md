# Generations Query Composite Index

## Problem Summary
The generations list query filters by `sessionId` and `userId`, then orders by `createdAt DESC, id DESC`. Without a matching composite index, Postgres must sort large result sets as the table grows.

## Evidence
- `app/api/generations/route.ts` uses keyset pagination with ordering by `createdAt` and `id`.
- `prisma/schema.prisma` lacks an index that matches the filter and sort order.

## Impact
- Slower API responses for large sessions
- Increased database CPU and IO

## Proposed Fix
Add a composite index:
```
@@index([sessionId, userId, createdAt, id])
```

## Acceptance Criteria
- Query plan uses the composite index for filtering and ordering.
- Pagination remains fast with large datasets.

## Related Files
- `app/api/generations/route.ts`
- `prisma/schema.prisma`
