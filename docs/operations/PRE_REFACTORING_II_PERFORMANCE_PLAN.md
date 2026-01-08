# Performance Optimization Plan - Phase 1, 2, 3

## Current Performance Issues

Based on analysis, here are the bottlenecks causing slow loads:

1. **Projects page (2s load)**: N+1 query pattern - each ProjectCard fetches sessions, then generations separately
2. **Session sidebar (few seconds)**: Loads all sessions with nested creator data
3. **Initial generation load (longer)**: Fetches 20-50 generations with full outputs at once
4. **No intelligent prefetching**: Missing hover prefetch, route prefetch, and smart caching

## Industry Best Practices (Instagram, X, Krea)

These platforms use:
- **Aggressive prefetching**: Preload data on hover, anticipate user navigation
- **Infinite scroll with virtualization**: Load only visible content
- **Optimized thumbnail delivery**: Separate thumbnail/full-size endpoints
- **CDN + edge caching**: Next.js on Vercel already provides this
- **React Query with stale-while-revalidate**: Show cached data instantly, update in background
- **Database query optimization**: Single queries with proper joins, no N+1 patterns

**Note on Supabase vs AWS**: Supabase Storage is built on S3 and uses CloudFront CDN. Performance-wise, it's equivalent to AWS. The bottleneck is NOT storage - it's how we're querying and loading data. Keep Supabase.

---

## Implementation Plan

### Phase 1: Database Query Optimization (Biggest Impact)

**Fix N+1 queries and optimize data loading**

#### 1.1 Optimize Projects Page
- Create `/api/projects/with-thumbnails` endpoint
- Single query with joins to get latest generation thumbnail for each project
- Use SQL aggregation instead of client-side loops
- Expected improvement: 2s → 300ms

#### 1.2 Optimize Session Loading
- Already fairly optimal (single query with creator join)
- Add light prefetching on hover for session generations
- Cache session list in React Query with 5-minute stale time

#### 1.3 Fix ProjectCard Thumbnail Loading
- Currently does: fetch sessions → fetch generations (N+1 pattern)
- New: Get thumbnail from optimized projects endpoint
- Fallback: Use project preview image or placeholder

---

### Phase 2: Infinite Scroll for Generations (Major UX Win)

**Implement virtual scrolling with progressive loading**

#### 2.1 Add Cursor-Based Pagination to API
- Update `/api/generations` to support cursor (use generation ID)
- Return `{ data, nextCursor, hasMore }` format
- Limit to 10 generations per page initially

#### 2.2 Implement useInfiniteQuery
- Replace `useQuery` with `useInfiniteQuery` in `hooks/useGenerations.ts`
- Add "Load More" button or intersection observer for auto-load
- Maintain existing real-time updates for new generations

#### 2.3 Optimize Image Loading
- Use Next.js Image component everywhere (already started)
- Add `priority` for first 3 images, lazy load rest
- Implement blur placeholder using `placeholder="blur"`

---

### Phase 3: Intelligent Prefetching & Caching

**Preload data before users need it**

#### 3.1 Prefetch on Hover
- Sessions: Already implemented in SessionSidebar
- Projects: Add hover prefetch to ProjectCard (sessions + first 10 generations)
- Use React Query's `prefetchQuery` with 30s stale time

#### 3.2 Route-Level Prefetching
- Add `<Link prefetch>` for project navigation
- Preload critical data in Link hover

#### 3.3 Optimize React Query Cache Settings
- Projects: `staleTime: 5 * 60 * 1000` (5 min) - rarely changes
- Sessions: `staleTime: 3 * 60 * 1000` (3 min)
- Generations: Keep current aggressive refetch for active sessions
- Use `gcTime: 30 * 60 * 1000` (30 min) to keep in memory

---

## Implementation Order (Safest Refactor Path)

### Week 1: Low-Risk, High-Impact Fixes
1. **Optimize projects endpoint** (new endpoint, no breaking changes)
2. **Add React Query cache optimization** (just config changes)
3. **Add prefetch on hover** (progressive enhancement)
4. **Test thoroughly** - no existing functionality breaks

### Week 2: Infinite Scroll (Moderate Risk)
1. **Add pagination to generations API** (backward compatible)
2. **Create new useInfiniteGenerations hook** (keep old one)
3. **Update GenerationInterface to use new hook**
4. **Test with 200+ generations** 
5. **Monitor for issues**, rollback if needed

### Week 3: Thumbnail Strategy (Lower Priority)
1. **Add thumbnail generation** (new feature)
2. **Migrate existing images** (background task)
3. **Update components to use thumbnails**

---

## Expected Performance Improvements

| Metric | Current | After Phase 1 | After Phase 2 | Target |
|--------|---------|---------------|---------------|--------|
| Projects page load | 2s | 300ms | 300ms | 200-500ms |
| Session switch | 1-2s | 500ms | 200ms | 200-400ms |
| Initial 50 generations | 5-10s | 2-3s | 1s (loads 10) | <1s |
| Scroll to 200+ generations | N/A | N/A | Progressive | Smooth |
| Perceived performance | Slow | Fast | Very Fast | Instagram-level |

---

## Key Principles

1. **Backward compatibility first** - Never break existing functionality
2. **Measure before optimizing** - Add timing logs to verify improvements
3. **Progressive enhancement** - New features degrade gracefully
4. **Keep it simple** - Don't over-engineer, follow Next.js/React Query patterns
5. **Test with realistic data** - Use 50-200 generations per session

