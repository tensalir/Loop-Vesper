import { useInfiniteQuery, InfiniteData } from '@tanstack/react-query'
import { logMetric } from '@/lib/metrics'
import { fetchGenerationsPage, PaginatedGenerationsResponse } from '@/lib/api/generations'
import type { GenerationWithOutputs } from '@/types/generation'

/**
 * De-duplicate generations by id and clientId.
 * - Keeps one generation per id (should never happen, but just in case)
 * - Keeps one generation per clientId (prefers real UUID over temp-* id)
 */
function dedupeGenerations(generations: GenerationWithOutputs[]): GenerationWithOutputs[] {
  const seenIds = new Set<string>()
  const seenClientIds = new Map<string, GenerationWithOutputs>()
  const result: GenerationWithOutputs[] = []

  for (const gen of generations) {
    // Skip duplicate by id
    if (seenIds.has(gen.id)) continue

    // Handle duplicate by clientId
    if (gen.clientId) {
      const existing = seenClientIds.get(gen.clientId)
      if (existing) {
        // Prefer the one with a real UUID (not temp-*)
        const existingIsTemp = existing.id.startsWith('temp-')
        const currentIsTemp = gen.id.startsWith('temp-')

        if (existingIsTemp && !currentIsTemp) {
          // Replace the temp one with the real one
          const idx = result.indexOf(existing)
          if (idx !== -1) {
            result[idx] = gen
            seenIds.delete(existing.id)
            seenIds.add(gen.id)
            seenClientIds.set(gen.clientId, gen)
          }
        }
        // Otherwise keep the existing one (it's either real, or both are temp)
        continue
      }
      seenClientIds.set(gen.clientId, gen)
    }

    seenIds.add(gen.id)
    result.push(gen)
  }

  return result
}

/**
 * Monotonic merge: never remove visible outputs or lose clientId during refetch.
 * This prevents flicker where a generation briefly shows "No outputs" before real data loads.
 * Also applies de-duplication to prevent duplicate tiles.
 */
function mergeGenerationsData(
  oldData: InfiniteData<PaginatedGenerationsResponse> | undefined,
  newData: InfiniteData<PaginatedGenerationsResponse>
): InfiniteData<PaginatedGenerationsResponse> {
  if (!oldData) return newData

  // Build a lookup of old generations by ID for fast access
  const oldGenerationsMap = new Map<string, GenerationWithOutputs>()
  for (const page of oldData.pages) {
    for (const gen of page.data) {
      oldGenerationsMap.set(gen.id, gen)
    }
  }

  // Merge each page, preserving clientId and non-empty outputs from cache
  const mergedPages = newData.pages.map((newPage, pageIndex) => {
    const mergedData = newPage.data.map((newGen) => {
      const oldGen = oldGenerationsMap.get(newGen.id)
      if (!oldGen) return newGen

      // Preserve clientId for stable React keys
      const clientId = oldGen.clientId || newGen.clientId

      // Monotonic outputs: never replace non-empty outputs with empty ones
      // This prevents flicker when backend returns generation before outputs are fully written
      const outputs =
        (!newGen.outputs || newGen.outputs.length === 0) && oldGen.outputs && oldGen.outputs.length > 0
          ? oldGen.outputs
          : newGen.outputs

      return {
        ...newGen,
        clientId,
        outputs,
      }
    })

    // For the first page (newest items), also preserve any recent processing generations
    // that might be missing from the fresh response (race condition during creation)
    if (pageIndex === 0) {
      const newGenIds = new Set(newPage.data.map((g) => g.id))
      // Also track clientIds to prevent duplicates when reconciling
      const newClientIds = new Set(newPage.data.map((g) => g.clientId).filter(Boolean))
      const now = Date.now()
      const RECENT_THRESHOLD_MS = 30 * 1000 // 30 seconds

      // Find processing generations from old page 0 that are missing from new data
      const oldPage0 = oldData.pages[0]
      if (oldPage0) {
        const missingRecentProcessing = oldPage0.data.filter((oldGen) => {
          if (newGenIds.has(oldGen.id)) return false // Already in new data by id
          // Skip if a generation with the same clientId already exists (reconciled)
          if (oldGen.clientId && newClientIds.has(oldGen.clientId)) return false
          if (oldGen.status !== 'processing') return false // Only preserve processing ones
          const createdAtMs = new Date(oldGen.createdAt).getTime()
          return now - createdAtMs < RECENT_THRESHOLD_MS
        })

        // Prepend missing recent processing generations (they should be newest)
        if (missingRecentProcessing.length > 0) {
          // Apply de-dupe to the combined result
          const combined = [...missingRecentProcessing, ...mergedData]
          return {
            ...newPage,
            data: dedupeGenerations(combined),
          }
        }
      }
    }

    return {
      ...newPage,
      data: dedupeGenerations(mergedData),
    }
  })

  return {
    ...newData,
    pages: mergedPages,
  }
}

