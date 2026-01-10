'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Video as VideoIcon, ImagePlus, Ratio, ChevronDown, X, Upload, FolderOpen, Clock, Loader2, GripHorizontal, Pin } from 'lucide-react'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
import { usePinnedImages } from '@/hooks/usePinnedImages'
import { useToast } from '@/components/ui/use-toast'
import { AspectRatioSelector } from './AspectRatioSelector'
import { ModelPicker } from './ModelPicker'
import { ImageBrowseModal } from './ImageBrowseModal'
import { ProductRendersBrowseModal } from './ProductRendersBrowseModal'
import { useParams } from 'next/navigation'
import { PromptEnhancementButton } from './PromptEnhancementButton'

interface VideoInputProps {
  prompt: string
  onPromptChange: (prompt: string) => void
  onGenerate: (prompt: string, options?: { referenceImage?: File; referenceImageId?: string }) => void
  parameters: {
    aspectRatio: string
    resolution: number
    numOutputs: number
    duration?: number
  }
  onParametersChange: (parameters: any) => void
  selectedModel: string
  onModelSelect: (modelId: string) => void
  referenceImageUrl?: string | null
  onClearReferenceImage?: () => void
  onSetReferenceImageUrl?: (url: string) => void
  /** Display variant: 'default' for full prompt bar, 'overlay' for compact overlay mode */
  variant?: 'default' | 'overlay'
  /** When true, reference image cannot be removed (used in animate-still overlay) */
  lockedReferenceImage?: boolean
  /** When true, hides upload/browse buttons for reference images */
  hideReferencePicker?: boolean
  /** Override reference image ID (e.g., use outputId for animate-still link) */
  referenceImageIdOverride?: string
  /** Whether to show the generate button (default true) */
  showGenerateButton?: boolean
  /** Whether generation is currently in progress */
  isGenerating?: boolean
  /** Register to receive pasted images from global paste handler */
  onRegisterPasteHandler?: (handler: (files: File[]) => void) => () => void
}

