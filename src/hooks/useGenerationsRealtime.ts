import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient, InfiniteData } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { GenerationWithOutputs } from '@/types/generation'

interface PaginatedGenerationsResponse {
  data: GenerationWithOutputs[]
  nextCursor?: string
  hasMore: boolean
}

// Track dismissed/deleted generation IDs globally per session to prevent them from reappearing
// This persists across re-renders and refetches within the same browser session
const dismissedGenerationIds = new Map<string, Set<string>>()

/**
 * Get the set of dismissed generation IDs for a session
 */
export function getDismissedIds(sessionId: string): Set<string> {
  if (!dismissedGenerationIds.has(sessionId)) {
    dismissedGenerationIds.set(sessionId, new Set())
  }
  return dismissedGenerationIds.get(sessionId)!
}

/**
 * Mark a generation as dismissed so it won't reappear from refetches or realtime
 */
export function markGenerationDismissed(sessionId: string, generationId: string) {
  const dismissed = getDismissedIds(sessionId)
  dismissed.add(generationId)
  console.log(`🔴 Marked generation ${generationId} as dismissed for session ${sessionId}`)
}

/**
 * Check if a generation has been dismissed
 */
export function isGenerationDismissed(sessionId: string, generationId: string): boolean {
  return getDismissedIds(sessionId).has(generationId)
}

/**
 * Hook to subscribe to real-time generation updates via Supabase Realtime
 * 
 * Optimizations:
 * - Only subscribes to generations table (filtered by session_id)
 * - Uses targeted cache updates instead of full invalidation (prevents flicker)
 * - For completed generations, fetches just that one generation and merges into cache
 * - 3-second debounce for full invalidation as a last-resort fallback
 * - Respects dismissed generations and never re-adds them
 */
