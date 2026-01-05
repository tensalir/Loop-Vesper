---
name: Generation perf fixes (v2)
overview: "Implement the four `generation-*` issues with refined approaches: virtualized gallery, CSS-animated progress, parallel output uploads, and allowlist-based parameter sanitization with backfill."
todos:
  - id: deps
    content: "Add dependencies: `@tanstack/react-virtual`, `p-limit`; add env var `GENERATION_UPLOAD_CONCURRENCY`"
    status: completed
  - id: persist-multi-ref
    content: Add `persistReferenceImages()` helper in `lib/reference-images.ts` with parallel upload support
    status: completed
    dependencies:
      - deps
  - id: fix-generate-route
    content: Update `app/api/generate/route.ts` to use `persistReferenceImages()` for multi-image uploads instead of storing base64
    status: completed
    dependencies:
      - persist-multi-ref
  - id: sanitize-api
    content: Add allowlist-based `sanitizeParameters()` to `/api/generations` with `includeParameters` query param
    status: completed
    dependencies:
      - fix-generate-route
  - id: backfill-endpoint
    content: Create `app/api/admin/backfill-reference-images/route.ts` with batch processing and idempotency checks
    status: completed
    dependencies:
      - persist-multi-ref
  - id: virtualize-gallery
    content: Virtualize `GenerationGallery` using TanStack Virtual; update scroll logic in `GenerationInterface`
    status: completed
    dependencies:
      - deps
  - id: css-progress
    content: Replace JS interval in `GenerationProgress` with CSS keyframe animation for smooth 60fps progress
    status: completed
  - id: parallel-uploads
    content: Refactor `app/api/generate/process` to use `Promise.allSettled` + `p-limit` for parallel output uploads
    status: completed
    dependencies:
      - deps
---

# Implement `generation-*` issues (performance + payload) - Revised

## Scope

- **4 issues:** `generation-gallery-virtualization`, `generation-output-uploads-parallel`, `generation-parameters-bloat`, `generation-progress-interval-cost`
- **Backfill:** One-time migration for existing base64 reference images
- **Not included:** `generations-query-composite-index` (separate issue)

## Affected Files

- **UI:** [`GenerationInterface.tsx`](components/generation/GenerationInterface.tsx), [`GenerationGallery.tsx`](components/generation/GenerationGallery.tsx), [`GenerationProgress.tsx`](components/generation/GenerationProgress.tsx)
- **API:** [`app/api/generate/route.ts`](app/api/generate/route.ts), [`app/api/generate/process/route.ts`](app/api/generate/process/route.ts), [`app/api/generations/route.ts`](app/api/generations/route.ts)
- **Shared:** [`lib/reference-images.ts`](lib/reference-images.ts)
- **New:** `app/api/admin/backfill-reference-images/route.ts`

---

## 1. Gallery Virtualization

### Implementation

- Add `@tanstack/react-virtual` dependency
- In `GenerationInterface.tsx`: pass `scrollContainerRef` to `GenerationGallery`
- In `GenerationGallery.tsx`:
- Wrap the list with `useVirtualizer` from TanStack Virtual
- Use `estimateSize: () => 400` (average row height)
- Use `measureElement` on each row for dynamic height measurement
- Set `overscan: 5` for smooth scrolling
- Preserve stable keys via `clientId || id`

### Scroll Behavior Preservation (Critical)

The existing scroll logic must continue working:| Behavior | How to Preserve |

|----------|-----------------|

| Pinned-to-bottom detection | Use `virtualizer.scrollOffset` + `virtualizer.getTotalSize()` instead of raw DOM measurements |

| Auto-scroll on new items | After virtualizer renders, call `virtualizer.scrollToIndex(generations.length - 1)` |

| Load older (scroll to top) | Keep IntersectionObserver on sentinel div at top of virtualized list |

| Scroll position on prepend | Store `virtualizer.scrollOffset` before fetch, restore after data update |

