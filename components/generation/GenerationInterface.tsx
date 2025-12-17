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
import { useUIStore } from '@/store/uiStore'
import { useToast } from '@/components/ui/use-toast'
import { getAllModels, getModelsByType } from '@/lib/models/registry'
import { createClient } from '@/lib/supabase/client'

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
}

export function GenerationInterface({
  session,
  generationType,
  allSessions = [],
  onSessionCreate,
  onSessionSwitch,
}: GenerationInterfaceProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const loadOlderRef = useRef<HTMLDivElement | null>(null) // Sentinel at TOP for loading older items
  const [prompt, setPrompt] = useState('')
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null)
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]) // For image generation with multiple images
  const [userId, setUserId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<{ displayName: string | null } | null>(null)
  const previousSessionIdRef = useRef<string | null>(null)
  
  // Scroll pinning state
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)
  const [showNewItemsIndicator, setShowNewItemsIndicator] = useState(false)
  const previousGenerationsCountRef = useRef(0)
  const scrollHeightBeforeLoadRef = useRef<number | null>(null)
  
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
  
  console.log('🟢 Generations from infinite query:', generations.length)
  if (generations.length > 0) {
    console.log('🟢 Sample generation:', { id: generations[0].id, status: generations[0].status, outputs: (generations[0].outputs || []).length })
    console.log('🟢 All generation statuses:', generations.map(g => ({ id: g.id, status: g.status })))
  }
  
  // Subscribe to real-time updates
  useGenerationsRealtime(session?.id || null, userId)
  
  // Use React Query mutation for generating
  const generateMutation = useGenerateMutation()

  // Set numOutputs based on generationType and model config
  useEffect(() => {
    const all = getAllModels()
    const current = all.find(m => m.id === selectedModel)
    const requiredType = generationType
    
    // Enforce model type per view: image sessions -> image models, video sessions -> video models
    if (!current || current.type !== requiredType) {
      const fallback = getModelsByType(requiredType)[0]
      if (fallback) {
        setSelectedModel(fallback.id)
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
      // Consider "pinned" if within 100px of bottom
      const pinned = distanceFromBottom < 100
      setIsPinnedToBottom(pinned)
      
      // Hide new items indicator when user scrolls to bottom
      if (pinned && showNewItemsIndicator) {
        setShowNewItemsIndicator(false)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [showNewItemsIndicator])

  // Handle new items: auto-scroll if pinned, show indicator otherwise
  useEffect(() => {
    const isNewSession = session?.id !== previousSessionIdRef.current
    previousSessionIdRef.current = session?.id || null
    
    if (!isLoading && scrollContainerRef.current) {
      const currentCount = generations.length
      const previousCount = previousGenerationsCountRef.current
      const hasNewItems = currentCount > previousCount && previousCount > 0
      
      previousGenerationsCountRef.current = currentCount
      
      // Always scroll to bottom on session change
      if (isNewSession && currentCount > 0) {
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo({
            top: scrollContainerRef.current!.scrollHeight,
            behavior: 'auto',
          })
          setIsPinnedToBottom(true)
          setShowNewItemsIndicator(false)
        }, 300)
        return
      }
      
      // For new items: auto-scroll if pinned, show indicator otherwise
      if (hasNewItems) {
        if (isPinnedToBottom) {
          setTimeout(() => {
            scrollContainerRef.current?.scrollTo({
              top: scrollContainerRef.current!.scrollHeight,
              behavior: 'smooth',
            })
          }, 100)
        } else {
          setShowNewItemsIndicator(true)
        }
      }
    }
  }, [generations.length, isLoading, session?.id, isPinnedToBottom])

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
    options?: { referenceImage?: File; referenceImages?: File[]; referenceImageId?: string }
  ) => {
    if (!session || !prompt.trim()) return

    // Create pending generation ID
    const pendingId = `pending-${Date.now()}`

    try {
      // Convert reference images File(s) to base64 data URL(s) if provided
      // COMPRESS to prevent HTTP 413 errors (Vercel limit: 4.5MB for request body)
      // When multiple images are present, we need to be more aggressive with compression
      const imageCount = options?.referenceImages?.length || (options?.referenceImage ? 1 : 0)
      const maxTotalSizeMB = 3.5 // Leave room for other request data (prompt, parameters, etc.)
      const maxPerImageMB = imageCount > 1 
        ? Math.max(0.5, maxTotalSizeMB / imageCount) // More aggressive for multiple images
        : 3.0 // Single image can be larger
      const maxDimension = imageCount > 1 ? 1536 : 2048 // Smaller dimensions for multiple images
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

      const result = await generateMutation.mutateAsync({
        sessionId: session.id,
        modelId: selectedModel,
        prompt,
        parameters: {
          aspectRatio: parameters.aspectRatio,
          resolution: parameters.resolution,
          numOutputs: parameters.numOutputs,
          ...(parameters.duration && { duration: parameters.duration }),
          ...(referenceImagesData && referenceImagesData.length > 0 && { referenceImages: referenceImagesData }),
          ...(referenceImageData && !referenceImagesData && { referenceImage: referenceImageData }),
          ...(options?.referenceImageId && { referenceImageId: options.referenceImageId }),
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
    setParameters({
      aspectRatio: genParams.aspectRatio || '1:1',
      resolution: genParams.resolution || 1024,
      numOutputs: genParams.numOutputs || 1,
      ...(genParams.duration && { duration: genParams.duration }),
    })
    
    // Reuse reference images
    let hasRefImages = false
    if (generationType === 'video') {
      // For video: use referenceImageUrl (single image or begin frame)
      if (genParams.referenceImageUrl) {
        setReferenceImageUrl(genParams.referenceImageUrl)
        hasRefImages = true
      } else if (genParams.referenceImageId) {
        // If we only have an ID, construct the public URL
        // Reference images are stored in generated-images bucket
        const supabase = createClient()
        const { data: { publicUrl } } = supabase.storage
          .from('generated-images')
          .getPublicUrl(`references/${generation.userId}/${genParams.referenceImageId}.jpg`)
        if (publicUrl) {
          setReferenceImageUrl(publicUrl)
          hasRefImages = true
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
        hasRefImages = true
      }
    }
    
    // Show toast to confirm
    toast({
      title: "Parameters reused",
      description: hasRefImages 
        ? "Prompt, settings, and reference images have been loaded."
        : "Prompt and settings have been loaded. You can now modify and regenerate.",
      variant: "default",
    })
  }

  const handleConvertToVideo = async (generation: GenerationWithOutputs, videoSessionId: string, imageUrl?: string) => {
    if (!onSessionSwitch) return

    // Switch to the video session
    onSessionSwitch(videoSessionId)

    // Do NOT copy the image prompt into the video prompt box.
    // The user will write a video-specific prompt (optionally enhanced).
    setPrompt('')
    // Force default video model when moving into a video session
    const videoDefault = getModelsByType('video')[0]
    if (videoDefault) {
      setSelectedModel(videoDefault.id)
    }
    
    // Set the reference image URL for the thumbnail
    if (imageUrl) {
      setReferenceImageUrl(imageUrl)
    }
    
    const genParams = generation.parameters as any
    setParameters({
      aspectRatio: genParams.aspectRatio || '16:9', // Default to 16:9 for video
      resolution: genParams.resolution || 1024,
      numOutputs: 1, // Videos typically generate one at a time
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
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {isLoading ? (
          // Loading state
          <div className="h-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg mb-2">Loading generations...</p>
            </div>
          </div>
        ) : (
          <div className="p-6 flex justify-center">
            <div className="w-full max-w-7xl">
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
                onReuseParameters={handleReuseParameters}
                videoSessions={videoSessions}
                onConvertToVideo={handleConvertToVideo}
                onCreateVideoSession={onSessionCreate}
                currentGenerationType={generationType}
                currentUser={currentUser}
                onDismissGeneration={handleDismissGeneration}
              />
            </div>
          </div>
        )}
      </div>
      
      {/* New items indicator - shown when not pinned to bottom and new items arrive */}
      {showNewItemsIndicator && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90 transition-all animate-bounce"
        >
          ↓ New items
        </button>
      )}

      {/* Chat Input - Floating Card at Bottom */}
      <div className="border-t border-border/50 bg-muted/20 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card border border-border rounded-xl shadow-lg p-4">
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
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

