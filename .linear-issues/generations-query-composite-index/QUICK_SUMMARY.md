# Quick Summary: Generations Query Composite Index

## The Problem
The generations feed uses keyset pagination ordered by `createdAt` and `id` but the database lacks a composite index that matches the filter and sort. This will slow down as data grows.

## Impact
- Slower pagination on large datasets
- Higher DB load

## Quick Fix
Add a composite index on `(sessionId, userId, createdAt, id)`.

## Key Files
- `app/api/generations/route.ts`
- `prisma/schema.prisma`