export function useGenerationsRealtime(sessionId: string | null, userId: string | null) {
  const queryClient = useQueryClient()
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastEventRef = useRef<string | null>(null)
  const fetchingRef = useRef<Set<string>>(new Set()) // Track in-flight fetches to prevent duplicates
  const isTempSession = !!sessionId && sessionId.startsWith('temp-')

  // Debounce invalidation by 3 seconds - ONLY used as a last-resort fallback
  // Prefer targeted cache updates to prevent flickering
  const debouncedInvalidate = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    timeoutRef.current = setTimeout(() => {
      if (sessionId) {
        console.log('🔴 Fallback: Invalidating generations cache')
        queryClient.invalidateQueries({ 
          queryKey: ['generations', sessionId],
          refetchType: 'active'
        })
        queryClient.invalidateQueries({ 
          queryKey: ['generations', 'infinite', sessionId],
          refetchType: 'active'
        })
      }
      timeoutRef.current = null
    }, 3000)
  }, [sessionId, queryClient])

  // Update cache directly for status changes (efficient, no flicker).
  //
  // IMPORTANT: never regress a terminal state (completed/failed/cancelled/dismissed)
  // back to processing. Out-of-order Supabase realtime events (or a late
  // server fetch reading from a stale replica) can otherwise temporarily
  // flip a finished row back to "processing", which surfaces in the UI
  // as a generation that "stalled" right after the user switched tabs.
  const updateCacheStatus = useCallback((generationId: string, newStatus: string) => {
    if (!sessionId) return false

    const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'dismissed'])
    let updated = false

    queryClient.setQueryData<InfiniteData<PaginatedGenerationsResponse>>(
      ['generations', 'infinite', sessionId],
      (old) => {
        if (!old) return old

        return {
          ...old,
          pages: old.pages.map((page) => {
            const foundIndex = page.data.findIndex(gen => gen.id === generationId)
            if (foundIndex === -1) return page
            const current = page.data[foundIndex]
            if (current.status === newStatus) return page
            if (TERMINAL.has(current.status) && !TERMINAL.has(newStatus)) {
              console.log(
                `🔴 Ignoring regressive status update for ${generationId}: ${current.status} → ${newStatus}`
              )
              return page
            }
            updated = true
            const newData = [...page.data]
            newData[foundIndex] = {
              ...current,
              status: newStatus as any,
            }
            return { ...page, data: newData }
          }),
        }
      }
    )

    return updated
  }, [sessionId, queryClient])

  // Fetch a single generation by ID and merge it into the cache
  // This prevents full refetch flickering when a generation completes
  const fetchAndMergeGeneration = useCallback(async (generationId: string) => {
    if (!sessionId) return
    
    // Skip if this generation has been dismissed
    if (isGenerationDismissed(sessionId, generationId)) {
      console.log(`🔴 Skipping fetch for dismissed generation: ${generationId}`)
      return
    }
    
    // Prevent duplicate fetches for the same generation
    if (fetchingRef.current.has(generationId)) {
      console.log(`🔴 Already fetching generation ${generationId}, skipping`)
      return
    }
    
    fetchingRef.current.add(generationId)
    
    try {
      console.log(`🔴 Fetching single generation: ${generationId}`)
      
      // Use no-store to ensure fresh data (avoid stale cache overwriting current outputs)
      const response = await fetch(`/api/generations/${generationId}`, { cache: 'no-store' })
      if (!response.ok) {
        console.warn(`🔴 Failed to fetch generation ${generationId}: ${response.status}`)
        // Fall back to full invalidation
        debouncedInvalidate()
        return
      }
      
      const generation: GenerationWithOutputs = await response.json()

      const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'dismissed'])

      // Helper: monotonic merge for a single page row. Never lets a terminal
      // status be overwritten by a non-terminal one, never lets non-empty
      // outputs be replaced by empty ones.
      const mergeRow = (cachedGen: GenerationWithOutputs): GenerationWithOutputs => {
        const isCachedTerminal = TERMINAL.has(cachedGen.status as string)
        const isFetchedTerminal = TERMINAL.has(generation.status as string)
        const status =
          isCachedTerminal && !isFetchedTerminal ? cachedGen.status : generation.status

        const outputs =
          (!generation.outputs || generation.outputs.length === 0) &&
          cachedGen.outputs && cachedGen.outputs.length > 0
            ? cachedGen.outputs
            : generation.outputs

        return {
          ...generation,
          status,
          clientId: cachedGen.clientId || generation.clientId,
          outputs,
        }
      }

      // Merge the fetched generation into the infinite cache.
      queryClient.setQueryData<InfiniteData<PaginatedGenerationsResponse>>(
        ['generations', 'infinite', sessionId],
        (old) => {
          if (!old) return old

          return {
            ...old,
            pages: old.pages.map((page) => {
              const foundIndex = page.data.findIndex(gen => gen.id === generationId)
              if (foundIndex !== -1) {
                const cachedGen = page.data[foundIndex]
                const merged = mergeRow(cachedGen)
                console.log(
                  `🔴 Merged generation ${generationId} into cache (status: ${merged.status}, outputs: ${merged.outputs?.length || 0})`
                )
                const newData = [...page.data]
                newData[foundIndex] = merged
                return { ...page, data: newData }
              }
              return page
            }),
          }
        }
      )

      // Also update the regular generations cache
      queryClient.setQueryData<GenerationWithOutputs[]>(
        ['generations', sessionId],
        (old) => {
          if (!old) return [generation]
          const foundIndex = old.findIndex(gen => gen.id === generationId)
          if (foundIndex !== -1) {
            const newData = [...old]
            newData[foundIndex] = mergeRow(old[foundIndex])
            return newData
          }
          return old
        }
      )
    } catch (error) {
      console.error(`🔴 Error fetching generation ${generationId}:`, error)
      // Fall back to full invalidation
      debouncedInvalidate()
    } finally {
      fetchingRef.current.delete(generationId)
    }
  }, [sessionId, queryClient, debouncedInvalidate])

  // When the browser tab becomes visible again after being backgrounded,
  // force a refetch of all generations to catch up on missed realtime events.
  // Chrome throttles WebSockets and timers in background tabs, so the Supabase
  // realtime channel may have silently disconnected and polling may have stopped.
  //
  // We invalidate BOTH query shapes (infinite + plain) so any consumer of
  // either cache key reconciles. The terminal-state guard in
  // `updateCacheStatus` / `fetchAndMergeGeneration` ensures the resulting
  // refetch can never regress a finished row back to "processing".
  useEffect(() => {
    if (!sessionId || isTempSession) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('🔴 Tab became visible — refetching generations to catch up on missed updates')
        queryClient.invalidateQueries({
          queryKey: ['generations', 'infinite', sessionId],
          refetchType: 'active',
        })
        queryClient.invalidateQueries({
          queryKey: ['generations', sessionId],
          refetchType: 'active',
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [sessionId, isTempSession, queryClient])

  useEffect(() => {
    // Avoid realtime subscriptions for optimistic "temp-*" session IDs
    if (!sessionId || !userId || isTempSession) return

    const supabase = createClient()

    console.log(`🔴 Subscribing to real-time updates for session: ${sessionId}`)

    const generationsChannel = supabase
      .channel(`generations:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'generations',
          filter: `session_id=eq.${sessionId}`,
        },
        async (payload) => {
          const newData = payload.new as any
          const eventKey = `${payload.eventType}-${newData?.id}-${newData?.status}`
          
          // Deduplicate events (Supabase can send duplicates)
          if (lastEventRef.current === eventKey) {
            return
          }
          lastEventRef.current = eventKey
          
          console.log('🔴 Generation change detected:', payload.eventType, newData?.id, newData?.status)
          // CRITICAL: Skip any events for dismissed/deleted generations
          // This prevents them from reappearing after user removes them
          if (newData?.id && isGenerationDismissed(sessionId, newData.id)) {
            console.log(`🔴 Ignoring event for dismissed generation: ${newData.id}`)
            return
          }

          if (payload.eventType === 'UPDATE' && newData?.id && newData?.status) {
            // For 'completed' or 'failed' status, fetch the full generation with outputs
            // and merge into cache (prevents flicker from full refetch)
            if (newData.status === 'completed' || newData.status === 'failed') {
              // First do an immediate status update for instant feedback
              updateCacheStatus(newData.id, newData.status)
              // Then fetch the full data with outputs
              fetchAndMergeGeneration(newData.id)
            } else {
              // For other status changes (e.g., processing), just update status directly
              const updated = updateCacheStatus(newData.id, newData.status)
              if (!updated) {
                // Generation not in cache - use fallback invalidation
                debouncedInvalidate()
              }
            }
          } else if (payload.eventType === 'INSERT') {
            // New generation inserted - reconcile with optimistic entry by clientId
            // or insert directly into cache (avoid full invalidation)
            const insertClientId = newData?.parameters?.__clientId as string | undefined
            const realId = newData?.id as string
            
            const existingData = queryClient.getQueryData<InfiniteData<PaginatedGenerationsResponse>>(
              ['generations', 'infinite', sessionId]
            )
            
            // Check if we already have this generation by real ID
            const existsById = existingData?.pages.some(
              page => page.data.some(gen => gen.id === realId)
            )
            if (existsById) {
              console.log(`🔴 INSERT: Generation ${realId} already exists in cache, skipping`)
              return
            }
            
            // Try to find and reconcile optimistic entry by clientId
            if (insertClientId && existingData) {
              let reconciled = false
              
              queryClient.setQueryData<InfiniteData<PaginatedGenerationsResponse>>(
                ['generations', 'infinite', sessionId],
                (old) => {
                  if (!old) return old
                  
                  return {
                    ...old,
                    pages: old.pages.map((page) => {
                      const optimisticIndex = page.data.findIndex(
                        gen => gen.clientId === insertClientId && gen.id.startsWith('temp-')
                      )
                      if (optimisticIndex !== -1) {
                        reconciled = true
                        console.log(`🔴 INSERT: Reconciling optimistic ${page.data[optimisticIndex].id} → ${realId} (clientId: ${insertClientId})`)
                        const newPageData = [...page.data]
                        const oldGen = newPageData[optimisticIndex]
                        newPageData[optimisticIndex] = {
                          ...oldGen,
                          id: realId,
                          userId: newData.user_id || oldGen.userId,
                          status: newData.status || oldGen.status,
                          createdAt: newData.created_at ? new Date(newData.created_at) : oldGen.createdAt,
                        }
                        return { ...page, data: newPageData }
                      }
                      return page
                    }),
                  }
                }
              )
              
              if (reconciled) {
                // Also update the regular generations cache
                queryClient.setQueryData<GenerationWithOutputs[]>(
                  ['generations', sessionId],
                  (old) => {
                    if (!old) return old
                    return old.map((gen) => {
                      if (gen.clientId === insertClientId && gen.id.startsWith('temp-')) {
                        return {
                          ...gen,
                          id: realId,
                          userId: newData.user_id || gen.userId,
                          status: newData.status || gen.status,
                          createdAt: newData.created_at ? new Date(newData.created_at) : gen.createdAt,
                        }
                      }
                      return gen
                    })
                  }
                )
                return // Successfully reconciled, no need to invalidate
              }
            }
            
            // No optimistic entry found - insert directly into page 0
            // This handles generations from other tabs/devices
            console.log(`🔴 INSERT: Adding new generation ${realId} to cache`)
            const newGeneration: GenerationWithOutputs = {
              id: realId,
              clientId: insertClientId,
              sessionId: newData.session_id || sessionId,
              userId: newData.user_id || '',
              modelId: newData.model_id || '',
              prompt: newData.prompt || '',
              negativePrompt: newData.negative_prompt,
              parameters: newData.parameters || {},
              status: newData.status || 'processing',
              createdAt: newData.created_at ? new Date(newData.created_at) : new Date(),
              outputs: [],
              isOwner: newData.user_id === userId,
            }
            
            queryClient.setQueryData<InfiniteData<PaginatedGenerationsResponse>>(
              ['generations', 'infinite', sessionId],
              (old) => {
                if (!old || !old.pages.length) {
                  return {
                    pageParams: [undefined],
                    pages: [{
                      data: [newGeneration],
                      nextCursor: undefined,
                      hasMore: false,
                    }],
                  }
                }
                
                // Insert at start of page 0 (newest-first)
                return {
                  ...old,
                  pages: old.pages.map((page, idx) => {
                    if (idx === 0) {
                      return { ...page, data: [newGeneration, ...page.data] }
                    }
                    return page
                  }),
                }
              }
            )
          } else if (payload.eventType === 'DELETE') {
            // Generation deleted - mark as dismissed and remove from cache
            const deletedId = (payload.old as any)?.id
            if (deletedId) {
              markGenerationDismissed(sessionId, deletedId)
            }
            queryClient.setQueryData<InfiniteData<PaginatedGenerationsResponse>>(
              ['generations', 'infinite', sessionId],
              (old) => {
                if (!old) return old
                return {
                  ...old,
                  pages: old.pages.map((page) => ({
                    ...page,
                    data: page.data.filter(gen => gen.id !== deletedId),
                  })),
                }
              }
            )
          }
        }
      )
      .subscribe((status) => {
        console.log('🔴 Realtime subscription status:', status)
      })

    return () => {
      console.log(`🔴 Unsubscribing from real-time updates for session: ${sessionId}`)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      lastEventRef.current = null
      fetchingRef.current.clear()
      supabase.removeChannel(generationsChannel)
    }
  }, [sessionId, userId, isTempSession, debouncedInvalidate, updateCacheStatus, fetchAndMergeGeneration, queryClient])
}

