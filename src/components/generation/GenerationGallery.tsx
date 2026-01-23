import { useState, useRef, useCallback, useEffect, forwardRef, useMemo } from 'react'
import Image from 'next/image'
import { Download, RotateCcw, Info, Copy, Bookmark, Check, Video, Wand2, X, Trash2, Pin, ArrowDownRight } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { GenerationWithOutputs } from '@/types/generation'
import type { Session } from '@/types/project'
import { useUpdateOutputMutation } from '@/hooks/useOutputMutations'
import { usePinnedImages } from '@/hooks/usePinnedImages'
import { useModels } from '@/hooks/useModels'
import { useToast } from '@/components/ui/use-toast'
import { useQueryClient } from '@tanstack/react-query'
import { markGenerationDismissed } from '@/hooks/useGenerationsRealtime'
import { GenerationProgress } from './GenerationProgress'
import { ImageLightbox } from './ImageLightbox'
import { ImageToVideoOverlay } from './ImageToVideoOverlay'
import { VideoIterationsStackHint } from './VideoIterationsStackHint'

// Safe date formatter
const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'Unknown date'
  try {
    return new Date(date).toLocaleDateString()
  } catch (error) {
    return 'Invalid date'
  }
}

// Format model name with provider info from routing decision
const formatModelWithProvider = (generation: GenerationWithOutputs): { name: string; provider: string | null; isFallback: boolean } => {
  const params = generation.parameters as any
  const modelId = generation.modelId || 'unknown'
  
  // Check for provider route info (set by the routing system)
  const providerRoute = params?.providerRoute
  const costMetrics = params?.costMetrics
  
  // Determine provider from routing info or cost metrics
  let provider: string | null = null
  let isFallback = false
  
  if (providerRoute) {
    provider = providerRoute.provider === 'google' ? 'Google' : 
               providerRoute.provider === 'replicate' ? 'Replicate' : null
    isFallback = providerRoute.isFallback === true
  } else if (costMetrics?.wasFallback) {
    // Fallback detection from cost metrics
    provider = 'Replicate'
    isFallback = true
  } else if (costMetrics?.predictTime && modelId.startsWith('gemini-')) {
    // If we have predictTime on a gemini model, it used Replicate
    provider = 'Replicate'
    isFallback = true
  } else if (modelId.startsWith('gemini-')) {
    provider = 'Google'
  } else if (modelId.startsWith('replicate-')) {
    provider = 'Replicate'
  }
  
  // Format the model name nicely
  let name = modelId
    .replace('gemini-', '')
    .replace('replicate-', '')
    .replace(/-/g, ' ')
  
  // Capitalize each word
  name = name.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ')
  
  return { name, provider, isFallback }
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

const getPublicStorageUrl = (bucket: string, path: string): string | null => {
  if (!SUPABASE_URL) return null
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

const normalizeReferenceImageUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  if (value.startsWith('http') || value.startsWith('data:')) return value
  return null
}

// Helper to extract reference image URLs from generation parameters
const getReferenceImageUrls = (generation: GenerationWithOutputs): string[] => {
  const params = generation.parameters as any
  const urls: string[] = []
  
  // Prefer referenceImages array (multiple images)
  if (Array.isArray(params.referenceImages) && params.referenceImages.length > 0) {
    for (const candidate of params.referenceImages) {
      const normalized = normalizeReferenceImageUrl(candidate)
      if (normalized) urls.push(normalized)
    }
  }

  // Fallback: referenceImageUrl directly (single image)
  if (urls.length === 0 && params.referenceImageUrl) {
    const normalized = normalizeReferenceImageUrl(params.referenceImageUrl)
    if (normalized) urls.push(normalized)
  }

  // If we have a persisted path, we can construct the public URL
  if (urls.length === 0 && params.referenceImagePath) {
    const bucket = params.referenceImageBucket || 'generated-images'
    const constructed = getPublicStorageUrl(bucket, params.referenceImagePath)
    if (constructed) urls.push(constructed)
  }
  
  // Check for referenceImageId - would need to construct URL
  if (urls.length === 0 && params.referenceImageId) {
    const bucket = params.referenceImageBucket || 'generated-images'
    const mime: string | undefined = params.referenceImageMimeType
    const ext = typeof mime === 'string' && mime.includes('png') ? 'png' : 'jpg'
    const path = `references/${generation.userId}/${params.referenceImageId}.${ext}`
    const constructed = getPublicStorageUrl(bucket, path)
    if (constructed) urls.push(constructed)
  }
  
  return urls
}

interface ReferenceImageThumbnailProps {
  generation: GenerationWithOutputs
  onPinImage?: (url: string) => void
}

const ReferenceImageThumbnail = ({ generation, onPinImage }: ReferenceImageThumbnailProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const urls = getReferenceImageUrls(generation)
  if (urls.length === 0) return null

  const label = urls.length > 1 ? 'Reference Images:' : 'Reference Image:'
  const visibleUrls = urls.slice(0, 4)
  const remaining = urls.length - visibleUrls.length

  const handlePinClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation()
    onPinImage?.(url)
  }

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="text-xs text-muted-foreground/70 mb-1.5">{label}</div>

      {urls.length === 1 ? (
        <div 
          className="relative w-20 h-20 rounded-lg overflow-hidden border border-border/50 group/refimg"
          onMouseEnter={() => setHoveredIndex(0)}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <img src={urls[0]} alt="Reference" className="w-full h-full object-cover" loading="lazy" />
          {onPinImage && hoveredIndex === 0 && (
            <button
              onClick={(e) => handlePinClick(e, urls[0])}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center hover:bg-primary transition-colors shadow-sm"
              title="Pin to project"
            >
              <Pin className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border/50 bg-muted/10 p-0.5">
          <div className="grid grid-cols-2 grid-rows-2 gap-0.5 w-full h-full">
            {visibleUrls.map((url, index) => (
              <div
                key={`${generation.id}-ref-${index}`}
                className="relative group/refimg"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <img
                  src={url}
                  alt={`Reference ${index + 1}`}
                  className="w-full h-full object-cover rounded-[4px]"
                  loading="lazy"
                />
                {onPinImage && hoveredIndex === index && (
                  <button
                    onClick={(e) => handlePinClick(e, url)}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-primary/90 text-primary-foreground flex items-center justify-center hover:bg-primary transition-colors shadow-sm"
                    title="Pin to project"
                  >
                    <Pin className="h-2 w-2" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {remaining > 0 && (
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-md">
              +{remaining}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Video card with stable aspect ratio from output dimensions or params.
 * Uses object-contain to avoid cropping regardless of the video's actual dimensions.
 * Aspect ratio is computed upfront to prevent layout shifts on video load.
 */
interface VideoCardWithOverlayProps {
  output: any
  generation: GenerationWithOutputs
  fallbackAspectRatio: string
  isHighlighted: boolean
  onDownload: (fileUrl: string, outputId: string, fileType: string) => void
  onReuseParameters: (generation: GenerationWithOutputs) => void
  onToggleBookmark: (outputId: string, isBookmarked: boolean) => void
  onToggleApproval: (outputId: string, isApproved: boolean) => void
}

function VideoCardWithOverlay({
  output,
  generation,
  fallbackAspectRatio,
  isHighlighted,
  onDownload,
  onReuseParameters,
  onToggleBookmark,
  onToggleApproval,
}: VideoCardWithOverlayProps) {
  // Compute stable aspect ratio upfront - prefer output dimensions, then fallback
  const aspectRatio = useMemo(() => {
    // If we have stored dimensions from the output, use them (most accurate)
    if (output.width && output.height) {
      return `${output.width} / ${output.height}`
    }
    // Otherwise use the generation parameter aspect ratio
    return fallbackAspectRatio.replace(':', ' / ')
  }, [output.width, output.height, fallbackAspectRatio])
  
  return (
    <div
      className={`group relative bg-muted rounded-xl overflow-hidden border hover:border-primary/50 hover:shadow-lg transition-all duration-200 ${
        isHighlighted
          ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse'
          : 'border-border/50'
      }`}
      style={{ aspectRatio }}
    >
      <video
        src={output.fileUrl}
        className="w-full h-full object-contain"
        controls
        preload="metadata"
      />

      {/* Hover Overlay with Actions (no convert-to-video button in video view) */}
      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
        {/* Top Left - Download + Reuse */}
        <div className="absolute top-2 left-2 pointer-events-auto flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDownload(output.fileUrl, output.id, output.fileType)
            }}
            className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
            title="Download"
          >
            <Download className="h-3.5 w-3.5 text-white" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onReuseParameters(generation)
            }}
            className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
            title="Reuse"
          >
            <RotateCcw className="h-3.5 w-3.5 text-white" />
          </button>
        </div>
        
        {/* Top Right - Bookmark + Approval */}
        <div className="absolute top-2 right-2 pointer-events-auto flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleBookmark(output.id, (output as any).isBookmarked || false)
            }}
            className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
            title={(output as any).isBookmarked ? 'Remove bookmark' : 'Bookmark'}
          >
            <Bookmark className={`h-3.5 w-3.5 text-white ${(output as any).isBookmarked ? 'fill-white' : ''}`} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleApproval(output.id, (output as any).isApproved || false)
            }}
            className={`p-1.5 backdrop-blur-sm rounded-lg transition-colors ${
              (output as any).isApproved
                ? 'bg-green-500/90 hover:bg-green-600/90'
                : 'bg-white/20 hover:bg-white/30'
            }`}
            title={(output as any).isApproved ? 'Approved for review' : 'Approve for review'}
          >
            <Check className={`h-3.5 w-3.5 ${(output as any).isApproved ? 'text-white' : 'text-white'}`} />
          </button>
        </div>
      </div>
    </div>
  )
}

interface GenerationGalleryProps {
  /**
   * All generations to display in a single unified list.
   * Status transitions (processing → completed) happen in-place without moving items.
   */
  generations: GenerationWithOutputs[]
  sessionId: string | null
  /** Project ID for the current session - needed for ImageToVideoOverlay */
  projectId: string
  onReuseParameters: (generation: GenerationWithOutputs) => void
  /**
   * Callback to directly rerun a generation with the same parameters.
   * Unlike onReuseParameters, this triggers generation immediately without filling the prompt bar.
   */
  onRerunGeneration?: (generation: GenerationWithOutputs) => void
  videoSessions?: Session[]
  onConvertToVideo?: (generation: GenerationWithOutputs, videoSessionId: string, imageUrl?: string) => void
  onCreateVideoSession?: ((type: 'image' | 'video', name: string, options?: { skipSwitch?: boolean }) => Promise<Session | null>) | undefined
  currentGenerationType?: 'image' | 'video'
  currentUser?: { displayName: string | null } | null
  /**
   * Callback to dismiss/remove a stuck generation from the UI cache.
   * Used when a generation is stuck and doesn't exist in the database.
   */
  onDismissGeneration?: (generationId: string, clientId?: string) => void
  /**
   * Reference to the scroll container element for virtualization.
   * Required for TanStack Virtual to work correctly.
   */
  scrollContainerRef?: React.RefObject<HTMLDivElement>
  /**
   * Callback to use a generated image as a reference in the prompt bar.
   */
  onUseAsReference?: (imageUrl: string) => void
  /**
   * Deep-link: output ID to scroll to (one-time scroll action).
   */
  scrollToOutputId?: string | null
  /**
   * Deep-link: output ID to highlight (visual highlight effect).
   */
  highlightOutputId?: string | null
  /**
   * Callback when scroll-to-output action is complete.
   */
  onScrollToOutputComplete?: () => void
}

export function GenerationGallery({
  generations,
  sessionId,
  projectId,
  onReuseParameters,
  onRerunGeneration,
  videoSessions = [],
  onConvertToVideo,
  onCreateVideoSession,
  currentGenerationType = 'image',
  currentUser,
  onDismissGeneration,
  scrollContainerRef,
  onUseAsReference,
  scrollToOutputId,
  highlightOutputId,
  onScrollToOutputComplete,
}: GenerationGalleryProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const updateOutputMutation = useUpdateOutputMutation()
  const { pinImage, isPinning } = usePinnedImages(projectId)
  // Use cached models data from React Query (prefetched on server)
  const { data: allModels = [] } = useModels()
  
  const handlePinImage = useCallback((imageUrl: string) => {
    pinImage({ imageUrl })
    toast({
      title: 'Image pinned',
      description: 'Reference image added to project pins',
    })
  }, [pinImage, toast])
  const [lightboxData, setLightboxData] = useState<{
    imageUrl: string
    output: any
    generation: GenerationWithOutputs
  } | null>(null)
  // Image-to-video overlay state (replaces VideoSessionSelector)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [overlayOutputId, setOverlayOutputId] = useState<string | null>(null)
  const [overlayImageUrl, setOverlayImageUrl] = useState<string | null>(null)

  // CRITICAL: Use a ref to hold generations so getItemKey can be stable (no dependencies).
  // Without this, every data refetch creates a new getItemKey function, causing the 
  // virtualizer to recalculate measurements and potentially flicker.
  const generationsRef = useRef(generations)
  generationsRef.current = generations

  // getItemKey must be stable (empty deps) to prevent virtualizer re-initialization.
  // We access generations via ref to avoid dependency while still getting correct keys.
  const getItemKey = useCallback(
    (index: number) => {
      const gen = generationsRef.current[index]
      return gen?.clientId || gen?.id || String(index)
    },
    [] // Stable - no dependencies, uses ref for data access
  )

  // Virtualizer for efficient rendering of large lists
  // Smart row height estimator based on generation parameters to reduce layout shift
  const estimateRowHeight = useCallback((index: number): number => {
    const gen = generationsRef.current[index]
    if (!gen) return 600 // fallback
    
    // Layout constants
    const LEFT_PANEL_WIDTH = 384 // w-96
    const GAP = 24 // gap-6
    const BOTTOM_PADDING = 48 // pb-12
    const MIN_PANEL_HEIGHT = 320
    const GRID_GAP = 16 // gap-4
    
    // Get container width (approximate if not available)
    const containerWidth = scrollContainerRef?.current?.clientWidth || 1200
    // Subtract left panel, gap, and some margin for the max-w-5xl constraint
    const rightSideWidth = Math.min(containerWidth - LEFT_PANEL_WIDTH - GAP - 48, 1280) // max-w-5xl ≈ 1280px
    
    const params = gen.parameters as any
    const aspectRatioStr = params?.aspectRatio || '1:1'
    const [w, h] = aspectRatioStr.split(':').map(Number)
    const aspectRatio = w && h ? w / h : 1
    
    const isVideo = allModels.find(m => m.id === gen.modelId)?.type === 'video'
    const numOutputs = gen.outputs?.length || (params?.numOutputs || (isVideo ? 1 : 4))
    
    let rightSideHeight: number
    
    if (isVideo) {
      // Videos: single column, one card
      const cardWidth = Math.min(rightSideWidth, 640) // max-w-2xl
      const cardHeight = cardWidth / aspectRatio
      rightSideHeight = cardHeight
    } else {
      // Images: 2-column grid
      const cardWidth = (rightSideWidth - GRID_GAP) / 2
      const cardHeight = cardWidth / aspectRatio
      const rows = Math.ceil(numOutputs / 2)
      rightSideHeight = rows * cardHeight + (rows - 1) * GRID_GAP
    }
    
    // Row height = max of left panel min-height and right side height, plus bottom padding
    const rowHeight = Math.max(MIN_PANEL_HEIGHT, rightSideHeight) + BOTTOM_PADDING
    
    // Add some buffer for safety
    return Math.round(rowHeight + 24)
  }, [allModels])
  
  const virtualizer = useVirtualizer({
    count: generations.length,
    getScrollElement: () => scrollContainerRef?.current ?? null,
    getItemKey,
    estimateSize: estimateRowHeight,
    overscan: 5, // Render 5 extra items above/below viewport for smooth scrolling
  })

  // Deep-link scroll-to-output: scroll to the generation containing the target output
  useEffect(() => {
    if (!scrollToOutputId || generations.length === 0) return
    
    // Find the generation index containing the target output
    const generationIndex = generations.findIndex((gen) =>
      gen.outputs?.some((output) => output.id === scrollToOutputId)
    )
    
    if (generationIndex === -1) return
    
    // Use virtualizer if available, otherwise fall back to scrollIntoView
    const useVirtualization = !!scrollContainerRef?.current && generations.length > 10
    
    if (useVirtualization) {
      // Small delay to ensure virtualizer has measured items
      setTimeout(() => {
        virtualizer.scrollToIndex(generationIndex, { align: 'center', behavior: 'smooth' })
        onScrollToOutputComplete?.()
      }, 100)
    } else {
      // For non-virtualized: find the DOM element by data-index attribute
      setTimeout(() => {
        const element = document.querySelector(`[data-index="${generationIndex}"]`)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        onScrollToOutputComplete?.()
      }, 100)
    }
  }, [scrollToOutputId, generations, virtualizer, scrollContainerRef, onScrollToOutputComplete])

  // Convert aspect ratio string to CSS aspect-ratio value
  const getAspectRatioStyle = (aspectRatio?: string) => {
    if (!aspectRatio) return '1 / 1'
    return aspectRatio.replace(':', ' / ')
  }

  const handleCopyPrompt = async (prompt: string) => {
    try {
      await navigator.clipboard.writeText(prompt)
      toast({
        title: "Copied",
        description: "Prompt copied to clipboard",
        variant: "default",
      })
    } catch (error) {
      console.error('Failed to copy:', error)
      toast({
        title: "Copy failed",
        description: "Failed to copy prompt to clipboard",
        variant: "destructive",
      })
    }
  }

  const handleDownload = async (fileUrl: string, outputId: string, fileType: string = 'image') => {
    try {
      const response = await fetch(fileUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const extension = fileType === 'video' ? 'mp4' : 'png'
      link.download = `generation-${outputId}.${extension}`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      // Log download event for semantic analysis (fire-and-forget)
      fetch(`/api/outputs/${outputId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventType: 'download',
          metadata: { fileType },
        }),
      }).catch((err) => {
        // Silent fail - don't interrupt the download experience
        console.debug('Failed to log download event:', err)
      })
    } catch (error) {
      console.error('Download failed:', error)
      toast({
        title: "Download failed",
        description: `Failed to download ${fileType}`,
        variant: "destructive",
      })
    }
  }

  const handleToggleApproval = async (outputId: string, currentApproved: boolean) => {
    if (!sessionId) return
    
    try {
      await updateOutputMutation.mutateAsync({
        outputId,
        sessionId,
        isApproved: !currentApproved,
      })
      
      // Invalidate approved outputs query so review tab updates
      queryClient.invalidateQueries({ queryKey: ['approvedOutputs'] })
      
      toast({
        title: currentApproved ? "Approval removed" : "Approved",
        description: currentApproved ? "Image unapproved" : "Image approved for review",
        variant: "default",
      })
    } catch (error) {
      console.error('Error toggling approval:', error)
      toast({
        title: "Error",
        description: "Failed to update approval status",
        variant: "destructive",
      })
    }
  }

  const handleCancelGeneration = async (generationId: string) => {
    if (!sessionId) return
    
    try {
      const response = await fetch(`/api/generations/${generationId}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) throw new Error('Failed to cancel generation')
      
      toast({
        title: "Generation cancelled",
        description: "The generation has been stopped",
        variant: "default",
      })
      
      // Invalidate queries to refetch
      queryClient.invalidateQueries({ queryKey: ['generations', sessionId] })
    } catch (error) {
      console.error('Error cancelling generation:', error)
      toast({
        title: "Error",
        description: "Failed to cancel generation",
        variant: "destructive",
      })
    }
  }

  const handleToggleBookmark = async (outputId: string, isBookmarked: boolean) => {
    if (!sessionId) return
    
    // Optimistic update: immediately update local cache for instant UI feedback
    const newBookmarkState = !isBookmarked
    queryClient.setQueryData(
      ['generations', 'infinite', sessionId],
      (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            data: page.data.map((gen: any) => ({
              ...gen,
              outputs: gen.outputs?.map((output: any) =>
                output.id === outputId
                  ? { ...output, isBookmarked: newBookmarkState }
                  : output
              ),
            })),
          })),
        }
      }
    )
    
    // Also update lightbox state if it's showing this output
    if (lightboxData?.output?.id === outputId) {
      setLightboxData(prev => prev ? {
        ...prev,
        output: { ...prev.output, isBookmarked: newBookmarkState }
      } : null)
    }
    
    try {
      const method = isBookmarked ? 'DELETE' : 'POST'
      
      const response = await fetch('/api/bookmarks', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputId }),
      })

      if (!response.ok) throw new Error('Failed to toggle bookmark')
      
      toast({
        title: isBookmarked ? "Bookmark removed" : "Bookmarked",
        description: isBookmarked ? "Removed from bookmarks" : "Added to bookmarks",
        variant: "default",
      })

      // Invalidate generations query to refetch with updated bookmark status
      queryClient.invalidateQueries({ queryKey: ['generations', sessionId] })
    } catch (error) {
      console.error('Error toggling bookmark:', error)
      // Revert optimistic update on error
      queryClient.setQueryData(
        ['generations', 'infinite', sessionId],
        (old: any) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              data: page.data.map((gen: any) => ({
                ...gen,
                outputs: gen.outputs?.map((output: any) =>
                  output.id === outputId
                    ? { ...output, isBookmarked: isBookmarked } // Revert to original state
                    : output
                ),
              })),
            })),
          }
        }
      )
      // Also revert lightbox state if needed
      if (lightboxData?.output?.id === outputId) {
        setLightboxData(prev => prev ? {
          ...prev,
          output: { ...prev.output, isBookmarked: isBookmarked }
        } : null)
      }
      toast({
        title: "Error",
        description: "Failed to update bookmark status",
        variant: "destructive",
      })
    }
  }

  const handleDeleteGeneration = async (generationId: string) => {
    if (!sessionId) return
    
    // Mark as dismissed FIRST so it won't reappear from realtime or refetch
    markGenerationDismissed(sessionId, generationId)
    
    // Also remove from cache immediately for instant feedback
    queryClient.setQueryData(
      ['generations', 'infinite', sessionId],
      (old: any) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            data: page.data.filter((gen: any) => gen.id !== generationId),
          })),
        }
      }
    )
    
    try {
      const response = await fetch(`/api/generations/${generationId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete generation')
      }
      
      toast({
        title: "Generation removed",
        description: "The generation has been deleted",
        variant: "default",
      })
      
      // Note: We don't need to invalidate since we already removed from cache
      // and marked as dismissed to prevent reappearance
    } catch (error: any) {
      console.error('Error deleting generation:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to delete generation",
        variant: "destructive",
      })
      // Note: Even on error, we keep it dismissed to prevent flicker
      // The user can refresh if they want to see it again
    }
  }

  // Open the image-to-video overlay for a specific output
  const handleVideoConversion = (outputId: string, imageUrl: string) => {
    setOverlayOutputId(outputId)
    setOverlayImageUrl(imageUrl)
    setOverlayOpen(true)
  }

  const handleOverlayClose = () => {
    setOverlayOpen(false)
    setOverlayOutputId(null)
    setOverlayImageUrl(null)
  }


  if (generations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-lg mb-2">No generations yet</p>
          <p className="text-sm">Enter a prompt below to generate your first image or video</p>
        </div>
      </div>
    )
  }

  // Check if this is a video generation
  const isVideoGeneration = (gen: GenerationWithOutputs) => {
    return gen.outputs?.some(output => output.fileType === 'video') ?? false
  }
  
  // Get stable key for React - prefer clientId, fallback to id
  const getStableKey = (gen: GenerationWithOutputs) => gen.clientId || gen.id

  // If no scroll container ref provided, fall back to non-virtualized rendering
  const useVirtualization = !!scrollContainerRef?.current && generations.length > 10

  return (
    <>
      <div 
        className="pb-4"
        style={useVirtualization ? {
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        } : undefined}
      >
        {/* Single unified list - status transitions happen in-place */}
        {(useVirtualization ? virtualizer.getVirtualItems() : generations.map((_, i) => ({ index: i, start: 0, size: 0 }))).map((virtualRow) => {
          const generation = generations[virtualRow.index]
          if (!generation) return null
          
          const isVideo = isVideoGeneration(generation)
          const stableKey = getStableKey(generation)
          
          // Wrapper for virtualized positioning
          // Spacing is handled by pb-12 (48px) on the row element, which is measured by virtualizer
          const rowStyle = useVirtualization ? {
            position: 'absolute' as const,
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
            marginBottom: 0, // Spacing handled by pb-12 padding
          } : undefined
          
          // Cancelled generation layout
          if (generation.status === 'cancelled') {
            return (
              <div 
                key={stableKey} 
                ref={useVirtualization ? virtualizer.measureElement : undefined}
                data-index={virtualRow.index}
                style={rowStyle}
                className="pb-12"
              >
                <div className="flex gap-6 items-start">
                  {/* Left Side: Prompt Display with Cancelled State */}
                  <div className="w-96 flex-shrink-0 bg-prompt-card rounded-xl p-6 border border-destructive/50 flex flex-col relative" style={{ minHeight: '320px' }}>
                  <div className="absolute top-2 left-2 px-2 py-1 bg-destructive/20 text-destructive text-xs font-medium rounded z-10">
                    Cancelled
                  </div>
                  <div className="flex-1 overflow-hidden hover:overflow-y-auto transition-all group relative mt-6">
                    <p 
                      className="text-base font-normal leading-relaxed text-foreground/90 cursor-pointer hover:text-primary transition-colors"
                      onClick={() => handleCopyPrompt(generation.prompt)}
                      title="Click to copy"
                    >
                      {generation.prompt}
                    </p>
                    <Copy className="h-3.5 w-3.5 absolute top-0 right-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground mt-4">
                    <div className="flex items-center gap-2 text-destructive/80">
                      <Info className="h-3.5 w-3.5" />
                      <span className="font-medium">Cancelled</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground/70">Model:</span>
                      <span className="font-medium">{(generation.modelId || 'unknown').replace('gemini-', '').replace('fal-', '')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground/70">Generated:</span>
                      <span className="font-medium">{formatDate(generation.createdAt)}</span>
                    </div>
                  </div>
                </div>
                {/* Right Side: Empty/Cancelled State */}
                <div className="flex-1 max-w-5xl flex items-center justify-center" style={{ minHeight: '320px' }}>
                  <div className="bg-muted/20 rounded-xl p-8 border border-destructive/30 text-center">
                    <p className="text-sm text-muted-foreground mb-4">Generation was cancelled</p>
                    {generation.isOwner !== false && (
                      <button
                        onClick={() => handleDeleteGeneration(generation.id)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-muted-foreground rounded-lg transition-colors text-sm font-medium"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
              </div>
            )
          }
          
          // Processing generation layout
          if (generation.status === 'processing') {
            const modelConfig = allModels.find(m => m.id === generation.modelId)
            const modelName = modelConfig?.name || 'Unknown Model'
            const numOutputs = (generation.parameters as any)?.numOutputs || 1
            
            const isVideoModel = modelConfig?.type === 'video'
            const params = (generation.parameters as any) || {}

            // Heartbeat is written by the background processor every ~10s while the model call is active.
            // Use it to distinguish "slow but alive" vs "likely stuck".
            const now = Date.now()
            const createdAtMs = new Date(generation.createdAt).getTime()
            const ageMinutes = (now - createdAtMs) / (60 * 1000)
            const lastHeartbeatAtRaw = params?.lastHeartbeatAt
            const lastHeartbeatAtMs =
              typeof lastHeartbeatAtRaw === 'string' ? new Date(lastHeartbeatAtRaw).getTime() : null
            const heartbeatAgeMinutes =
              typeof lastHeartbeatAtMs === 'number' && Number.isFinite(lastHeartbeatAtMs)
                ? (now - lastHeartbeatAtMs) / (60 * 1000)
                : null

            const longThresholdMinutes = isVideoModel ? 2 : 1
            const stuckThresholdMinutes = isVideoModel ? 12 : 5
            const heartbeatStaleMinutes = isVideoModel ? 3 : 2

            const isTakingLong = ageMinutes > longThresholdMinutes
            const isHeartbeatStale =
              heartbeatAgeMinutes === null ? ageMinutes > (isVideoModel ? 4 : 2) : heartbeatAgeMinutes > heartbeatStaleMinutes
            const isLikelyStuck = ageMinutes > stuckThresholdMinutes && isHeartbeatStale
            
            return (
              <div 
                key={stableKey} 
                ref={useVirtualization ? virtualizer.measureElement : undefined}
                data-index={virtualRow.index}
                style={rowStyle}
                className="pb-12"
              >
                <div className="flex gap-6 items-start">
                  {/* Left Side: Prompt and metadata with Rerun below */}
                  <div className="w-96 flex-shrink-0 flex flex-col">
                    <div className={`bg-prompt-card rounded-xl p-6 border flex flex-col relative group ${
                      isLikelyStuck
                        ? 'border-destructive/50 border-destructive'
                        : isTakingLong
                        ? 'border-amber-500/50 border-amber-500/30'
                        : 'border-border/50 border-primary/30'
                    }`} style={{ minHeight: '320px' }}>
                      {/* Cancel button - top left, only visible on hover when processing (owner only) */}
                      {generation.isOwner !== false && (
                        <button
                          onClick={() => handleCancelGeneration(generation.id)}
                          className="absolute top-2 left-2 p-1.5 bg-destructive/90 hover:bg-destructive rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          title="Cancel generation"
                        >
                          <X className="h-4 w-4 text-white" />
                        </button>
                      )}
                      
                      {/* Status badge (only when taking longer than usual) */}
                      {isTakingLong && (
                        <div
                          className={`absolute top-2 left-10 px-2 py-1 text-xs font-medium rounded z-10 ${
                            isLikelyStuck
                              ? 'bg-destructive/20 text-destructive'
                              : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {isLikelyStuck ? 'Delayed' : 'Processing'} ({Math.round(ageMinutes)}min)
                        </div>
                      )}
                      
                      <div className="flex-1 mb-4 overflow-hidden hover:overflow-y-auto transition-all group relative mt-6" style={{ maxHeight: '200px' }}>
                        <p className="text-base font-normal leading-relaxed text-foreground/90">
                          {generation.prompt}
                        </p>
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {currentUser?.displayName && (
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="flex-shrink-0"
                            >
                              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span className="font-medium">{currentUser.displayName}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Wand2 className="h-3.5 w-3.5 text-primary" />
                          <span className="font-medium">{modelName}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/70">Generated:</span>
                          <span className="font-medium">{formatDate(generation.createdAt)}</span>
                        </div>
                        
                        {/* Reference Image Thumbnail - shown during processing too */}
                        <ReferenceImageThumbnail generation={generation} onPinImage={handlePinImage} />
                      </div>
                    </div>
                    
                    {/* Rerun button - outside panel, bottom right */}
                    {onRerunGeneration && generation.isOwner !== false && (
                      <button
                        onClick={() => onRerunGeneration(generation)}
                        className="text-xs text-muted-foreground/50 hover:text-primary transition-colors self-end mt-1"
                      >
                        Rerun
                      </button>
                    )}
                  </div>

                {/* Right Side: Progress placeholders or stuck message */}
                {isLikelyStuck ? (
                  <div className="flex-1 max-w-5xl">
                    <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/50">
                      <h3 className="text-lg font-semibold text-destructive mb-2">Taking unusually long</h3>
                      <p className="text-sm text-foreground/80 mb-4">
                        This generation has been processing for {Math.round(ageMinutes)} minutes without recent progress.
                        It may still complete, but you can retry or dismiss it if needed.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onReuseParameters(generation)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Try Again
                        </button>
                        {onDismissGeneration && (
                          <button
                            onClick={() => onDismissGeneration(generation.id, generation.clientId)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors text-sm font-medium"
                          >
                            <X className="h-4 w-4" />
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 grid grid-cols-2 gap-4 max-w-5xl">
                    {Array.from({ length: numOutputs }).map((_, idx) => {
                      // Calculate estimated time based on model type and parameters
                      const getEstimatedTime = (): number => {
                        if (isVideoModel) {
                          // Video generation takes longer
                          const duration = params?.duration || 5
                          const resolution = params?.resolution || 720
                          // Base estimate: ~60-120s for videos, scaled by duration and resolution
                          let estimate = 90
                          if (duration >= 8) estimate += 30
                          if (resolution >= 1080) estimate += 30
                          if (resolution >= 2160) estimate += 60 // 4K takes even longer
                          return estimate
                        }
                        // Image generation
                        const resolution = params?.resolution || 1024
                        // Base estimate: ~20-40s for images, scaled by resolution
                        let estimate = 25
                        if (resolution >= 2048) estimate += 10
                        if (resolution >= 4096) estimate += 20
                        return estimate
                      }
                      
                      // Get the start time: prefer processingStartedAt, fall back to createdAt
                      const startedAt = typeof params?.processingStartedAt === 'number'
                        ? params.processingStartedAt
                        : createdAtMs
                      
                      return (
                        <GenerationProgress 
                          key={`${stableKey}-progress-${idx}`}
                          estimatedTime={getEstimatedTime()}
                          aspectRatio={params?.aspectRatio}
                          isVideo={isVideoModel}
                          startedAt={startedAt}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
              </div>
            )
          }
          
          // Failed generation layout
          if (generation.status === 'failed') {
            const errorMessage = (generation.parameters as any)?.error || 'Generation failed'
            return (
              <div 
                key={stableKey} 
                ref={useVirtualization ? virtualizer.measureElement : undefined}
                data-index={virtualRow.index}
                style={rowStyle}
                className="pb-12"
              >
                <div className="flex gap-6 items-start">
                  {/* Left Side: Prompt Display with Error State */}
                  <div className="w-96 flex-shrink-0 bg-destructive/10 rounded-xl p-6 border border-destructive/50 flex flex-col" style={{ minHeight: '320px' }}>
                  <div className="flex-1 overflow-hidden hover:overflow-y-auto transition-all group relative" style={{ maxHeight: '200px' }}>
                    <p 
                      className="text-base font-normal leading-relaxed text-foreground/90 cursor-pointer hover:text-primary transition-colors"
                      onClick={() => handleCopyPrompt(generation.prompt)}
                      title="Click to copy"
                    >
                      {generation.prompt}
                    </p>
                    <Copy className="h-3.5 w-3.5 absolute top-0 right-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="space-y-2 text-xs text-muted-foreground mt-4">
                    <div className="flex items-center gap-2 text-destructive">
                      <Info className="h-3.5 w-3.5" />
                      <span className="font-medium">Failed</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground/70">Model:</span>
                      <span className="font-medium">{(generation.modelId || 'unknown').replace('gemini-', '').replace('fal-', '')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground/70">Generated:</span>
                      <span className="font-medium">{formatDate(generation.createdAt)}</span>
                    </div>
                    
                    {/* Reference Image Thumbnail */}
                    <ReferenceImageThumbnail generation={generation} onPinImage={handlePinImage} />
                  </div>
                </div>

                {/* Right Side: Error Message */}
                <div className="flex-1 max-w-5xl flex items-center">
                  <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/50 w-full">
                    <h3 className="text-lg font-semibold text-destructive mb-2">Generation Failed</h3>
                    <p className="text-sm text-foreground/80 mb-4">{errorMessage}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => onReuseParameters(generation)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
                      >
                        <RotateCcw className="h-4 w-4" />
                        Try Again
                      </button>
                      {generation.isOwner !== false && (
                        <button
                          onClick={() => handleDeleteGeneration(generation.id)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 text-muted-foreground rounded-lg transition-colors text-sm font-medium"
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              </div>
            )
          }
          
          // Video layout: mirror image layout → prompt on the left, video on the right
          if (isVideo) {
            return (
              <div 
                key={stableKey} 
                ref={useVirtualization ? virtualizer.measureElement : undefined}
                data-index={virtualRow.index}
                style={rowStyle}
                className="pb-12"
              >
                <div className="flex gap-6 items-start">
                  {/* Left Side: Prompt Display with Rerun below */}
                  <div className="w-96 flex-shrink-0 flex flex-col">
                    <div className="bg-prompt-card rounded-xl p-6 border border-border flex flex-col" style={{ minHeight: '320px' }}>
                      <div className="flex-1 overflow-hidden hover:overflow-y-auto transition-all group relative" style={{ maxHeight: '200px' }}>
                        <p 
                          className="text-base font-normal leading-relaxed text-foreground/90 cursor-pointer hover:text-primary transition-colors"
                          onClick={() => handleCopyPrompt(generation.prompt)}
                          title="Click to copy"
                        >
                          {generation.prompt}
                        </p>
                        <Copy className="h-3.5 w-3.5 absolute top-0 right-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground mt-4">
                        {generation.user && (
                          <div className="flex items-center gap-2">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="flex-shrink-0"
                            >
                              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span className="font-medium">{generation.user.displayName}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Info className="h-3.5 w-3.5" />
                          {(() => {
                            const { name, provider, isFallback } = formatModelWithProvider(generation)
                            return (
                              <span className="font-medium">
                                {name}
                                {provider && (
                                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${
                                    isFallback 
                                      ? 'bg-amber-500/20 text-amber-500' 
                                      : provider === 'Google' 
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-purple-500/20 text-purple-400'
                                  }`}>
                                    {provider}{isFallback ? ' (fallback)' : ''}
                                  </span>
                                )}
                              </span>
                            )
                          })()}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/70">Generated:</span>
                          <span className="font-medium">{formatDate(generation.createdAt)}</span>
                        </div>
                        
                        {/* Reference Image Thumbnail */}
                        <ReferenceImageThumbnail generation={generation} onPinImage={handlePinImage} />
                      </div>
                    </div>
                    
                    {/* Rerun button - outside panel, bottom right */}
                    {onRerunGeneration && generation.isOwner !== false && (
                      <button
                        onClick={() => onRerunGeneration(generation)}
                        className="text-xs text-muted-foreground/50 hover:text-primary transition-colors self-end mt-1"
                      >
                        Rerun
                      </button>
                    )}
                  </div>

                {/* Right Side: Single video container */}
                <div className="flex-1 grid grid-cols-1 gap-3 max-w-2xl">
                  {generation.outputs && generation.outputs.length > 0 ? (
                    generation.outputs.map((output) => {
                      const fallbackAspectRatio = (generation.parameters as any)?.aspectRatio || '16:9'
                      return (
                        <VideoCardWithOverlay
                          key={output.id}
                          output={output}
                          generation={generation}
                          fallbackAspectRatio={fallbackAspectRatio}
                          isHighlighted={highlightOutputId === output.id}
                          onDownload={handleDownload}
                          onReuseParameters={onReuseParameters}
                          onToggleBookmark={handleToggleBookmark}
                          onToggleApproval={handleToggleApproval}
                        />
                      )
                    })
                  ) : (
                    // Fallback: Show error message if video generation has no outputs
                    <div className="flex-1 max-w-2xl">
                      <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/50">
                        <h3 className="text-lg font-semibold text-destructive mb-2">No Video Generated</h3>
                        <p className="text-sm text-foreground/80 mb-4">
                          This video generation completed but produced no outputs. This may indicate a failure during processing.
                        </p>
                        <button
                          onClick={() => onReuseParameters(generation)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Try Again
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              </div>
            )
          }

          // Image layout: Original layout with prompt on left (completed status)
          return (
            <div 
              key={stableKey} 
              ref={useVirtualization ? virtualizer.measureElement : undefined}
              data-index={virtualRow.index}
              style={rowStyle}
              className="pb-12"
            >
              <div className="flex gap-6 items-start">
                {/* Left Side: Prompt Display with Rerun below */}
                <div className="w-96 flex-shrink-0 flex flex-col">
                  <div className="bg-prompt-card rounded-xl p-6 border border-border flex flex-col" style={{ minHeight: '320px' }}>
                    <div className="flex-1 overflow-hidden hover:overflow-y-auto transition-all group relative" style={{ maxHeight: '200px' }}>
                      <p 
                        className="text-base font-normal leading-relaxed text-foreground/90 cursor-pointer hover:text-primary transition-colors"
                        onClick={() => handleCopyPrompt(generation.prompt)}
                        title="Click to copy"
                      >
                        {generation.prompt}
                      </p>
                      {/* Copy icon hint */}
                      <Copy className="h-3.5 w-3.5 absolute top-0 right-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <div className="space-y-2 text-xs text-muted-foreground mt-4">
                      {generation.user && (
                        <div className="flex items-center gap-2">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="flex-shrink-0"
                          >
                            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                          <span className="font-medium">{generation.user.displayName}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Info className="h-3.5 w-3.5" />
                        {(() => {
                          const { name, provider, isFallback } = formatModelWithProvider(generation)
                          return (
                            <span className="font-medium">
                              {name}
                              {provider && (
                                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${
                                  isFallback 
                                    ? 'bg-amber-500/20 text-amber-500' 
                                    : provider === 'Google' 
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : 'bg-purple-500/20 text-purple-400'
                                }`}>
                                  {provider}{isFallback ? ' (fallback)' : ''}
                                </span>
                              )}
                            </span>
                          )
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground/70">Generated:</span>
                        <span className="font-medium">{new Date(generation.createdAt).toLocaleDateString()}</span>
                      </div>

                      {/* Reference Image Thumbnail */}
                      <ReferenceImageThumbnail generation={generation} onPinImage={handlePinImage} />
                    </div>
                  </div>
                  
                  {/* Rerun button - outside panel, bottom right */}
                  {onRerunGeneration && generation.isOwner !== false && (
                    <button
                      onClick={() => onRerunGeneration(generation)}
                      className="text-xs text-muted-foreground/50 hover:text-primary transition-colors self-end mt-1"
                    >
                      Rerun
                    </button>
                  )}
                </div>

            {/* Right Side: Outputs in 2-Column Grid */}
            <div className="flex-1 grid grid-cols-2 gap-4 max-w-5xl">
              {(generation.outputs || []).map((output) => {
                const aspectRatio = (generation.parameters as any)?.aspectRatio || '1:1'
                return (
                <div key={output.id} className="group relative overflow-visible">
                  {/* Video iterations indicator - glow effect + video button */}
                  {currentGenerationType === 'image' && (
                    <VideoIterationsStackHint 
                      outputId={output.id} 
                      onClick={() => handleVideoConversion(output.id, output.fileUrl)}
                    />
                  )}
                  
                  {/* Main image card */}
                  <div
                    className={`relative bg-muted rounded-xl overflow-hidden border group-hover:border-primary/50 group-hover:shadow-lg transition-all duration-200 ${
                      highlightOutputId === output.id
                        ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-background animate-pulse'
                        : 'border-border/50'
                    }`}
                    style={{ aspectRatio: getAspectRatioStyle(aspectRatio), zIndex: 1 }}
                  >
                    {output.fileType === 'image' && (
                      <Image
                        src={output.fileUrl}
                        alt="Generated content"
                        width={output.width || 512}
                        height={output.height || 512}
                        className="w-full h-full object-cover cursor-pointer"
                        loading="lazy"
                        // Optimize for gallery view: lower quality, responsive sizes
                        quality={75}
                        sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 400px"
                        placeholder="blur"
                        blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAhEAABAwMFAQEAAAAAAAAAAAABAgMFAAQGBxESITFRQf/EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ArMAD/9k="
                        onClick={() => setLightboxData({
                          imageUrl: output.fileUrl,
                          output: output,
                          generation: generation
                        })}
                      />
                    )}

                {/* Hover Overlay - Minimal Krea Style - pointer-events-none to allow image clicks */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                  {/* Top Left - Download */}
                  <div className="absolute top-2 left-2 pointer-events-auto flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDownload(output.fileUrl, output.id, output.fileType)
                      }}
                      className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                      title="Download"
                    >
                      <Download className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                  
                  {/* Top Right - Bookmark + Approval */}
                  <div className="absolute top-2 right-2 pointer-events-auto flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleBookmark(output.id, (output as any).isBookmarked || false)
                      }}
                      className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                      title={(output as any).isBookmarked ? 'Remove bookmark' : 'Bookmark'}
                    >
                      <Bookmark className={`h-3.5 w-3.5 text-white ${(output as any).isBookmarked ? 'fill-white' : ''}`} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleApproval(output.id, (output as any).isApproved || false)
                      }}
                      className={`p-1.5 backdrop-blur-sm rounded-lg transition-colors ${
                        (output as any).isApproved
                          ? 'bg-green-500/90 hover:bg-green-600/90'
                          : 'bg-white/20 hover:bg-white/30'
                      }`}
                      title={(output as any).isApproved ? 'Approved for review' : 'Approve for review'}
                    >
                      <Check className={`h-3.5 w-3.5 ${(output as any).isApproved ? 'text-white' : 'text-white'}`} />
                    </button>
                  </div>
                  
                  {/* Bottom Left - Reuse + Pin */}
                  <div className="absolute bottom-2 left-2 pointer-events-auto flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onReuseParameters(generation)
                      }}
                      className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                      title="Reuse parameters"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-white" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handlePinImage(output.fileUrl)
                      }}
                      className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                      title="Pin to project"
                    >
                      <Pin className="h-3.5 w-3.5 text-white" />
                    </button>
                  </div>
                  
                  {/* Bottom Right - Use as Reference (positioned left of the VideoIterationsStackHint video button) */}
                  {onUseAsReference && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onUseAsReference(output.fileUrl)
                      }}
                      className="absolute bottom-2 right-[2.5rem] pointer-events-auto transition-all hover:scale-110 opacity-0 group-hover:opacity-100 p-1.5 rounded-full bg-primary/20 hover:bg-primary/30 backdrop-blur-sm"
                      style={{ zIndex: 10 }}
                      title="Use as reference"
                    >
                      <ArrowDownRight 
                        className="h-3.5 w-3.5 text-primary"
                        style={{
                          filter: 'drop-shadow(0 0 6px hsl(var(--primary) / 0.5)) drop-shadow(0 0 10px hsl(var(--primary) / 0.25))',
                        }}
                      />
                    </button>
                  )}
                </div>

              </div>
              {/* Close wrapper for stacked iterations */}
              </div>
              )
            })}
          </div>
        </div>
          </div>
          )
        })}

      </div>

      {/* Image Lightbox */}
      <ImageLightbox
        imageUrl={lightboxData?.imageUrl || ''}
        output={lightboxData?.output || null}
        isOpen={!!lightboxData}
        onClose={() => setLightboxData(null)}
        onBookmark={handleToggleBookmark}
        onApprove={handleToggleApproval}
        onReuse={() => {
          if (lightboxData?.generation) {
            onReuseParameters(lightboxData.generation)
            setLightboxData(null)
          }
        }}
        onDownload={handleDownload}
        onPin={(imageUrl) => {
          handlePinImage(imageUrl)
          setLightboxData(null)
        }}
        onUseAsReference={onUseAsReference ? (imageUrl) => {
          onUseAsReference(imageUrl)
          setLightboxData(null)
        } : undefined}
        onConvertToVideo={
          currentGenerationType === 'image' && lightboxData
            ? () => {
                const selectedOutputId = lightboxData.output?.id
                const selectedImageUrl = lightboxData.imageUrl
                if (!selectedOutputId || !selectedImageUrl) return
                setLightboxData(null)
                handleVideoConversion(selectedOutputId, selectedImageUrl)
              }
            : undefined
        }
      />

      {/* Image-to-Video Overlay */}
      {overlayOutputId && overlayImageUrl && (
        <ImageToVideoOverlay
          isOpen={overlayOpen}
          onClose={handleOverlayClose}
          outputId={overlayOutputId}
          imageUrl={overlayImageUrl}
          projectId={projectId}
          onCreateSession={onCreateVideoSession}
        />
      )}
    </>
  )
}

