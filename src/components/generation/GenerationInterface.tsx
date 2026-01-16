'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useQueryClient, InfiniteData } from '@tanstack/react-query'
import { ChatInput } from './ChatInput'
import type { Session } from '@/types/project'
import type { GenerationWithOutputs } from '@/types/generation'
import { useInfiniteGenerations } from '@/hooks/useInfiniteGenerations'
import { useGenerationsRealtime } from '@/hooks/useGenerationsRealtime'
import { useGenerateMutation } from '@/hooks/useGenerateMutation'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
import { useUIStore } from '@/store/uiStore'
import { useToast } from '@/components/ui/use-toast'
import { getAllModels, getModelsByType } from '@/lib/models/registry'
import { createClient } from '@/lib/supabase/client'
import { Image as ImageIcon, Video, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const DEFAULT_VIDEO_MODEL_ID = 'kling-official'

function getPreferredModelId(type: 'image' | 'video'): string | null {
  const models = getModelsByType(type)
  if (type === 'video') {
    const preferred = models.find((m) => m.id === DEFAULT_VIDEO_MODEL_ID)
    return preferred?.id ?? models[0]?.id ?? null
  }
  return models[0]?.id ?? null
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
  onSessionCreate?: (type: 'image' | 'video', name: string) => Promise<Session | null>
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
   * Dismiss/remove a stuck generation from the UI cache.
   * Used when a generation is stuck in 'processing' state but doesn't exist in the database.
   */
  const handleDismissGeneration = useCallback((generationId: string, clientId?: string) => {
    console.log('Dismissing stuck generation:', generationId, clientId)
    
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
    
    toast({
      title: 'Generation dismissed',
      description: 'The stuck generation has been removed from the view.',
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
  
  // Use infinite query for progressive loading (loads 10 at a time)
  const {
    data: infiniteData,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteGenerations(session?.id || null, 10)
  
  // Flatten all pages into a single array
  const generations = infiniteData?.pages.flatMap((page) => page.data) || []
  
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
    const all = getAllModels()
    const current = all.find(m => m.id === selectedModel)
    const requiredType = generationType
    
    // Enforce model type per view: image sessions -> image models, video sessions -> video models
    if (!current || current.type !== requiredType) {
      const fallbackId = getPreferredModelId(requiredType)
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
  }, [generationType, selectedModel])

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
      // Mark that we need to scroll to bottom once data loads
      pendingScrollToBottomRef.current = true
      previousGenerationsCountRef.current = 0 // Reset count for new session
      sessionAutoScrollAttemptCountRef.current = 0
      isPinnedToBottomRef.current = true
      setIsPinnedToBottom(true)
    }
    previousSessionIdRef.current = session?.id || null
  }, [session?.id])

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
      const heightIncreased = currentHeight > previousHeight
      
      // Update stored height
      previousContentHeightRef.current = currentHeight

      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight

      // Keep the view pinned to bottom across late layout shifts
      // - When opening a session: force-scroll until we actually reach bottom at least once
      // - When user is pinned AND content height increased (new content, not cancelled generations)
      const shouldScrollForPending = pendingScrollToBottomRef.current
      const shouldScrollForPinned = isPinnedToBottomRef.current && heightIncreased && distanceFromBottom < 50
      
      if (shouldScrollForPending || shouldScrollForPinned) {
        scrollToBottomNow(shouldScrollForPending ? 'session-load' : 'pinned-resize')
        // Clear pending once we are actually at (or extremely near) the bottom
        const afterDistance =
          container.scrollHeight - container.scrollTop - container.clientHeight
        if (afterDistance < 2) {
          pendingScrollToBottomRef.current = false
        } else {
          sessionAutoScrollAttemptCountRef.current += 1
          // Avoid infinite loops if something is truly off; fall back to non-pending behavior.
          if (sessionAutoScrollAttemptCountRef.current >= 6) {
            pendingScrollToBottomRef.current = false
          }
        }
      }
    })

    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [session?.id, isLoading, generations.length, scrollToBottomNow])

  // Handle scrolling: on session load completion and new items
  useEffect(() => {
    if (!scrollContainerRef.current) return
    
    const currentCount = generations.length
    const previousCount = previousGenerationsCountRef.current
    const hasNewItems = currentCount > previousCount && previousCount > 0
    
    // Scroll to bottom when session data finishes loading
    if (!isLoading && pendingScrollToBottomRef.current && currentCount > 0) {
      // Attempt an immediate scroll (ResizeObserver will keep it pinned through late layout shifts)
      scrollToBottomNow('session-load')
      setShowNewItemsIndicator(false)
      previousGenerationsCountRef.current = currentCount
      return
    }
    
    // Update count reference
    previousGenerationsCountRef.current = currentCount
    
    // For new items (not session change): auto-scroll if pinned, show indicator otherwise
    if (hasNewItems && !pendingScrollToBottomRef.current) {
      if (isPinnedToBottom) {
        scrollToBottomNow('new-items')
      } else {
        setShowNewItemsIndicator(true)
      }
    }
  }, [generations.length, isLoading, isPinnedToBottom, scrollToBottomNow])

  // Load older items when scrolling to top (sentinel at top)
  useEffect(() => {
    if (!hasNextPage || !loadOlderRef.current || !scrollContainerRef.current) return
    
    const container = scrollContainerRef.current
    const target = loadOlderRef.current
    
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (first.isIntersecting && hasNextPage && !isFetchingNextPage) {
          // Store scroll height before loading to preserve position
          scrollHeightBeforeLoadRef.current = container.scrollHeight
          fetchNextPage()
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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

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
      let finalReferenceImage: string | undefined
      let finalReferenceImages: string[] | undefined
      let finalEndFrameImage: string | undefined
      
      if (options?.referenceImageUrl) {
        // Pre-uploaded URL - use directly (bypasses 4.5MB limit!)
        finalReferenceImage = options.referenceImageUrl
        console.log('[GenerationInterface] Using pre-uploaded reference URL')
      } else if (referenceImagesData && referenceImagesData.length > 0) {
        finalReferenceImages = referenceImagesData
      } else if (referenceImageData) {
        finalReferenceImage = referenceImageData
      }
      
      if (options?.endFrameImageUrl) {
        // Pre-uploaded URL - use directly (bypasses 4.5MB limit!)
        finalEndFrameImage = options.endFrameImageUrl
        console.log('[GenerationInterface] Using pre-uploaded end frame URL')
      } else if (endFrameImageData) {
        finalEndFrameImage = endFrameImageData
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
          ...(finalReferenceImage && !finalReferenceImages && { referenceImage: finalReferenceImage }),
          ...(options?.referenceImageId && { referenceImageId: options.referenceImageId }),
          ...(finalEndFrameImage && { endFrameImage: finalEndFrameImage }),
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

  const handleConvertToVideo = async (generation: GenerationWithOutputs, videoSessionId: string, imageUrl?: string) => {
    if (!onSessionSwitch) return

    // Switch to the video session
    onSessionSwitch(videoSessionId)

    // Do NOT copy the image prompt into the video prompt box.
    // The user will write a video-specific prompt (optionally enhanced).
    setPrompt('')
    // Force default video model when moving into a video session
    const preferredVideoModelId = getPreferredModelId('video')
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
  const displayGenerations = useMemo(() => {
    // Flatten all pages and reverse so oldest is at top, newest at bottom
    const allGenerations = [...generations].reverse()
    return allGenerations
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto bg-grid-soft">
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
                videoSessions={videoSessions}
                onConvertToVideo={handleConvertToVideo}
                onCreateVideoSession={onSessionCreate}
                currentGenerationType={generationType}
                currentUser={currentUser}
                onDismissGeneration={handleDismissGeneration}
                scrollContainerRef={scrollContainerRef}
                onUseAsReference={(imageUrl) => {
                  if (generationType === 'video') {
                    setReferenceImageUrl(imageUrl)
                  } else {
                    setReferenceImageUrls((prev) => {
                      if (prev.includes(imageUrl)) return prev
                      return [...prev, imageUrl]
                    })
                  }
                  toast({
                    title: 'Reference added',
                    description: 'Image added to prompt bar as reference',
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
      <div className={cn(
        "absolute bottom-[var(--dock-bottom)] left-1/2 -translate-x-1/2",
        "w-full max-w-[var(--dock-prompt-max-w)] px-4 xl:px-6 z-30",
        "transition-[max-width] duration-300 ease-in-out"
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