### Validation

- With 500+ generations: DOM should only contain ~15-20 row elements
- "New items" indicator should appear when scrolled up + new item arrives
- Clicking image should still open lightbox correctly

---

## 2. Progress Animation (CSS-based)

### Current Problem

`GenerationProgress` runs a 100ms `setInterval` updating React state, causing CPU spikes with multiple concurrent generations.

### New Approach: Pure CSS Animation

Replace JS interval with CSS keyframe animation:

```css
@keyframes progress-fill {
  from { stroke-dashoffset: calc(2 * 3.14159 * 42); }
  to { stroke-dashoffset: calc(2 * 3.14159 * 42 * 0.05); } /* 95% */
}
```



### Implementation

- Remove `setInterval` and `progress` state
- Add CSS animation to the progress circle SVG:
- `animation: progress-fill ${estimatedTime}s ease-out forwards`
- Keep stage text updates via a slower interval (every 2-3 seconds) or derive from CSS animation time
- Alternatively: use CSS `animation-delay` for staged text reveals

### Benefits

- Zero JS CPU overhead during animation
- Buttery smooth 60fps progress
- Stage text can update on a relaxed schedule (or use CSS-only approach)

---

## 3. Parallel Output Uploads

### Implementation

- Add `p-limit` dependency
- Add env var: `GENERATION_UPLOAD_CONCURRENCY` (default: 3)
- In `app/api/generate/process/route.ts`:
```typescript
import pLimit from 'p-limit'

const limit = pLimit(Number(process.env.GENERATION_UPLOAD_CONCURRENCY || 3))

// Replace sequential for-loop with:
const uploadResults = await Promise.allSettled(
  result.outputs.map((output, i) => 
    limit(async () => {
      // existing upload logic for output[i]
      return { index: i, finalUrl, output }
    })
  )
)

// Process results, using fallback URL for any failures
const outputRecords = uploadResults.map((result, i) => {
  if (result.status === 'fulfilled') {
    return result.value
  } else {
    console.error(`Upload ${i} failed:`, result.reason)
    return { index: i, finalUrl: result.outputs[i].url, output: result.outputs[i] }
  }
})
```




### Error Handling

- Use `Promise.allSettled` (not `Promise.all`) to allow partial success
- Failed uploads fallback to original URL (current behavior preserved)
- Log failures but don't fail the whole generation

### Heartbeat

- Start heartbeat once before all uploads: `startHeartbeat('storage:upload-batch:heartbeat')`
- Stop after `Promise.allSettled` resolves

---

## 4. Parameter Sanitization (Allowlist Approach)

### Allowlist of Fields to Keep

UI reads these from `generation.parameters`:

```typescript
const ALLOWED_PARAMETER_FIELDS = [
  // Generation settings (required by UI)
  'aspectRatio',
  'numOutputs', 
  'resolution',
  'duration',
  
  // Error display
  'error',
  
  // Reference image pointers (for thumbnails + reuse)
  'referenceImageUrl',
  'referenceImageId',
  'referenceImagePath',
  'referenceImageBucket',
  'referenceImageMimeType',
  'referenceImageChecksum',
  
  // Multi-image support (URLs only, base64 stripped)
  'referenceImages', // Will be filtered to URLs only
]
```



### Implementation in `/api/generations`

```typescript
function sanitizeParameters(params: any): any {
  if (!params || typeof params !== 'object') return {}
  
  const sanitized: any = {}
  
  for (const key of ALLOWED_PARAMETER_FIELDS) {
    if (key in params) {
      if (key === 'referenceImages' && Array.isArray(params[key])) {
        // Strip base64, keep only HTTP URLs
        sanitized[key] = params[key].filter(
          (img: unknown) => typeof img === 'string' && img.startsWith('http')
        )
      } else {
        sanitized[key] = params[key]
      }
    }
  }
  
  return sanitized
}
```



### Query Parameter

