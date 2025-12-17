import { useState } from 'react'
import Image from 'next/image'
import { Download, RotateCcw, Info, Copy, Bookmark, Check, Video, Wand2, X } from 'lucide-react'
import type { GenerationWithOutputs } from '@/types/generation'
import type { Session } from '@/types/project'
import { useUpdateOutputMutation } from '@/hooks/useOutputMutations'
import { useToast } from '@/components/ui/use-toast'
import { useQueryClient } from '@tanstack/react-query'
import { GenerationProgress } from './GenerationProgress'
import { ImageLightbox } from './ImageLightbox'
import { VideoSessionSelector } from './VideoSessionSelector'
import { getAllModels } from '@/lib/models/registry'

// Safe date formatter
const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'Unknown date'
  try {
    return new Date(date).toLocaleDateString()
  } catch (error) {
    return 'Invalid date'
  }
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

const ReferenceImageThumbnail = ({ generation }: { generation: GenerationWithOutputs }) => {
  const urls = getReferenceImageUrls(generation)
  if (urls.length === 0) return null

  const label = urls.length > 1 ? 'Reference Images:' : 'Reference Image:'
  const visibleUrls = urls.slice(0, 4)
  const remaining = urls.length - visibleUrls.length

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <div className="text-xs text-muted-foreground/70 mb-1.5">{label}</div>

      {urls.length === 1 ? (
        <div className="w-20 h-20 rounded-lg overflow-hidden border border-border/50">
          <img src={urls[0]} alt="Reference" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-border/50 bg-muted/10 p-0.5">
          <div className="grid grid-cols-2 grid-rows-2 gap-0.5 w-full h-full">
            {visibleUrls.map((url, index) => (
              <img
                key={`${generation.id}-ref-${index}`}
                src={url}
                alt={`Reference ${index + 1}`}
                className="w-full h-full object-cover rounded-[4px]"
              />
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

interface GenerationGalleryProps {
  /**
   * All generations to display in a single unified list.
   * Status transitions (processing → completed) happen in-place without moving items.
   */
  generations: GenerationWithOutputs[]
  sessionId: string | null
  onReuseParameters: (generation: GenerationWithOutputs) => void
  videoSessions?: Session[]
  onConvertToVideo?: (generation: GenerationWithOutputs, videoSessionId: string, imageUrl?: string) => void
  onCreateVideoSession?: ((type: 'image' | 'video', name: string) => Promise<Session | null>) | undefined
  currentGenerationType?: 'image' | 'video'
  currentUser?: { displayName: string | null } | null
  /**
   * Callback to dismiss/remove a stuck generation from the UI cache.
   * Used when a generation is stuck and doesn't exist in the database.
   */
  onDismissGeneration?: (generationId: string, clientId?: string) => void
}

export function GenerationGallery({
  generations,
  sessionId,
  onReuseParameters,
  videoSessions = [],
  onConvertToVideo,
  onCreateVideoSession,
  currentGenerationType = 'image',
  currentUser,
  onDismissGeneration,
}: GenerationGalleryProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const updateOutputMutation = useUpdateOutputMutation()
  const [lightboxData, setLightboxData] = useState<{
    imageUrl: string
    output: any
    generation: GenerationWithOutputs
  } | null>(null)
  const [videoSelectorOpen, setVideoSelectorOpen] = useState(false)
  const [selectedGeneration, setSelectedGeneration] = useState<GenerationWithOutputs | null>(null)
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null)

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
      toast({
        title: "Error",
        description: "Failed to update bookmark status",
        variant: "destructive",
      })
    }
  }

  const handleVideoConversion = (generation: GenerationWithOutputs, imageUrl: string) => {
    setSelectedGeneration(generation)
    setSelectedImageUrl(imageUrl)
    setVideoSelectorOpen(true)
  }

  const handleSelectVideoSession = async (videoSessionId: string) => {
    if (selectedGeneration && onConvertToVideo) {
      onConvertToVideo(selectedGeneration, videoSessionId, selectedImageUrl || undefined)
    }
  }

  const handleCreateVideoSession = async (sessionName: string) => {
    if (selectedGeneration && onCreateVideoSession) {
      const newSession = await onCreateVideoSession('video', sessionName)
      if (newSession && onConvertToVideo) {
        onConvertToVideo(selectedGeneration, newSession.id, selectedImageUrl || undefined)
      }
    }
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

  return (
    <>
      <div className="space-y-6 pb-4">
        {/* Single unified list - status transitions happen in-place */}
        {generations.map((generation) => {
          const isVideo = isVideoGeneration(generation)
          const stableKey = getStableKey(generation)
          
          // Cancelled generation layout
          if (generation.status === 'cancelled') {
            return (
              <div key={stableKey} className="flex gap-6 items-start">
                {/* Left Side: Prompt Display with Cancelled State */}
                <div className="w-96 flex-shrink-0 bg-muted/30 rounded-xl p-6 border border-destructive/50 flex flex-col relative" style={{ minHeight: '256px' }}>
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
                <div className="flex-1 max-w-2xl flex items-center justify-center">
                  <div className="bg-muted/20 rounded-xl p-8 border border-destructive/30 text-center">
                    <p className="text-sm text-muted-foreground">Generation was cancelled</p>
                  </div>
                </div>
              </div>
            )
          }
          
          // Processing generation layout
          if (generation.status === 'processing') {
            const allModels = getAllModels()
            const modelConfig = allModels.find(m => m.id === generation.modelId)
            const modelName = modelConfig?.name || 'Unknown Model'
            const numOutputs = (generation.parameters as any)?.numOutputs || 1
            
            // Check if generation is stuck (> 2 minutes old)
            const now = Date.now()
            const createdAt = new Date(generation.createdAt).getTime()
            const ageMinutes = (now - createdAt) / (60 * 1000)
            const isStuck = ageMinutes > 2
            
            return (
              <div key={stableKey} className="flex gap-6 items-start">
                {/* Left Side: Prompt and metadata */}
                <div className={`w-96 flex-shrink-0 bg-muted/30 rounded-xl p-6 border flex flex-col relative group ${
                  isStuck
                    ? 'border-destructive/50 border-destructive'
                    : 'border-border/50 border-primary/30'
                }`} style={{ minHeight: '320px' }}>
                  {/* Cancel button - top left, only visible on hover when processing */}
                  <button
                    onClick={() => handleCancelGeneration(generation.id)}
                    className="absolute top-2 left-2 p-1.5 bg-destructive/90 hover:bg-destructive rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    title="Cancel generation"
                  >
                    <X className="h-4 w-4 text-white" />
                  </button>
                  
                  {/* Stuck badge */}
                  {isStuck && (
                    <div className="absolute top-2 left-10 px-2 py-1 bg-destructive/20 text-destructive text-xs font-medium rounded z-10">
                      ⚠️ Stuck ({Math.round(ageMinutes)}min)
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
                  </div>
                </div>

                {/* Right Side: Progress placeholders or stuck message */}
                {isStuck ? (
                  <div className="flex-1 max-w-2xl">
                    <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/50">
                      <h3 className="text-lg font-semibold text-destructive mb-2">Generation Stuck</h3>
                      <p className="text-sm text-foreground/80 mb-4">
                        This generation has been processing for {Math.round(ageMinutes)} minutes and appears to be stuck. 
                        The cleanup process will mark it as failed shortly.
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
                  <div className="flex-1 grid grid-cols-2 gap-3 max-w-2xl">
                    {Array.from({ length: numOutputs }).map((_, idx) => (
                      <GenerationProgress 
                        key={`${stableKey}-progress-${idx}`}
                        estimatedTime={25}
                        aspectRatio={(generation.parameters as any)?.aspectRatio}
                        isVideo={false}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          }
          
          // Failed generation layout
          if (generation.status === 'failed') {
            const errorMessage = (generation.parameters as any)?.error || 'Generation failed'
            return (
              <div key={stableKey} className="flex gap-6 items-start">
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
                    <ReferenceImageThumbnail generation={generation} />
                  </div>
                </div>

                {/* Right Side: Error Message */}
                <div className="flex-1 max-w-2xl">
                  <div className="bg-destructive/10 rounded-xl p-6 border border-destructive/50">
                    <h3 className="text-lg font-semibold text-destructive mb-2">Generation Failed</h3>
                    <p className="text-sm text-foreground/80 mb-4">{errorMessage}</p>
                    <button
                      onClick={() => onReuseParameters(generation)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Try Again
                    </button>
                  </div>
                </div>
              </div>
            )
          }
          
          // Video layout: mirror image layout → prompt on the left, video on the right
          if (isVideo) {
            return (
              <div key={stableKey} className="flex gap-6 items-start">
                {/* Left Side: Prompt Display - same styling as images */}
                <div className="w-96 flex-shrink-0 bg-muted/30 rounded-xl p-6 border border-border/50 flex flex-col" style={{ minHeight: '320px' }}>
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
                    <div className="flex items-center gap-2">
                      <Info className="h-3.5 w-3.5" />
                      <span className="capitalize font-medium">{(generation.modelId || 'unknown').replace('gemini-', '').replace('-', ' ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground/70">Generated:</span>
                      <span className="font-medium">{formatDate(generation.createdAt)}</span>
                    </div>
                    
                    {/* Reference Image Thumbnail */}
                    <ReferenceImageThumbnail generation={generation} />
                  </div>
                </div>

                {/* Right Side: Single video container */}
                <div className="flex-1 grid grid-cols-1 gap-3 max-w-4xl">
                  {generation.outputs && generation.outputs.length > 0 ? (
                    generation.outputs.map((output) => {
                      const aspectRatio = (generation.parameters as any)?.aspectRatio || '16:9'
                      return (
                        <div
                          key={output.id}
                          className="group relative bg-muted rounded-xl overflow-hidden border border-border/50 hover:border-primary/50 hover:shadow-lg transition-all duration-200"
                          style={{ aspectRatio: getAspectRatioStyle(aspectRatio) }}
                        >
                          <video
                            src={output.fileUrl}
                            className="w-full h-full object-cover"
                            controls
                          />

                        {/* Hover Overlay with Actions (no convert-to-video button in video view) */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                          {/* Top Right - Approval checkmark */}
                          <div className="absolute top-2 right-2 pointer-events-auto">
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
                          
                          {/* Bottom Action Bar */}
                          <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between pointer-events-auto">
                            <div className="flex items-center gap-1">
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
                            <div className="flex items-center gap-1">
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
                            </div>
                          </div>
                        </div>
                      </div>
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
            )
          }

          // Image layout: Original layout with prompt on left (completed status)
          return (
            <div key={stableKey} className="flex gap-6 items-start">
              {/* Left Side: Prompt Display - Increased Height with Scroll on Hover */}
              <div className="w-96 flex-shrink-0 bg-muted/30 rounded-xl p-6 border border-border/50 flex flex-col" style={{ minHeight: '320px' }}>
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
                    <span className="capitalize font-medium">{(generation.modelId || 'unknown').replace('gemini-', '').replace('-', ' ')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground/70">Generated:</span>
                    <span className="font-medium">{new Date(generation.createdAt).toLocaleDateString()}</span>
                  </div>

                  {/* Reference Image Thumbnail */}
                  <ReferenceImageThumbnail generation={generation} />
                </div>
              </div>

            {/* Right Side: Outputs in 2-Column Grid - Smaller Images */}
            <div className="flex-1 grid grid-cols-2 gap-3 max-w-4xl">
              {(generation.outputs || []).map((output) => {
                const aspectRatio = (generation.parameters as any)?.aspectRatio || '1:1'
                return (
                <div
                  key={output.id}
                  className="group relative bg-muted rounded-xl overflow-hidden border border-border/50 hover:border-primary/50 hover:shadow-lg transition-all duration-200"
                  style={{ aspectRatio: getAspectRatioStyle(aspectRatio) }}
                >
                  {output.fileType === 'image' && (
                    <Image
                      src={output.fileUrl}
                      alt="Generated content"
                      width={output.width || 512}
                      height={output.height || 512}
                      className="w-full h-full object-cover cursor-pointer"
                      loading="lazy"
                      unoptimized={false}
                      onClick={() => setLightboxData({
                        imageUrl: output.fileUrl,
                        output: output,
                        generation: generation
                      })}
                    />
                  )}

                {/* Hover Overlay - Minimal Krea Style - pointer-events-none to allow image clicks */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                  {/* Top Right - Approval checkmark (always visible when approved) */}
                  <div className="absolute top-2 right-2 pointer-events-auto">
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
                  
                  {/* Bottom Action Bar */}
                  <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between pointer-events-auto">
                    <div className="flex items-center gap-1">
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
                      {currentGenerationType === 'image' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleVideoConversion(generation, output.fileUrl)
                          }}
                          className="p-1.5 bg-white/20 backdrop-blur-sm rounded-lg hover:bg-white/30 transition-colors"
                          title="Convert to Video"
                        >
                          <Video className="h-3.5 w-3.5 text-white" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
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
                    </div>
                  </div>
                </div>
              </div>
              )
            })}
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
      />

      {/* Video Session Selector */}
      <VideoSessionSelector
        isOpen={videoSelectorOpen}
        onClose={() => {
          setVideoSelectorOpen(false)
          setSelectedGeneration(null)
          setSelectedImageUrl(null)
        }}
        videoSessions={videoSessions}
        onSelectSession={handleSelectVideoSession}
        onCreateNewSession={handleCreateVideoSession}
      />
    </>
  )
}