export function VideoInput({
  prompt,
  onPromptChange,
  onGenerate,
  parameters,
  onParametersChange,
  selectedModel,
  onModelSelect,
  referenceImageUrl,
  onClearReferenceImage,
  onSetReferenceImageUrl,
  variant = 'default',
  lockedReferenceImage = false,
  hideReferencePicker = false,
  referenceImageIdOverride,
  showGenerateButton = true,
  isGenerating: externalGenerating,
  onRegisterPasteHandler,
}: VideoInputProps) {
  const params = useParams()
  const { toast } = useToast()
  const projectId = params.id as string | undefined
  const { pinImage } = usePinnedImages(projectId)
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [referenceImageId, setReferenceImageId] = useState<string | null>(null)
  const [localGenerating, setLocalGenerating] = useState(false)
  const [browseModalOpen, setBrowseModalOpen] = useState(false)
  const [rendersModalOpen, setRendersModalOpen] = useState(false)
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  // Ref guard to avoid race conditions where users click Generate
  // before React has re-rendered with the latest enhancing state.
  const isEnhancingRef = useRef(false)
  const [transformedPrompt, setTransformedPrompt] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Resizable input height - available in both default and overlay modes
  const [inputHeight, setInputHeight] = useState(52) // Default min height (matches ChatInput)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(52)
  const rafId = useRef<number | null>(null)
  const currentHeight = useRef(52)
  
  // Combine external and internal generating state
  const generating = externalGenerating ?? localGenerating
  const isOverlay = variant === 'overlay'
  
  // Keep ref in sync with state
  useEffect(() => {
    currentHeight.current = inputHeight
  }, [inputHeight])
  
  const createReferenceId = () => {
    // Use override if provided (e.g., outputId for animate-still)
    if (referenceImageIdOverride) {
      return referenceImageIdOverride
    }
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `ref-${Date.now()}`
  }
  
  // Get model-specific capabilities
  const { modelConfig, supportedAspectRatios, maxResolution, parameters: modelParameters } = useModelCapabilities(selectedModel)
  
  // Check if model supports image-to-video (reference images)
  const supportsImageToVideo = modelConfig?.capabilities?.['image-2-video'] === true
  
  const resolutionParam = modelParameters.find((p) => p.name === 'resolution')
  const durationParam = modelParameters.find((p) => p.name === 'duration')

  // Get resolution options from model config or use defaults
  const resolutionOptions = resolutionParam?.options || [
    { label: '720p', value: 720 },
    { label: '1080p', value: 1080 },
  ]
  
  // Get duration options from model config
  const durationOptions = durationParam?.options || []
  const hasDuration = durationOptions.length > 0
  
  // Update parameters when model changes if current values aren't supported
  useEffect(() => {
    if (modelConfig) {
      const updates: any = {}
      
      // Check aspect ratio
      if (!supportedAspectRatios.includes(parameters.aspectRatio)) {
        updates.aspectRatio = modelConfig.defaultAspectRatio || supportedAspectRatios[0]
      }
      
      // Check resolution (prefer allowed options if provided)
      const allowedResolutions = resolutionOptions.map((o: any) => o.value)
      if (allowedResolutions.length > 0 && !allowedResolutions.includes(parameters.resolution)) {
        updates.resolution = resolutionParam?.default ?? allowedResolutions[0]
      } else if (parameters.resolution > maxResolution) {
        updates.resolution = maxResolution
      }

      // Check duration (if model exposes duration options)
      if (durationOptions.length > 0) {
        const allowedDurations = durationOptions.map((o: any) => o.value)
        const currentDuration = parameters.duration
        if (!currentDuration || !allowedDurations.includes(currentDuration)) {
          updates.duration = durationParam?.default ?? allowedDurations[0]
        }
      }
      
      if (Object.keys(updates).length > 0) {
        onParametersChange({ ...parameters, ...updates })
      }
    }
  }, [modelConfig, selectedModel])

  const handleSubmit = async () => {
    // Avoid submitting while the prompt is mid-transformation (wand animation),
    // otherwise we can send a stale motion prompt.
    if (isEnhancingRef.current) {
      toast({
        title: 'Enhancing prompt…',
        description: 'Wait for the enhancement to finish, then generate.',
      })
      return
    }
    if (!prompt.trim()) return

    setLocalGenerating(true)
    try {
      await onGenerate(prompt, {
        referenceImage: referenceImage || undefined,
        referenceImageId: referenceImageId || undefined,
      })
      // Keep the last prompt AND reference image after generating (users often iterate).
      // (ChatInput does the same for images; clearing the reference can cause confusing
      // mismatches where an old referenceImageId is persisted without an actual image.)
    } catch (error) {
      console.error('Generation error:', error)
    } finally {
      setLocalGenerating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (isEnhancingRef.current) return
      handleSubmit()
    }
  }

  // Process and add image file (used by both file input and drag-and-drop)
  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    
    // Clean up old preview URL
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl)
    }
    // Create new preview URL
    const previewUrl = URL.createObjectURL(file)
    setImagePreviewUrl(previewUrl)
    setReferenceImage(file)
    setReferenceImageId(createReferenceId())
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      processImageFile(file)
    }
    
    // Reset input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!supportsImageToVideo) return
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!supportsImageToVideo) return
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set dragging to false if we're leaving the drop zone entirely
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    
    if (!supportsImageToVideo) return
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      // For video, only use the first image file
      const imageFile = files.find(file => file.type.startsWith('image/'))
      if (imageFile) {
        processImageFile(imageFile)
      }
    }
  }

  // Resize handlers for expanding/collapsing input area (overlay mode only)
  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    resizeStartY.current = clientY
    resizeStartHeight.current = currentHeight.current
    setIsResizing(true)
  }, [])

  const handleResizeMove = useCallback((e: MouseEvent | TouchEvent) => {
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
    // Calculate delta (negative because we're dragging up to expand)
    const delta = resizeStartY.current - clientY
    const newHeight = Math.min(Math.max(resizeStartHeight.current + delta, 52), 300) // Min 52px, max 300px (matches ChatInput)
    
    // Cancel any pending RAF
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
    }
    
    // Use RAF for smooth updates
    rafId.current = requestAnimationFrame(() => {
      currentHeight.current = newHeight
      setInputHeight(newHeight)
    })
  }, [])

  const handleResizeEnd = useCallback(() => {
    if (rafId.current) {
      cancelAnimationFrame(rafId.current)
      rafId.current = null
    }
    setIsResizing(false)
  }, [])

  // Global mouse/touch events for resizing
  useEffect(() => {
    if (isResizing) {
      // Use passive: false for touchmove to prevent scroll interference
      document.addEventListener('mousemove', handleResizeMove)
      document.addEventListener('mouseup', handleResizeEnd)
      document.addEventListener('touchmove', handleResizeMove, { passive: false })
      document.addEventListener('touchend', handleResizeEnd)
      // Prevent text selection while resizing
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ns-resize'
      return () => {
        document.removeEventListener('mousemove', handleResizeMove)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.removeEventListener('touchmove', handleResizeMove)
        document.removeEventListener('touchend', handleResizeEnd)
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
    }
  }, [isResizing, handleResizeMove, handleResizeEnd])

  const handleBrowseSelect = async (imageUrl: string) => {
    // Convert URL to File for consistent handling
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], 'reference.png', { type: blob.type })
      
      // Clean up old preview URL
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
      // Set the imageUrl as preview (it's already a valid URL)
      setImagePreviewUrl(imageUrl)
      setReferenceImage(file)
      setReferenceImageId(createReferenceId())
    } catch (error) {
      console.error('Error loading image from URL:', error)
    }
  }

  // If a referenceImageUrl is provided from parent (e.g., convert-to-video),
  // hydrate the local preview + File so it appears in the prompt bar and is
  // included in the generation request.
  useEffect(() => {
    if (!referenceImageUrl) return
    // If we've already set a preview for this URL, skip
    if (imagePreviewUrl === referenceImageUrl && referenceImage) return
    ;(async () => {
      try {
        const response = await fetch(referenceImageUrl)
        const blob = await response.blob()
        const file = new File([blob], 'reference.png', { type: blob.type })
        // Clean up old preview URL
        if (imagePreviewUrl && imagePreviewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(imagePreviewUrl)
        }
        setImagePreviewUrl(referenceImageUrl)
        setReferenceImage(file)
        setReferenceImageId(createReferenceId())
      } catch (err) {
        console.error('Failed to hydrate referenceImageUrl for video input:', err)
      }
    })()
  }, [referenceImageUrl])

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
    }
  }, [imagePreviewUrl])

  // Register paste handler with parent component
  useEffect(() => {
    if (!onRegisterPasteHandler || !supportsImageToVideo) return
    
    const unregister = onRegisterPasteHandler((files) => {
      // Video input only uses one image, take the first
      if (files.length > 0) {
        processImageFile(files[0])
      }
    })
    
    return unregister
  }, [onRegisterPasteHandler, supportsImageToVideo])

  return (
    <div 
      className={`space-y-3 transition-all ${
        isDragging && supportsImageToVideo
          ? 'ring-2 ring-primary ring-offset-2 rounded-lg p-2 -m-2 bg-primary/5'
          : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Main Input Area - Card Style */}
      <div className="flex items-center gap-3">
        {/* Input with resize handle */}
        <div className="flex-1 relative flex">
          {/* Resize handle at top of input - available in both default and overlay modes */}
          <div 
            className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 cursor-ns-resize group"
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
          >
            <div className={`flex items-center justify-center w-12 h-5 rounded-full transition-all ${
              isResizing 
                ? 'bg-primary/20 text-primary' 
                : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}>
              <GripHorizontal className="w-5 h-3" />
            </div>
          </div>
          
          <Textarea
            placeholder={supportsImageToVideo ? "Describe a video to animate from the reference image, or drag and drop an image here..." : "Describe a video to animate from the reference image..."}
            value={transformedPrompt !== null ? transformedPrompt : prompt}
            onChange={(e) => {
              setTransformedPrompt(null) // Clear transformation when user types
              onPromptChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            data-generation-input="true"
            style={{ height: `${inputHeight}px` }}
            className={`resize-none px-4 text-sm rounded-lg bg-white/5 border-white/10 w-full flex-1 custom-scrollbar overflow-y-auto ${
              isResizing ? '' : 'transition-all'
            } ${
              isOverlay 
                ? 'py-3.5 pr-10' 
                : 'py-3 pr-10'
            } ${
              isEnhancing
                ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/10'
                : isDragging && supportsImageToVideo
                ? 'border-primary/50'
                : 'border-border focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:border-primary/50'
            } ${isEnhancing ? 'enhancing-text' : ''}`}
            disabled={generating}
          />
          <PromptEnhancementButton
            prompt={prompt}
            modelId={selectedModel}
            referenceImage={referenceImage || imagePreviewUrl || null}
            onEnhancementComplete={(enhanced) => {
              setTransformedPrompt(null)
              onPromptChange(enhanced)
            }}
            onEnhancingChange={(enhancing) => {
              isEnhancingRef.current = enhancing
              setIsEnhancing(enhancing)
              if (!enhancing) {
                setTransformedPrompt(null)
              }
            }}
            onTextTransform={(text) => {
              setTransformedPrompt(text)
            }}
            disabled={generating}
          />
        </div>

        {/* Reference Image Thumbnail - Left of Generate Button */}
        {(referenceImage || imagePreviewUrl) && (
          <div className="relative group">
            <div className={`rounded-lg overflow-hidden border-2 border-primary/50 shadow-xl transition-transform duration-300 group-hover:scale-105 ${
              isOverlay ? 'w-[48px] h-[48px]' : 'w-[56px] h-[56px]'
            }`}>
              <img
                src={imagePreviewUrl || ''}
                alt="Reference"
                className="w-full h-full object-cover"
              />
            </div>
            {/* Hide remove button if reference is locked */}
            {!lockedReferenceImage && (
              <button
                onClick={() => {
                  if (imagePreviewUrl) {
                    URL.revokeObjectURL(imagePreviewUrl)
                  }
                  setImagePreviewUrl(null)
                  setReferenceImage(null)
                  setReferenceImageId(null)
                }}
                className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground"
                title="Remove reference image"
              >
                <X className="h-3 w-3" />
              </button>
            )}
            {/* Pin button - only show if we have a proper URL (not blob) */}
            {projectId && imagePreviewUrl && imagePreviewUrl.startsWith('http') && (
              <button
                onClick={() => {
                  pinImage({ imageUrl: imagePreviewUrl })
                  toast({
                    title: 'Image pinned',
                    description: 'Reference image added to project pins',
                  })
                }}
                className="absolute -top-2 -left-2 bg-primary text-primary-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-primary/90 z-10"
                title="Pin to project"
              >
                <Pin className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        
        {/* Generate Button - conditionally rendered */}
        {showGenerateButton && (() => {
          // Validation: all required fields must be selected
          const hasPrompt = prompt.trim().length > 0
          const hasModel = !!selectedModel
          const hasDurationIfRequired = !hasDuration || (parameters.duration && parameters.duration > 0)
          const canGenerate =
            hasPrompt &&
            hasModel &&
            hasDurationIfRequired &&
            !generating &&
            !isEnhancing &&
            transformedPrompt === null
          
          return (
            <Button
              onClick={handleSubmit}
              disabled={!canGenerate}
              size="default"
              className={`rounded-lg font-semibold shadow-sm hover:shadow transition-all ${
                isOverlay ? 'h-[48px] px-6 text-xs' : 'h-[56px] px-8 text-sm'
              }`}
            >
              {generating ? (
                <Loader2 className={`mr-2 animate-spin ${isOverlay ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
              ) : (
                <VideoIcon className={`mr-2 ${isOverlay ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
              )}
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          )
        })()}
      </div>

      {/* Parameter Controls - Compact Row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Model Picker - Inline */}
        <div className="[&>button]:h-8 [&>button]:text-xs [&>button]:px-3 [&>button]:rounded-lg [&>button]:bg-white/5 [&>button]:border-white/10 [&>button]:hover:bg-white/10 [&>button]:transition-colors">
          <ModelPicker
            selectedModel={selectedModel}
            onModelSelect={onModelSelect}
            generationType="video"
          />
        </div>

        {/* Style/Image Input - Popover with Upload/Browse (hidden in locked mode) */}
        {!hideReferencePicker && (
          <>
            <Popover open={stylePopoverOpen} onOpenChange={setStylePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={generating}
                  className="h-8 px-3 rounded-lg bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-2 bg-background/95 backdrop-blur-xl border-white/10 rounded-lg" align="start">
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-8 text-xs rounded-md hover:bg-white/5"
                    onClick={() => {
                      fileInputRef.current?.click()
                      setStylePopoverOpen(false)
                    }}
                  >
                    <Upload className="h-3.5 w-3.5 mr-2" />
                    Upload
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start h-8 text-xs rounded-md hover:bg-white/5"
                    onClick={() => {
                      setBrowseModalOpen(true)
                      setStylePopoverOpen(false)
                    }}
                  >
                    <FolderOpen className="h-3.5 w-3.5 mr-2" />
                    Browse
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileSelect}
            />

            {/* Renders Button - Product renders quick access */}
            <Button
              variant="outline"
              size="sm"
              disabled={generating}
              className="h-8 px-3 rounded-lg bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
              onClick={() => setRendersModalOpen(true)}
              title="Browse product renders"
            >
              <img
                src="/images/Loop-Favicon-(White).png"
                alt="Loop"
                width={14}
                height={14}
                className="w-3.5 h-3.5 rounded-full"
              />
            </Button>
          </>
        )}

        {/* Aspect Ratio Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={generating}
              className="h-8 text-xs px-3 rounded-lg bg-white/5 border-white/10 hover:bg-white/10 transition-colors"
            >
              <Ratio className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              {parameters.aspectRatio}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 bg-background/95 backdrop-blur-xl border-white/10 rounded-xl shadow-2xl" align="start">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Aspect Ratio</p>
              <AspectRatioSelector
                value={parameters.aspectRatio}
                onChange={(ratio: string) => onParametersChange({ ...parameters, aspectRatio: ratio })}
                options={supportedAspectRatios}
              />
            </div>
          </PopoverContent>
        </Popover>

        {/* Resolution Dropdown */}
        <Select
          value={String(parameters.resolution)}
          onValueChange={(value) => onParametersChange({ ...parameters, resolution: parseInt(value) })}
          disabled={generating}
        >
          <SelectTrigger className="h-8 text-xs px-3 rounded-lg bg-white/5 border-white/10 hover:bg-white/10 transition-colors w-auto min-w-[80px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-background/95 backdrop-blur-xl border-white/10 rounded-lg">
            {resolutionOptions.map(option => (
              <SelectItem key={option.value} value={String(option.value)} className="rounded-md text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Duration Dropdown - Only for video models that support it */}
        {hasDuration && (
          <Select
            value={String(parameters.duration || 8)}
            onValueChange={(value) => onParametersChange({ ...parameters, duration: parseInt(value) })}
            disabled={generating}
          >
            <SelectTrigger className="h-8 text-xs px-3 rounded-lg bg-white/5 border-white/10 hover:bg-white/10 transition-colors w-auto min-w-[100px]">
              <Clock className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background/95 backdrop-blur-xl border-white/10 rounded-lg">
              {durationOptions.map((option) => (
                <SelectItem key={option.value} value={String(option.value)} className="rounded-md text-xs">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Image Browse Modal */}
      <ImageBrowseModal
        isOpen={browseModalOpen}
        onClose={() => setBrowseModalOpen(false)}
        onSelectImage={handleBrowseSelect}
        projectId={params.id as string}
      />

      {/* Product Renders Browse Modal */}
      <ProductRendersBrowseModal
        isOpen={rendersModalOpen}
        onClose={() => setRendersModalOpen(false)}
        onSelectImage={handleBrowseSelect}
      />
    </div>
  )
}

