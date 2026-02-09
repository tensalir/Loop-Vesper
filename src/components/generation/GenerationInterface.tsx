'use client'

import { useEffect, useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient, InfiniteData } from '@tanstack/react-query'
import { ChatInput } from './ChatInput'
import type { Session } from '@/types/project'
import type { GenerationWithOutputs } from '@/types/generation'
import type { ModelConfig } from '@/lib/models/base'
import { useInfiniteGenerations } from '@/hooks/useInfiniteGenerations'
import { useGenerationsRealtime, markGenerationDismissed, isGenerationDismissed } from '@/hooks/useGenerationsRealtime'
import { useGenerateMutation } from '@/hooks/useGenerateMutation'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
import { useModels } from '@/hooks/useModels'
import { useUIStore } from '@/store/uiStore'
import { useToast } from '@/components/ui/use-toast'
import { createClient } from '@/lib/supabase/client'
import { Image as ImageIcon, Video, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logMetric } from '@/lib/metrics'

// Default to Kling Official API for best quality and frame interpolation support.
// Requires KLING_ACCESS_KEY and KLING_SECRET_KEY credentials.
const DEFAULT_VIDEO_MODEL_ID = 'kling-official'

/**
 * Get preferred model ID from a list of models.
 * Uses cached data from React Query instead of direct registry import.
 */
function getPreferredModelIdFromList(models: ModelConfig[], type: 'image' | 'video'): string | null {
  const modelsOfType = models.filter(m => m.type === type)
  if (type === 'video') {
    const preferred = modelsOfType.find((m) => m.id === DEFAULT_VIDEO_MODEL_ID)
    return preferred?.id ?? modelsOfType[0]?.id ?? null
  }
  return modelsOfType[0]?.id ?? null
}

interface PaginatedGenerationsResponse {
  data: GenerationWithOutputs[]
  nextCursor?: string
  hasMore: boolean
}

const GenerationGallery = dynamic(
  () => import('./GenerationGallery').then((mod) => mod.GenerationGallery),
  {
    loading: () => (
      <div className="py-12 text-center text-muted-foreground">Loading gallery…</div>
    ),
  }
)

const VideoInput = dynamic(
  () => import('./VideoInput').then((mod) => mod.VideoInput),
  {
    ssr: false,
    loading: () => (
      <div className="p-6 text-center text-muted-foreground">Loading video controls…</div>
    ),
  }
)

interface GenerationInterfaceProps {
  session: Session | null
  generationType: 'image' | 'video'
  allSessions?: Session[]
  onSessionCreate?: (type: 'image' | 'video', name: string, options?: { skipSwitch?: boolean }) => Promise<Session | null>
  onSessionSwitch?: (sessionId: string) => void
  onGenerationTypeChange?: (type: 'image' | 'video') => void
  onToggleChat?: () => void
  isChatOpen?: boolean
  /** External prompt to set (from Brainstorm chat) */
  externalPrompt?: string
  /** Callback when external prompt is consumed */
  onExternalPromptConsumed?: () => void
  /** External reference image URL to set (from pinned images rail) */
  externalReferenceImageUrl?: string | null
  /** Callback when external reference image is consumed */
  onExternalReferenceImageConsumed?: () => void
  /** Deep-link: outputId to scroll to and highlight */
  deepLinkOutputId?: string | null
  /** Callback when deep-link output has been scrolled to */
  onDeepLinkOutputConsumed?: () => void
}