/**
 * Fetches a page of generations from the API.
 * 
 * NOTE: The API returns data in newest-first order.
 * - Page 0 (no cursor) = newest items
 * - Page N (with cursor) = older items
 * 
 * The UI will reverse pages for display (oldest at top, newest at bottom).
 */
async function fetchGenerations({
  sessionId,
  cursor,
  limit = 10,
}: {
  sessionId: string
  cursor?: string
  limit?: number
}): Promise<PaginatedGenerationsResponse> {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()

  try {
    const normalized = await fetchGenerationsPage({
      sessionId,
      cursor,
      limit,
    })

    logMetric({
      name: 'hook_fetch_generations_infinite',
      status: 'success',
      durationMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
      meta: {
        sessionId,
        limit,
        cursor,
        resultCount: normalized.data.length,
        hasMore: normalized.hasMore,
      },
    })

    return normalized
  } catch (error: any) {
    logMetric({
      name: 'hook_fetch_generations_infinite',
      status: 'error',
      durationMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt,
      meta: { sessionId, limit, cursor, error: error?.message },
    })
    throw error
  }
}

/**
 * Infinite query for fetching generations with cursor-based pagination.
 * 
 * Data ordering:
 * - API returns newest-first (page 0 = newest, subsequent pages = older)
 * - The cursor is opaque (base64-encoded {createdAt, id})
 * - getNextPageParam provides the cursor for older items
 * 
 * Polling:
 * - Reduced to 5s when there are processing generations (was 2s)
 * - This is a fallback; realtime subscriptions should handle most updates
 */
export function useInfiniteGenerations(sessionId: string | null, limit: number = 10) {
  const isTempSession = !!sessionId && sessionId.startsWith('temp-')

  return useInfiniteQuery({
    queryKey: ['generations', 'infinite', sessionId],
    queryFn: ({ pageParam }) =>
      fetchGenerations({
        sessionId: sessionId!,
        cursor: pageParam as string | undefined,
        limit,
      }),
    // Avoid fetching for optimistic "temp-*" session IDs (not valid UUIDs; server will 500 otherwise)
    enabled: !!sessionId && !isTempSession,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PaginatedGenerationsResponse) => {
      // Return the cursor for the next page (older items), or undefined if no more
      return lastPage.hasMore ? (lastPage.nextCursor as string | undefined) : undefined
    },
    staleTime: 30 * 1000, // 30 seconds - rely on realtime + optimistic updates
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in memory for faster navigation
    refetchOnMount: false, // Don't auto-refetch - rely on optimistic updates and real-time subscriptions
    // Refetch on window focus ONLY when there are processing generations.
    // This catches updates missed while the tab was backgrounded (Chrome throttles
    // WebSockets and timers in background tabs, so realtime + polling may both fail).
    refetchOnWindowFocus: (query) => {
      const allData = query.state.data as InfiniteData<PaginatedGenerationsResponse> | undefined
      if (!allData) return false
      const hasProcessing = allData.pages.some((page) =>
        page.data.some((gen) => gen.status === 'processing')
      )
      return hasProcessing ? 'always' : false
    },
    refetchInterval: (query) => {
      // Poll less frequently as a fallback for processing generations
      // Realtime subscriptions should handle most updates
      const allData = query.state.data
      if (!allData) return false

      const pages = allData.pages as PaginatedGenerationsResponse[]
      const allGenerations = pages.flatMap((page) => page.data)
      const hasProcessingGenerations = allGenerations.some((gen) => gen.status === 'processing')

      if (hasProcessingGenerations) {
        return 5000 // Poll every 5 seconds as fallback (realtime handles most updates)
      }

      return false
    },
    // Use custom structural sharing to preserve clientId and prevent outputs from being wiped
    // This makes updates "monotonic" - visible content never disappears during refetch
    // Cast needed because TanStack Query v5 types structuralSharing as (unknown, unknown) => unknown
    structuralSharing: mergeGenerationsData as (oldData: unknown, newData: unknown) => unknown,
  })
}

