'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Video as VideoIcon, ImagePlus, Ratio, ChevronDown, X, Upload, FolderOpen, Clock } from 'lucide-react'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
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
}: VideoInputProps) {
  const params = useParams()
  const [referenceImage, setReferenceImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [referenceImageId, setReferenceImageId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [browseModalOpen, setBrowseModalOpen] = useState(false)
  const [rendersModalOpen, setRendersModalOpen] = useState(false)
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [transformedPrompt, setTransformedPrompt] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const createReferenceId = () => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
    return `ref-${Date.now()}`
  }
  
  // Get model-specific capabilities
  const { modelConfig, supportedAspectRatios, maxResolution, parameters: modelParameters } = useModelCapabilities(selectedModel)
  
  // Check if model supports image-to-video (reference images)
  const supportsImageToVideo = modelConfig?.capabilities?.['image-2-video'] === true
  
  // Get resolution options from model config or use defaults
  const resolutionOptions = modelParameters.find(p => p.name === 'resolution')?.options || [
    { label: '720p', value: 720 },
    { label: '1080p', value: 1080 },
  ]
  
  // Get duration options from model config
  const durationOptions = modelParameters.find(p => p.name === 'duration')?.options || []
  const hasDuration = durationOptions.length > 0
  
  // Update parameters when model changes if current values aren't supported
  useEffect(() => {
    if (modelConfig) {
      const updates: any = {}
      
      // Check aspect ratio
      if (!supportedAspectRatios.includes(parameters.aspectRatio)) {
        updates.aspectRatio = modelConfig.defaultAspectRatio || supportedAspectRatios[0]
      }
      
      // Check resolution
      if (parameters.resolution > maxResolution) {
        updates.resolution = maxResolution
      }
      
      if (Object.keys(updates).length > 0) {
        onParametersChange({ ...parameters, ...updates })
      }
    }
  }, [modelConfig, selectedModel])

  const handleSubmit = async () => {
    if (!prompt.trim()) return

    setGenerating(true)
    try {
      await onGenerate(prompt, {
        referenceImage: referenceImage || undefined,
        referenceImageId: referenceImageId || undefined,
      })
      onPromptChange('')
      // Clean up preview URL
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl)
      }
      setImagePreviewUrl(null)
      setReferenceImage(null)
    } catch (error) {
      console.error('Generation error:', error)
    } finally {
      setGenerating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
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
        {/* Input */}
        <div className="flex-1 relative">
          <Textarea
            placeholder={supportsImageToVideo ? "Describe a video to animate from the reference image, or drag and drop an image here..." : "Describe a video to animate from the reference image..."}
            value={transformedPrompt !== null ? transformedPrompt : prompt}
            onChange={(e) => {
              setTransformedPrompt(null) // Clear transformation when user types
              onPromptChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            className={`resize-none min-h-[52px] max-h-[104px] px-4 py-3 text-sm rounded-lg bg-muted/50 border transition-all ${
              isEnhancing
                ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/10'
                : isDragging && supportsImageToVideo
                ? 'border-primary/50'
                : 'border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary'
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
            <div className="w-[52px] h-[52px] rounded-lg overflow-hidden border-2 border-primary shadow-md">
              <img
                src={imagePreviewUrl || ''}
                alt="Reference"
                className="w-full h-full object-cover"
              />
            </div>
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
          </div>
        )}
        
        {/* Generate Button */}
        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim() || generating}
          size="default"
          className="h-[52px] px-8 rounded-lg font-semibold shadow-sm hover:shadow transition-all"
        >
          <VideoIcon className="mr-2 h-4 w-4" />
          {generating ? 'Generating...' : 'Generate'}
        </Button>
      </div>

      {/* Parameter Controls - Compact Row */}
      <div className="flex items-center gap-2">
        {/* Model Picker - Inline */}
        <div className="[&>button]:h-8 [&>button]:text-xs [&>button]:px-3 [&>button]:rounded-lg">
          <ModelPicker
            selectedModel={selectedModel}
            onModelSelect={onModelSelect}
            generationType="video"
          />
        </div>

        {/* Style/Image Input - Popover with Upload/Browse */}
        <Popover open={stylePopoverOpen} onOpenChange={setStylePopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={generating}
              className="h-8 px-3 rounded-lg"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-2" align="start">
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8 text-xs"
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
                className="w-full justify-start h-8 text-xs"
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
          className="h-8 px-3 rounded-lg"
          onClick={() => setRendersModalOpen(true)}
          title="Browse product renders"
        >
          {/* Loop logo - white circle */}
          <div className="w-3.5 h-3.5 rounded-full bg-white border border-white/20" />
        </Button>

        {/* Aspect Ratio Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={generating}
              className="h-8 text-xs px-3 rounded-lg"
            >
              <Ratio className="h-3.5 w-3.5 mr-1.5" />
              {parameters.aspectRatio}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="start">
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
          <SelectTrigger className="h-8 text-xs px-3 rounded-lg w-auto min-w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {resolutionOptions.map(option => (
              <SelectItem key={option.value} value={String(option.value)}>
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
            <SelectTrigger className="h-8 text-xs px-3 rounded-lg w-auto min-w-[100px]">
              <Clock className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {durationOptions.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
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