export function GenerationInterface({
  session,
  generationType,
  allSessions = [],
  onSessionCreate,
  onSessionSwitch,
  onGenerationTypeChange,
  onToggleChat,
  isChatOpen = false,
  externalPrompt,
  onExternalPromptConsumed,
  externalReferenceImageUrl,
  onExternalReferenceImageConsumed,
  deepLinkOutputId,
  onDeepLinkOutputConsumed,
}: GenerationInterfaceProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const loadOlderRef = useRef<HTMLDivElement | null>(null) // Sentinel at TOP for loading older items
  const [prompt, setPrompt] = useState('')
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null)
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]) // For image generation with multiple images
  const [userId, setUserId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<{ displayName: string | null } | null>(null)
  const previousSessionIdRef = useRef<string | null>(null)
  const pendingScrollToBottomRef = useRef(false) // Flag to scroll after data loads
  const isPinnedToBottomRef = useRef(true)
  const sessionAutoScrollAttemptCountRef = useRef(0)
  
  // Scroll pinning state
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)
  const [showNewItemsIndicator, setShowNewItemsIndicator] = useState(false)
  const previousGenerationsCountRef = useRef(0)
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)
  const generationsReadyLoggedRef = useRef(false)
  const sessionLoadStartRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now())
  
  // Deep-link scroll/highlight state
  const [scrollToOutputId, setScrollToOutputId] = useState<string | null>(null)
  const [highlightOutputId, setHighlightOutputId] = useState<string | null>(null)
  const deepLinkSeekingRef = useRef(false)
  const deepLinkPagesLoadedRef = useRef(0)
  const MAX_DEEPLINK_PAGES = 10 // Max pages to load when seeking deep-link output
  
  // State for pasted images (passed to input components)
  const [pastedImageFiles, setPastedImageFiles] = useState<File[]>([])
  const pastedImageCallbackRef = useRef<((files: File[]) => void) | null>(null)
  
  // Handle external prompt from Brainstorm chat
  useEffect(() => {
    if (externalPrompt && externalPrompt.trim()) {
      setPrompt(externalPrompt)
      onExternalPromptConsumed?.()
    }
  }, [externalPrompt, onExternalPromptConsumed])
  
  // Handle external reference image from pinned images rail
  useEffect(() => {
    if (externalReferenceImageUrl) {
      if (generationType === 'video') {
        // Video mode: single reference image (replace)
        setReferenceImageUrl(externalReferenceImageUrl)
      } else {
        // Image mode: add only the clicked pinned image (allow multiple reference images)
        setReferenceImageUrls((prev) => {
          if (prev.includes(externalReferenceImageUrl)) return prev
          return [...prev, externalReferenceImageUrl]
        })
      }
      onExternalReferenceImageConsumed?.()
    }
  }, [externalReferenceImageUrl, generationType, onExternalReferenceImageConsumed])
  
  /**
   * Dismiss/remove a stuck generation from the UI cache and database.
   * Used when a generation is stuck in 'processing' state.
   * Persists the dismissal to the database so it won't reappear after page refresh.
   */
  const handleDismissGeneration = useCallback(async (generationId: string, clientId?: string) => {
    console.log('Dismissing stuck generation:', generationId, clientId)
    
    // Mark as dismissed FIRST so realtime events don't bring it back
    if (session?.id) {
      markGenerationDismissed(session.id, generationId)
    }
    
    // Remove from regular generations cache
    queryClient.setQueryData<GenerationWithOutputs[]>(
      ['generations', session?.id],
      (old) => {
        if (!old) return []
        return old.filter(gen => 
          gen.id !== generationId && 
          (!clientId || gen.clientId !== clientId)
        )
      }
    )
    
    // Remove from infinite generations cache
    queryClient.setQueryData(
      ['generations', 'infinite', session?.id],
      (old: InfiniteData<PaginatedGenerationsResponse> | undefined) => {
        if (!old) return undefined
        
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            data: page.data.filter(gen => 
              gen.id !== generationId && 
              (!clientId || gen.clientId !== clientId)
            ),
          })),
        }
      }
    )
    
    // Persist dismissal to database (so it won't reappear after page refresh)
    try {
      const response = await fetch(`/api/generations/${generationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'dismissed' }),
      })
      
      if (!response.ok) {
        console.warn('Failed to persist dismissal to database:', await response.text())
        // Still show success toast - the UI is updated, just not persisted
      }
    } catch (error) {
      console.warn('Error persisting dismissal:', error)
      // Still show success toast - the UI is updated
    }
    
    toast({
      title: 'Generation dismissed',
      description: 'The stuck generation has been removed.',
    })
  }, [queryClient, session?.id, toast])
  
  // Get current user for realtime subscriptions
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id || null)
      
      // Also fetch profile for display name
      if (data.user?.id) {
        supabase
          .from('profiles')
          .select('displayName')
          .eq('id', data.user.id)
          .single()
          .then(({ data: profile }) => {
            setCurrentUser(profile ? { displayName: profile.displayName } : null)
          })
      }
    })
  }, [])
  
  // Use Zustand store for UI state
  const { selectedModel, parameters, setSelectedModel, setParameters } = useUIStore()
  
  // Use cached models data from React Query (prefetched on server)
  const { data: allModels = [] } = useModels()
  
  // Use infinite query for progressive loading
  // Start with a smaller page (5) for faster first paint, then backfill older items
  const {
    data: infiniteData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteGenerations(session?.id || null, 5)
  
  // Flatten all pages into a single array, filtering out dismissed generations
  // This ensures dismissed generations never reappear after refetch
  const generations = useMemo(() => {
    const pages = infiniteData?.pages as { data: GenerationWithOutputs[] }[] | undefined
    const allGenerations = pages?.flatMap((page) => page.data) || []
    if (!session?.id) return allGenerations
    return allGenerations.filter((gen) => !isGenerationDismissed(session.id, gen.id))
  }, [infiniteData, session?.id])

  // Track if we've done the initial backfill for this session
  const hasBackfilledRef = useRef<string | null>(null)

  /**
   * Helper to fetch older pages while preserving scroll position.
   * Records the current scrollHeight before calling fetchNextPage() so that
   * when older items are prepended, we can adjust scrollTop to keep the same
   * content in view (scroll preservation effect handles the adjustment).
   */
  const fetchOlderPagePreservingScroll = useCallback(() => {
    const container = scrollContainerRef.current
    // Only set scrollHeight if not already tracking a load (prevents race conditions)
    if (container && scrollHeightBeforeLoadRef.current === null && !isFetchingNextPage) {
      scrollHeightBeforeLoadRef.current = container.scrollHeight
    }
    return fetchNextPage()
  }, [fetchNextPage, isFetchingNextPage])

  // Background backfill: after first page renders, fetch more pages on idle
  // This pre-loads older generations so scrolling up is instant
  // Uses fetchOlderPagePreservingScroll to prevent scroll position jumps
  useEffect(() => {
    // Only backfill once per session, after initial data loads
    if (!session?.id || isLoading || !infiniteData) return
    if (hasBackfilledRef.current === session.id) return
    if (!hasNextPage || isFetchingNextPage) return

    // Mark as backfilling for this session
    hasBackfilledRef.current = session.id

    // Use requestIdleCallback if available, otherwise setTimeout
    const scheduleBackfill = (callback: () => void) => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(callback, { timeout: 2000 })
      } else {
        setTimeout(callback, 100)
      }
    }

    // Backfill up to 3 more pages (15 more items at 5 per page)
    let pagesBackfilled = 0
    const maxBackfillPages = 3

    const backfillNextPage = () => {
      if (pagesBackfilled >= maxBackfillPages) return
      
      // Check if there's still more to fetch (re-check since state may have changed)
      const currentData = queryClient.getQueryData(['generations', 'infinite', session.id]) as InfiniteData<PaginatedGenerationsResponse> | undefined
      const lastPage = currentData?.pages[currentData.pages.length - 1]
      if (!lastPage?.hasMore) return

      pagesBackfilled++
      // Use scroll-preserving helper to prevent viewport jumps when older items are prepended
      fetchOlderPagePreservingScroll().then(() => {
        // Schedule next backfill if there's more
        scheduleBackfill(backfillNextPage)
      })
    }

    // Start backfill after a short delay to not compete with initial render
    scheduleBackfill(backfillNextPage)
  }, [session?.id, isLoading, infiniteData, hasNextPage, isFetchingNextPage, fetchOlderPagePreservingScroll, queryClient])

  // Reset backfill tracking when session changes
  useEffect(() => {
    if (previousSessionIdRef.current !== session?.id) {
      hasBackfilledRef.current = null
    }
  }, [session?.id])

  // Deep-link output seeking: load older pages until the target output is found
  // Uses fetchOlderPagePreservingScroll to prevent scroll position jumps while paging
  useEffect(() => {
    if (!deepLinkOutputId || !session?.id || isLoading) return
    if (!deepLinkSeekingRef.current) return
    
    // Check if the output is already in the loaded generations
    const outputFound = generations.some((gen) =>
      gen.outputs?.some((output) => output.id === deepLinkOutputId)
    )
    
    if (outputFound) {
      // Found! Set scroll/highlight targets and consume the deep-link
      setScrollToOutputId(deepLinkOutputId)
      setHighlightOutputId(deepLinkOutputId)
      deepLinkSeekingRef.current = false
      onDeepLinkOutputConsumed?.()
      
      // Clear highlight after a few seconds
      setTimeout(() => {
        setHighlightOutputId(null)
      }, 3000)
      return
    }
    
    // Not found yet - load more pages if available
    // Use scroll-preserving helper to prevent viewport jumps
    if (hasNextPage && !isFetchingNextPage && deepLinkPagesLoadedRef.current < MAX_DEEPLINK_PAGES) {
      deepLinkPagesLoadedRef.current += 1
      fetchOlderPagePreservingScroll()
    } else if (!hasNextPage || deepLinkPagesLoadedRef.current >= MAX_DEEPLINK_PAGES) {
      // Give up - output not found after loading all available pages or max pages
      console.warn(`Deep-link output ${deepLinkOutputId} not found in session ${session.id}`)
      deepLinkSeekingRef.current = false
      onDeepLinkOutputConsumed?.()
    }
  }, [deepLinkOutputId, session?.id, isLoading, generations, hasNextPage, isFetchingNextPage, fetchOlderPagePreservingScroll, onDeepLinkOutputConsumed])

  // Log timing metric when generations first load for this session
  useEffect(() => {
    if (isLoading || !session?.id) return
    
    // Reset on session change
    if (previousSessionIdRef.current !== session.id) {
      generationsReadyLoggedRef.current = false
      sessionLoadStartRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now()
    }
    
    if (!generationsReadyLoggedRef.current) {
      generationsReadyLoggedRef.current = true
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
      logMetric({
        name: 'client_generations_ready',
        status: 'success',
        durationMs: Math.round(now - sessionLoadStartRef.current),
        meta: {
          sessionId: session.id,
          generationCount: generations.length,
        },
      })
    }
  }, [isLoading, session?.id, generations.length])

  // If Kling Official is selected but not configured correctly, generations will fail with
  // "Authorization signature is invalid". Auto-fallback to Replicate Kling so users can keep working.
  useEffect(() => {
    if (generationType !== 'video') return
    if (selectedModel !== 'kling-official') return

    const hasAuthSignatureError = generations.some((gen) => {
      const err = (gen.parameters as any)?.error
      return (
        gen.modelId === 'kling-official' &&
        gen.status === 'failed' &&
        typeof err === 'string' &&
        err.toLowerCase().includes('authorization signature is invalid')
      )
    })

    if (!hasAuthSignatureError) return

    setSelectedModel('replicate-kling-2.6')
    toast({
      title: 'Switched video model',
      description:
        'Kling Official failed authentication (authorization signature invalid). Using Kling 2.6 (Replicate) instead.',
    })
  }, [generationType, selectedModel, generations, setSelectedModel, toast])
  
  // Subscribe to real-time updates
  useGenerationsRealtime(session?.id || null, userId)
  
  // Use React Query mutation for generating
  const generateMutation = useGenerateMutation()
  
  // Get model capabilities to check if pasting images is supported
  const { modelConfig } = useModelCapabilities(selectedModel)
  
  // Check if current model supports reference images
  const supportsReferenceImages = useMemo(() => {
    if (!modelConfig) return false
    // Image models: check 'editing' capability
    if (generationType === 'image') {
      return modelConfig.capabilities?.editing === true
    }
    // Video models: check 'image-2-video' capability
    return modelConfig.capabilities?.['image-2-video'] === true
  }, [modelConfig, generationType])
  
  // Check if current model supports multiple reference images (for wider prompt bar)
  const supportsMultiImage = useMemo(() => {
    if (!modelConfig || generationType !== 'image') return false
    return modelConfig.capabilities?.multiImageEditing === true
  }, [modelConfig, generationType])
  
  // Global paste handler for Cmd/Ctrl+V with images
  useEffect(() => {
    if (!session) return
    
    const handlePaste = (e: ClipboardEvent) => {
      // Don't intercept paste if user is typing in a text field (unless it's explicitly our prompt textarea)
      const activeElement = document.activeElement as HTMLElement | null
      const isInTextInput = activeElement?.tagName === 'INPUT' || 
                           (activeElement?.tagName === 'TEXTAREA' && !activeElement?.closest('[data-generation-input]'))
      
      // Check if clipboard has image data
      const items = e.clipboardData?.items
      if (!items) return
      
      const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'))
      if (imageItems.length === 0) return
      
      // Only handle if model supports reference images
      if (!supportsReferenceImages) {
        toast({
          title: 'Model doesn\'t support reference images',
          description: `${modelConfig?.name || 'This model'} doesn't support image input. Try Nano Banana, Seedream, Veo, or Kling.`,
          variant: 'default',
        })
        return
      }
      
      // Don't prevent default for text inputs - let them handle paste normally
      // But we still want to add the image as a reference
      
      // Convert clipboard items to Files
      const files: File[] = []
      for (const item of imageItems) {
        const blob = item.getAsFile()
        if (blob) {
          files.push(blob)
        }
      }
      
      if (files.length > 0) {
        // Invoke callback if registered (from input components)
        if (pastedImageCallbackRef.current) {
          pastedImageCallbackRef.current(files)
        } else {
          // Fallback: set state for components to pick up
          setPastedImageFiles(files)
        }
        
        toast({
          title: 'Image added',
          description: files.length === 1 
            ? 'Reference image added from clipboard' 
            : `${files.length} reference images added from clipboard`,
        })
      }
    }
    
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [session, supportsReferenceImages, modelConfig, toast])
  
  // Callback for input components to register their paste handlers
  const registerPasteHandler = useCallback((handler: (files: File[]) => void) => {
    pastedImageCallbackRef.current = handler
    return () => {
      pastedImageCallbackRef.current = null
    }
  }, [])

  // Set numOutputs based on generationType and model config
  useEffect(() => {
    // Wait for models to load before enforcing model type
    if (allModels.length === 0) return
    
    const current = allModels.find(m => m.id === selectedModel)
    const requiredType = generationType
    
    // Enforce model type per view: image sessions -> image models, video sessions -> video models
    if (!current || current.type !== requiredType) {
      const fallbackId = getPreferredModelIdFromList(allModels, requiredType)
      if (fallbackId) {
        setSelectedModel(fallbackId)
        if (requiredType === 'video') {
          // Match Animate Still defaults when entering video view.
          setParameters({
            aspectRatio: '16:9',
            resolution: 720,
            numOutputs: 1,
            duration: 5,
          })
        }
      }
      return
    }
    
    // Get numOutputs options from model config
    const numOutputsParam = current.parameters?.find(p => p.name === 'numOutputs')
    const allowedNumOutputs = numOutputsParam?.options?.map((opt: any) => opt.value) || []
    
    // If model only allows 1 image (like Nano Banana Pro), enforce it
    if (allowedNumOutputs.length === 1 && allowedNumOutputs[0] === 1) {
      if (parameters.numOutputs !== 1) {
        setParameters({ numOutputs: 1 })
      }
    } else {
      // Otherwise use default based on generation type
      const defaultNumOutputs = generationType === 'image' ? 4 : 1
      if (parameters.numOutputs !== defaultNumOutputs) {
        setParameters({ numOutputs: defaultNumOutputs })
      }
    }
  }, [generationType, selectedModel, allModels])

  // Track scroll position to determine if user is pinned to bottom
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      // Consider "pinned" if within 50px of bottom (reduced from 100px to avoid pulling user down)
      const pinned = distanceFromBottom < 50
      isPinnedToBottomRef.current = pinned
      setIsPinnedToBottom(pinned)
      
      // Hide new items indicator when user scrolls to bottom
      if (pinned && showNewItemsIndicator) {
        setShowNewItemsIndicator(false)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [showNewItemsIndicator])

  // Detect session change and mark pending scroll
  useEffect(() => {
    const isNewSession = session?.id !== previousSessionIdRef.current
    if (isNewSession && session?.id) {
      // Reset deep-link seeking state for new session
      deepLinkSeekingRef.current = false
      deepLinkPagesLoadedRef.current = 0
      setScrollToOutputId(null)
      setHighlightOutputId(null)
      
      // If we have a deep-link outputId, DON'T scroll to bottom - we'll scroll to the output instead
      if (deepLinkOutputId) {
        // Set up for deep-link seeking
        deepLinkSeekingRef.current = true
        pendingScrollToBottomRef.current = false
      } else {
        // Mark that we need to scroll to bottom once data loads
        pendingScrollToBottomRef.current = true
      }
      previousGenerationsCountRef.current = 0 // Reset count for new session
      sessionAutoScrollAttemptCountRef.current = 0
      isPinnedToBottomRef.current = !deepLinkOutputId
      setIsPinnedToBottom(!deepLinkOutputId)
    }
    previousSessionIdRef.current = session?.id || null
  }, [session?.id, deepLinkOutputId])

  const scrollToBottomNow = useCallback(
    (reason: 'session-load' | 'pinned-resize' | 'new-items') => {
      const container = scrollContainerRef.current
      if (!container || !session?.id) return

      const beforeDistance =
        container.scrollHeight - container.scrollTop - container.clientHeight
      const before = {
        scrollTop: Math.round(container.scrollTop),
        scrollHeight: Math.round(container.scrollHeight),
        clientHeight: Math.round(container.clientHeight),
        distanceFromBottom: Math.round(beforeDistance),
      }

      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'auto',
      })

      const afterDistance =
        container.scrollHeight - container.scrollTop - container.clientHeight
      const after = {
        scrollTop: Math.round(container.scrollTop),
        scrollHeight: Math.round(container.scrollHeight),
        clientHeight: Math.round(container.clientHeight),
        distanceFromBottom: Math.round(afterDistance),
      }
    },
    [session?.id]
  )

  // Observe scroll content height changes to detect late-loading layout shifts (images, virtualizer, dynamic import)
  // Track previous height to only scroll when content grows (not shrinks due to cancelled generations)
  const previousContentHeightRef = useRef<number>(0)
  const scrollDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  useEffect(() => {
    if (isLoading) return
    if (!session?.id) return
    const contentEl = scrollContentRef.current
    const container = scrollContainerRef.current
    if (!contentEl || !container) return
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (!container) return

      const currentHeight = container.scrollHeight
      const previousHeight = previousContentHeightRef.current
      
      // Update stored height
      previousContentHeightRef.current = currentHeight

      // ONLY auto-scroll during initial session load (pendingScrollToBottomRef)
      // NEVER auto-scroll when new items are added - this prevents the "yank" effect
      // Users can click the "new items" indicator or scroll manually
      const shouldScrollForPending = pendingScrollToBottomRef.current
      
      if (shouldScrollForPending) {
        // Debounce scroll calls to prevent jitter during rapid resize events
        // Only scroll after 50ms of no further resize events
        if (scrollDebounceTimerRef.current) {
          clearTimeout(scrollDebounceTimerRef.current)
        }
        
        scrollDebounceTimerRef.current = setTimeout(() => {
          scrollDebounceTimerRef.current = null
          
          // Check again if we still need to scroll (might have been cleared)
          if (!pendingScrollToBottomRef.current) return
          
          scrollToBottomNow('session-load')
          
          // Clear pending once we are actually at (or extremely near) the bottom
          const afterDistance =
            container.scrollHeight - container.scrollTop - container.clientHeight
          if (afterDistance < 10) { // Slightly larger threshold for more reliable settling
            pendingScrollToBottomRef.current = false
          } else {
            sessionAutoScrollAttemptCountRef.current += 1
            // Avoid infinite loops if something is truly off; fall back to non-pending behavior.
            if (sessionAutoScrollAttemptCountRef.current >= 6) {
              pendingScrollToBottomRef.current = false
            }
          }
        }, 50)
      }
    })

    observer.observe(contentEl)
    return () => {
      observer.disconnect()
      if (scrollDebounceTimerRef.current) {
        clearTimeout(scrollDebounceTimerRef.current)
      }
    }
  }, [session?.id, isLoading, generations.length, scrollToBottomNow])

  // CRITICAL: Use useLayoutEffect for initial session-load scroll-to-bottom
  // This fires synchronously BEFORE the browser paints, eliminating the visible "jump"
  // where the user briefly sees the wrong scroll position before it corrects itself.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    
    // Only handle initial session load scroll (not new items)
    if (!isLoading && pendingScrollToBottomRef.current && generations.length > 0) {
      // Scroll to bottom synchronously before paint
      container.scrollTop = container.scrollHeight
      // Note: Don't clear pendingScrollToBottomRef here - let ResizeObserver handle
      // late layout shifts (images loading, virtualizer measuring, etc.)
    }
  }, [isLoading, generations.length])

  // Handle scrolling: on session load completion and new items
  // This useEffect acts as a fallback and handles the new-items indicator
  useEffect(() => {
    if (!scrollContainerRef.current) return
    
    const currentCount = generations.length
    const previousCount = previousGenerationsCountRef.current
    const hasNewItems = currentCount > previousCount && previousCount > 0
    
    // Scroll to bottom when session data finishes loading (fallback for useLayoutEffect)
    if (!isLoading && pendingScrollToBottomRef.current && currentCount > 0) {
      // Attempt an immediate scroll (ResizeObserver will keep it pinned through late layout shifts)
      scrollToBottomNow('session-load')
      setShowNewItemsIndicator(false)
      previousGenerationsCountRef.current = currentCount
      return
    }
    
    // Update count reference
    previousGenerationsCountRef.current = currentCount
    
    // For new items (not session change): NEVER auto-scroll
    // Always show the indicator so user can choose when to scroll
    // This prevents the jarring "yank" effect when generating while scrolled up
    if (hasNewItems && !pendingScrollToBottomRef.current) {
      // Only show indicator if user is not already at bottom
      // Check the ref directly to avoid race conditions with state
      if (!isPinnedToBottomRef.current) {
        setShowNewItemsIndicator(true)
      }
      // If user IS at bottom, they'll naturally see the new content - no scroll needed
    }
  }, [generations.length, isLoading, scrollToBottomNow])

  // Load older items when scrolling to top (sentinel at top)
  // Uses fetchOlderPagePreservingScroll to prevent scroll position jumps
  useEffect(() => {
    if (!hasNextPage || !loadOlderRef.current || !scrollContainerRef.current) return
    
    const container = scrollContainerRef.current
    const target = loadOlderRef.current
    
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (first.isIntersecting && hasNextPage && !isFetchingNextPage) {
          // Use scroll-preserving helper (stores scrollHeight before fetch)
          fetchOlderPagePreservingScroll()
        }
      },
      {
        root: container,
        rootMargin: '200px',
        threshold: 0,
      }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchOlderPagePreservingScroll])

  // Preserve scroll position when older items are prepended
  useEffect(() => {
    if (scrollHeightBeforeLoadRef.current !== null && scrollContainerRef.current && !isFetchingNextPage) {
      const container = scrollContainerRef.current
      const newScrollHeight = container.scrollHeight
      const scrollDelta = newScrollHeight - scrollHeightBeforeLoadRef.current
      
      if (scrollDelta > 0) {
        // Adjust scroll position to keep the same content in view
        container.scrollTop += scrollDelta
      }
      
      scrollHeightBeforeLoadRef.current = null
    }
  }, [generations.length, isFetchingNextPage])
  
  // Helper to scroll to bottom (for "new items" button)
  const scrollToBottom = () => {
    scrollContainerRef.current?.scrollTo({
      top: scrollContainerRef.current.scrollHeight,
      behavior: 'smooth',
    })
    setShowNewItemsIndicator(false)
  }

  const handleGenerate = async (
    prompt: string,
    options?: { 
      referenceImage?: File
      referenceImages?: File[]
      referenceImageId?: string
      /** Pre-uploaded reference image URL (bypasses 4.5MB limit) */
      referenceImageUrl?: string
      endFrameImage?: File
      endFrameImageId?: string
      /** Pre-uploaded end frame URL (bypasses 4.5MB limit) */
      endFrameImageUrl?: string
    }
  ) => {
    if (!session || !prompt.trim()) return

    // Create pending generation ID
    const pendingId = `pending-${Date.now()}`

    try {
      // PRIORITY: Use pre-uploaded URLs when available (bypasses Vercel's 4.5MB limit completely)
      // Only fall back to compression if Files are provided without URLs
      
      // Count files that need compression (exclude those with pre-uploaded URLs)
      const needsReferenceCompression = options?.referenceImage && !options?.referenceImageUrl
      const needsEndFrameCompression = options?.endFrameImage && !options?.endFrameImageUrl
      const referenceImageCount = options?.referenceImages?.length || (needsReferenceCompression ? 1 : 0)
      const endFrameCount = needsEndFrameCompression ? 1 : 0
      const imageCount = referenceImageCount + endFrameCount
      const maxTotalSizeMB = 3.0 // Conservative limit to leave room for other request data
      const maxPerImageMB = imageCount > 1 
        ? Math.max(0.5, maxTotalSizeMB / imageCount) // Split budget between all images
        : 2.5 // Single image can be larger (but not too large for Vercel)
      const maxDimension = imageCount > 1 ? 1536 : 1920 // Smaller dimensions for multiple images
      const quality = imageCount > 1 ? 0.75 : 0.85 // Lower quality for multiple images
      
      const compressImage = (file: File, targetMaxMB: number): Promise<string> => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = reader.result as string
            
            // Check size and compress if necessary
            const img = new Image()
            img.onload = () => {
              const canvas = document.createElement('canvas')
              const ctx = canvas.getContext('2d')
              
              if (!ctx) {
                resolve(dataUrl) // Fallback to original if canvas not supported
                return
              }
              
              // Calculate new dimensions
              let { width, height } = img
              if (width > maxDimension || height > maxDimension) {
                const ratio = maxDimension / Math.max(width, height)
                width = Math.floor(width * ratio)
                height = Math.floor(height * ratio)
              }
              
              canvas.width = width
              canvas.height = height
              ctx.drawImage(img, 0, 0, width, height)
              
              // Convert to JPEG with appropriate quality
              let compressedDataUrl = canvas.toDataURL('image/jpeg', quality)
              
              // If still too large, reduce quality further
              let currentQuality = quality
              let attempts = 0
              while (compressedDataUrl.length / (1024 * 1024) > targetMaxMB && attempts < 3 && currentQuality > 0.5) {
                currentQuality = Math.max(0.5, currentQuality - 0.1)
                compressedDataUrl = canvas.toDataURL('image/jpeg', currentQuality)
                attempts++
              }
              
              // Final size check
              const sizeInMB = compressedDataUrl.length / (1024 * 1024)
              if (sizeInMB > targetMaxMB * 1.1) { // Allow 10% tolerance
                console.warn(`Compressed image still too large (${sizeInMB.toFixed(2)}MB), target: ${targetMaxMB.toFixed(2)}MB`)
                // Try one more time with even lower quality
                compressedDataUrl = canvas.toDataURL('image/jpeg', 0.5)
                const finalSizeMB = compressedDataUrl.length / (1024 * 1024)
                if (finalSizeMB > targetMaxMB * 1.2) {
                  reject(new Error(`Image too large after compression (${finalSizeMB.toFixed(2)}MB). Please use smaller images.`))
                  return
                }
              }
              
              resolve(compressedDataUrl)
            }
            img.onerror = () => resolve(dataUrl) // Fallback on error
            img.src = dataUrl
          }
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
      }

      // Handle multiple images (preferred) or single image (backward compatibility)
      let referenceImageData: string | undefined
      let referenceImagesData: string[] | undefined
      
      if (options?.referenceImages && options.referenceImages.length > 0) {
        // Multiple images - compress each with per-image limit
        try {
          referenceImagesData = await Promise.all(
            options.referenceImages.map(file => compressImage(file, maxPerImageMB))
          )
          
          // Validate total size
          const totalSizeMB = referenceImagesData.reduce((sum, img) => sum + img.length / (1024 * 1024), 0)
          if (totalSizeMB > maxTotalSizeMB) {
            throw new Error(
              `Total image size (${totalSizeMB.toFixed(2)}MB) exceeds limit (${maxTotalSizeMB}MB). ` +
              `Please use fewer or smaller images.`
            )
          }
        } catch (error: any) {
          toast({
            title: "Image too large",
            description: error.message || 'Images are too large. Please use smaller images or fewer images.',
            variant: "destructive",
          })
          throw error
        }
      } else if (options?.referenceImage) {
        // Single image (backward compatibility)
        try {
          referenceImageData = await compressImage(options.referenceImage, maxPerImageMB)
        } catch (error: any) {
          toast({
            title: "Image too large",
            description: error.message || 'Image is too large. Please use a smaller image.',
            variant: "destructive",
          })
          throw error
        }
      }

      // Handle end frame image for video interpolation (Kling 2.6)
      let endFrameImageData: string | undefined
      if (options?.endFrameImage) {
        try {
          endFrameImageData = await compressImage(options.endFrameImage, maxPerImageMB)
        } catch (error: any) {
          toast({
            title: "End frame image too large",
            description: error.message || 'End frame image is too large. Please use a smaller image.',
            variant: "destructive",
          })
          throw error
        }
      }

      // Build parameters - prefer pre-uploaded URLs over base64 data
      // Determine reference image data (URL preferred over base64)
      // IMPORTANT: Server expects HTTP URLs as referenceImageUrl, base64 as referenceImage
      let referenceImageData_: string | undefined // base64 data
      let referenceImageUrl_: string | undefined // HTTP URL
      let finalReferenceImages: string[] | undefined
      let endFrameImageData_: string | undefined // base64 data
      let endFrameImageUrl_: string | undefined // HTTP URL
      
      if (options?.referenceImageUrl) {
        // Pre-uploaded URL - use directly (bypasses 4.5MB limit!)
        referenceImageUrl_ = options.referenceImageUrl
        console.log('[GenerationInterface] Using pre-uploaded reference URL')
      } else if (referenceImagesData && referenceImagesData.length > 0) {
        finalReferenceImages = referenceImagesData
      } else if (referenceImageData) {
        referenceImageData_ = referenceImageData
      }
      
      if (options?.endFrameImageUrl) {
        // Pre-uploaded URL - use directly (bypasses 4.5MB limit!)
        endFrameImageUrl_ = options.endFrameImageUrl
        console.log('[GenerationInterface] Using pre-uploaded end frame URL')
      } else if (endFrameImageData) {
        endFrameImageData_ = endFrameImageData
      }
      
      const result = await generateMutation.mutateAsync({
        sessionId: session.id,
        modelId: selectedModel,
        prompt,
        parameters: {
          aspectRatio: parameters.aspectRatio,
          resolution: parameters.resolution,
          numOutputs: parameters.numOutputs,
          ...(generationType === 'video' && parameters.duration && { duration: parameters.duration }),
          ...(finalReferenceImages && finalReferenceImages.length > 0 && { referenceImages: finalReferenceImages }),
          // Reference image: URL goes to referenceImageUrl, base64 goes to referenceImage
          ...(referenceImageUrl_ && { referenceImageUrl: referenceImageUrl_ }),
          ...(referenceImageData_ && !referenceImageUrl_ && { referenceImage: referenceImageData_ }),
          ...(options?.referenceImageId && { referenceImageId: options.referenceImageId }),
          // End frame: URL goes to endFrameImageUrl, base64 goes to endFrameImage
          ...(endFrameImageUrl_ && { endFrameImageUrl: endFrameImageUrl_ }),
          ...(endFrameImageData_ && !endFrameImageUrl_ && { endFrameImage: endFrameImageData_ }),
          ...(options?.endFrameImageId && { endFrameImageId: options.endFrameImageId }),
        },
      })
      
      // Success is indicated by the progress bar, no toast needed
    } catch (error: any) {
      console.error('Generation error:', error)
      toast({
        title: "Generation failed",
        description: error.message || 'Failed to generate. Please try again.',
        variant: "destructive",
      })
      // Re-throw the error so the ChatInput knows not to clear the prompt
      throw error
    }
  }

  const handleReuseParameters = async (generation: GenerationWithOutputs) => {
    // Set prompt
    setPrompt(generation.prompt)
    
    // Set model
    setSelectedModel(generation.modelId)
    
    // Set parameters
    const genParams = generation.parameters as any
    const isVideo = generationType === 'video'
    setParameters({
      aspectRatio: genParams.aspectRatio || (isVideo ? '16:9' : '1:1'),
      resolution: genParams.resolution || (isVideo ? 720 : 1024),
      numOutputs: genParams.numOutputs || (isVideo ? 1 : 4),
      ...(isVideo
        ? { duration: typeof genParams.duration === 'number' ? genParams.duration : 5 }
        : (typeof genParams.duration === 'number' ? { duration: genParams.duration } : {})),
    })
    
    // Reuse reference images
    if (generationType === 'video') {
      // For video: use referenceImageUrl (single image or begin frame)
      if (genParams.referenceImageUrl) {
        setReferenceImageUrl(genParams.referenceImageUrl)
      } else if (genParams.referenceImageId) {
        // If we only have an ID, construct the public URL
        // Reference images are stored in generated-images bucket
        const supabase = createClient()
        const { data: { publicUrl } } = supabase.storage
          .from('generated-images')
          .getPublicUrl(`references/${generation.userId}/${genParams.referenceImageId}.jpg`)
        if (publicUrl) {
          setReferenceImageUrl(publicUrl)
        }
      }
      // TODO: Handle beginFrame and endFrame when implemented
    } else {
      // For images: use referenceImages (can be multiple)
      const urls: string[] = []
      
      if (genParams.referenceImages && Array.isArray(genParams.referenceImages) && genParams.referenceImages.length > 0) {
        // Handle both HTTP URLs and data URLs
        // Data URLs need to be converted to Files, but for now we can pass them directly
        // The ChatInput component will handle converting data URLs to Files
        const validImages = genParams.referenceImages.filter((img: string) => 
          typeof img === 'string' && (img.startsWith('http') || img.startsWith('data:'))
        )
        urls.push(...validImages)
      } else if (genParams.referenceImageUrl) {
        urls.push(genParams.referenceImageUrl)
      } else if (genParams.referenceImageId) {
        // Construct public URL from ID
        const supabase = createClient()
        // Try both jpg and png extensions
        const extensions = ['jpg', 'png']
        for (const ext of extensions) {
          const { data: { publicUrl } } = supabase.storage
            .from('generated-images')
            .getPublicUrl(`references/${generation.userId}/${genParams.referenceImageId}.${ext}`)
          if (publicUrl) {
            urls.push(publicUrl)
            break
          }
        }
      }
      
      if (urls.length > 0) {
        setReferenceImageUrls(urls)
      }
    }
  }

  const handleRerunGeneration = async (generation: GenerationWithOutputs) => {
    if (!session) {
      toast({
        title: 'No session',
        description: 'Please select a session first.',
        variant: 'destructive',
      })
      return
    }
    
    try {
      const genParams = generation.parameters as any
      
      await generateMutation.mutateAsync({
        sessionId: session.id,
        modelId: generation.modelId,
        prompt: generation.prompt,
        parameters: {
          aspectRatio: genParams.aspectRatio,
          resolution: genParams.resolution,
          numOutputs: genParams.numOutputs,
          ...(genParams.duration && { duration: genParams.duration }),
          ...(genParams.referenceImages && genParams.referenceImages.length > 0 && { referenceImages: genParams.referenceImages }),
          ...(genParams.referenceImageUrl && { referenceImageUrl: genParams.referenceImageUrl }),
          ...(genParams.referenceImageId && { referenceImageId: genParams.referenceImageId }),
          ...(genParams.endFrameImageUrl && { endFrameImageUrl: genParams.endFrameImageUrl }),
          ...(genParams.endFrameImageId && { endFrameImageId: genParams.endFrameImageId }),
        },
      })
      
      toast({
        title: 'Generation started',
        description: 'Rerunning with the same parameters.',
      })
    } catch (error: any) {
      console.error('Rerun generation error:', error)
      toast({
        title: 'Rerun failed',
        description: error.message || 'Failed to rerun generation. Please try again.',
        variant: 'destructive',
      })
    }
  }

  const handleConvertToVideo = async (generation: GenerationWithOutputs, videoSessionId: string, imageUrl?: string) => {
    if (!onSessionSwitch) return

    // Switch to the video session
    onSessionSwitch(videoSessionId)

    // Do NOT copy the image prompt into the video prompt box.
    // The user will write a video-specific prompt (optionally enhanced).
    setPrompt('')
    // Force default video model when moving into a video session
    const preferredVideoModelId = getPreferredModelIdFromList(allModels, 'video')
    if (preferredVideoModelId) {
      setSelectedModel(preferredVideoModelId)
    }
    
    // Set the reference image URL for the thumbnail
    if (imageUrl) {
      setReferenceImageUrl(imageUrl)
    }
    
    setParameters({
      // Match Animate Still defaults when entering a video session.
      aspectRatio: '16:9',
      resolution: 720,
      numOutputs: 1,
      duration: 5,
    })

    toast({
      title: "Converted to video",
      description: "Reference image sent. Write a video prompt or use the wand to enhance.",
      variant: "success",
    })
  }

  // Get video sessions
  const videoSessions = allSessions.filter(s => s.type === 'video')
  
  // Build display generations list in chronological order (oldest → newest for display)
  // API returns newest-first, so we reverse for display (newest at bottom, near the prompt)
  // Apply de-dupe as a last-line defense against duplicate tiles
  const displayGenerations = useMemo(() => {
    // De-dupe by id and clientId before display
    // This is the UI's final guard against duplicates
    const seenIds = new Set<string>()
    const seenClientIds = new Map<string, GenerationWithOutputs>()
    const deduped: GenerationWithOutputs[] = []
    
    for (const gen of generations) {
      // Skip duplicate by id
      if (seenIds.has(gen.id)) continue
      
      // Handle duplicate by clientId (prefer real UUID over temp-*)
      if (gen.clientId) {
        const existing = seenClientIds.get(gen.clientId)
        if (existing) {
          const existingIsTemp = existing.id.startsWith('temp-')
          const currentIsTemp = gen.id.startsWith('temp-')
          
          if (existingIsTemp && !currentIsTemp) {
            // Replace temp with real
            const idx = deduped.indexOf(existing)
            if (idx !== -1) {
              deduped[idx] = gen
              seenIds.delete(existing.id)
              seenIds.add(gen.id)
              seenClientIds.set(gen.clientId, gen)
            }
          }
          continue
        }
        seenClientIds.set(gen.clientId, gen)
      }
      
      seenIds.add(gen.id)
      deduped.push(gen)
    }
    
    // Reverse so oldest is at top, newest at bottom
    return deduped.reverse()
  }, [generations])

  if (!session) {
    return (
      <div className="flex-1 pl-[var(--dock-left-gutter)] flex items-center justify-center text-muted-foreground bg-grid-soft">
        <div className="text-center">
          <p className="text-lg mb-2">No session selected</p>
          <p className="text-sm">Create or select a session to start generating</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Gallery Area - Always show, even if empty */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto bg-grid-soft" style={{ scrollbarGutter: 'stable' }}>
        {isLoading ? (
          // Loading state
          <div className="h-full pl-[var(--dock-left-gutter)] flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg mb-2">Loading generations...</p>
            </div>
          </div>
        ) : (
          <div ref={scrollContentRef} className={cn(
            "pt-24 pb-52 flex justify-center",
            "pl-[var(--dock-left-gutter)]",
            "transition-[padding] duration-300 ease-in-out"
          )}>
            <div className="w-full max-w-7xl 2xl:max-w-[1400px] min-[1800px]:max-w-[1600px]">
              {/* Sentinel at TOP for loading older items when scrolling up */}
              <div ref={loadOlderRef} className="h-1 w-full" />
              
              {/* Loading indicator for older items */}
              {isFetchingNextPage && (
                <div className="flex justify-center py-4">
                  <div className="text-sm text-muted-foreground">Loading older generations...</div>
                </div>
              )}
              
              {/* Show "load older" hint if there are more pages */}
              {hasNextPage && !isFetchingNextPage && displayGenerations.length > 0 && (
                <div className="flex justify-center py-2 mb-4">
                  <span className="text-xs text-muted-foreground">↑ Scroll up to load older generations</span>
                </div>
              )}
              
              <GenerationGallery
                generations={displayGenerations}
                sessionId={session?.id || null}
                projectId={session?.projectId || ''}
                onReuseParameters={handleReuseParameters}
                onRerunGeneration={handleRerunGeneration}
                videoSessions={videoSessions}
                onConvertToVideo={handleConvertToVideo}
                onCreateVideoSession={onSessionCreate}
                currentGenerationType={generationType}
                currentUser={currentUser}
                onDismissGeneration={handleDismissGeneration}
                scrollContainerRef={scrollContainerRef}
                scrollToOutputId={scrollToOutputId}
                highlightOutputId={highlightOutputId}
                onScrollToOutputComplete={() => setScrollToOutputId(null)}
                onUseAsReference={(imageUrl) => {
                  // Clear prompt and any existing images, leaving only the reference
                  setPrompt('')
                  if (generationType === 'video') {
                    setReferenceImageUrl(imageUrl)
                  } else {
                    // Replace all existing reference images with just this one
                    setReferenceImageUrls([imageUrl])
                  }
                  toast({
                    title: 'Reference added',
                    description: 'Prompt cleared. Image set as reference.',
                  })
                }}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* New items indicator - shown when not pinned to bottom and new items arrive */}
      {showNewItemsIndicator && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-48 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce"
        >
          ↓ New items
        </button>
      )}

      {/* Chat Input - Floating Card at Bottom - Responsive width using dock tokens */}
      {/* Use wider max-width for multi-image models to accommodate thumbnail strip */}
      <div className={cn(
        "absolute bottom-[var(--dock-bottom)] left-1/2 -translate-x-1/2",
        "w-full px-4 xl:px-6 z-30",
        "transition-[max-width] duration-300 ease-in-out",
        supportsMultiImage 
          ? "max-w-[var(--dock-prompt-max-w-multi)]" 
          : "max-w-[var(--dock-prompt-max-w)]"
      )}>
        <div className="flex items-center gap-3">
          {/* Prompt Bar */}
          <div className="flex-1 bg-card/95 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl p-4">
              {generationType === 'video' ? (
                <VideoInput
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  onGenerate={handleGenerate}
                  parameters={parameters}
                  onParametersChange={setParameters}
                  selectedModel={selectedModel}
                  onModelSelect={setSelectedModel}
                  referenceImageUrl={referenceImageUrl}
                  onClearReferenceImage={() => setReferenceImageUrl(null)}
                  onSetReferenceImageUrl={setReferenceImageUrl}
                  onRegisterPasteHandler={registerPasteHandler}
                />
              ) : (
                <ChatInput
                  prompt={prompt}
                  onPromptChange={setPrompt}
                  onGenerate={handleGenerate}
                  parameters={parameters}
                  onParametersChange={setParameters}
                  generationType={generationType}
                  selectedModel={selectedModel}
                  onModelSelect={setSelectedModel}
                  isGenerating={false}
                  referenceImageUrls={referenceImageUrls}
                  onReferenceImageUrlsChange={setReferenceImageUrls}
                  onRegisterPasteHandler={registerPasteHandler}
                />
              )}
          </div>

          {/* Vertical Control Bar */}
          <div className="flex flex-col gap-1 bg-card/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-2xl p-1.5">
            {/* Image/Video Toggle */}
            <button
              onClick={() => onGenerationTypeChange?.('image')}
              className={cn(
                'p-2 rounded-lg transition-all',
                generationType === 'image'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
              title="Image generation"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() => onGenerationTypeChange?.('video')}
              className={cn(
                'p-2 rounded-lg transition-all',
                generationType === 'video'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )}
              title="Video generation"
            >
              <Video className="h-4 w-4" />
            </button>

            {/* Spacer */}
            <div className="flex-1 min-h-2" />

            {/* Divider */}
            <div className="h-px bg-border/50 mx-1" />

            {/* Chat Button */}
            <div className="relative">
              <button
                onClick={onToggleChat}
                className={cn(
                  'p-2 rounded-lg transition-all relative z-50',
                  isChatOpen
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
                title={isChatOpen ? "Close chat assistant" : "Open chat assistant"}
              >
                <MessageCircle className="h-4 w-4" />
              </button>
              
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