- Default: `includeParameters=false` (sanitized)
- Debug mode: `includeParameters=true` (full parameters, for admin use)

---

## 5. Persist Multi-Reference Images (Fix Source of Bloat)

### Current Problem

`app/api/generate/route.ts` stores `referenceImages: string[]` as raw base64 data URLs.

### Fix in `app/api/generate/route.ts`

```typescript
// When referenceImages array is provided:
if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
  const persistedUrls = await persistReferenceImages(referenceImages, user.id, generationId)
  referencePointer = { referenceImages: persistedUrls }
}
```



### New Helper in `lib/reference-images.ts`

```typescript
export async function persistReferenceImages(
  base64DataUrls: string[],
  userId: string,
  generationId: string
): Promise<string[]> {
  const limit = pLimit(3) // Parallel uploads with limit
  
  const results = await Promise.all(
    base64DataUrls.map((dataUrl, index) => 
      limit(async () => {
        const pointer = await persistReferenceImage(
          dataUrl, 
          userId, 
          `ref-${generationId}-${index}`
        )
        return pointer.referenceImageUrl
      })
    )
  )
  
  return results
}
```

---

## 6. Backfill Existing Base64 Rows

### Endpoint: `app/api/admin/backfill-reference-images/route.ts`

### Auth

- Require `x-internal-secret` header matching `process.env.INTERNAL_API_SECRET`

### Logic

```typescript
// 1. Find candidates (batch of 20)
const candidates = await prisma.generation.findMany({
  where: {
    // Has parameters that might contain base64
    parameters: { not: Prisma.DbNull }
  },
  take: limit,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  orderBy: { createdAt: 'asc' }
})

// 2. Filter to those with base64 data
const needsBackfill = candidates.filter(gen => {
  const params = gen.parameters as any
  // Check for base64 in referenceImage or referenceImages
  if (params?.referenceImage?.startsWith('data:')) return true
  if (params?.referenceImages?.some((img: string) => img?.startsWith('data:'))) return true
  return false
})

// 3. For each, upload to storage and update parameters
for (const gen of needsBackfill) {
  // ... upload logic
  // ... update parameters to remove base64, add URLs
}
```



### Idempotency

- Skip if `referenceImageUrl` already exists AND no base64 present
- Use `upsert: true` on storage uploads (already done)

### Response

```json
{
  "processed": 20,
  "updated": 5,
  "skipped": 15,
  "errors": [],
  "nextCursor": "uuid-of-last-processed"
}
```

---

## Environment Variables

| Variable | Default | Description |

|----------|---------|-------------|

| `GENERATION_UPLOAD_CONCURRENCY` | `3` | Max parallel uploads in process endpoint |

| `INTERNAL_API_SECRET` | (required) | Auth for backfill endpoint |---

## Validation Checklist

- [ ] **Virtualization:** DOM node count stays bounded with 500+ generations
- [ ] **Virtualization:** Scroll-to-bottom behavior works
- [ ] **Virtualization:** Load-older-on-scroll-up works
- [ ] **Virtualization:** New items indicator appears when scrolled up
- [ ] **Virtualization:** Lightbox opens correctly from virtualized row
- [ ] **Progress:** No JS CPU usage during progress animation
- [ ] **Progress:** Animation feels smooth (60fps)
- [ ] **Uploads:** Multi-output generations complete faster
- [ ] **Uploads:** Partial failures don't break the whole generation
- [ ] **Sanitization:** `/api/generations` responses are small
- [ ] **Sanitization:** UI still displays reference image thumbnails
- [ ] **Sanitization:** "Reuse parameters" still works
- [ ] **Backfill:** Can run repeatedly without re-uploading
- [ ] **Backfill:** Old generations still display reference images after backfill

---

## Rollout Order

1. **API changes first:** Persist multi-ref images + sanitize `/api/generations`
2. **Run backfill:** Execute in batches until complete
3. **UI performance:** Deploy virtualization + CSS progress