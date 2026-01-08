'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Image as ImageIcon, ImagePlus, Ratio, ChevronDown, Upload, FolderOpen, X, Circle, GripHorizontal } from 'lucide-react'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
import { AspectRatioSelector } from './AspectRatioSelector'
import { ModelPicker } from './ModelPicker'
import { ImageBrowseModal } from './ImageBrowseModal'
import { ProductRendersBrowseModal } from './ProductRendersBrowseModal'
import { PromptEnhancementButton } from './PromptEnhancementButton'
import { useParams } from 'next/navigation'


interface ChatInputProps {
  prompt: string
  onPromptChange: (prompt: string) => void
  onGenerate: (prompt: string, options?: { referenceImage?: File; referenceImages?: File[] }) => void
  parameters: {
    aspectRatio: string
    resolution: number
    numOutputs: number
  }
  onParametersChange: (parameters: any) => void
  generationType: 'image' | 'video'
  selectedModel: string
  onModelSelect: (modelId: string) => void
  isGenerating?: boolean
  referenceImageUrls?: string[] // URLs to hydrate reference images from
  onRegisterPasteHandler?: (handler: (files: File[]) => void) => () => void // Register to receive pasted images
}

export function ChatInput({
  prompt,
  onPromptChange,
  onGenerate,
  parameters,
  onParametersChange,
  generationType,
  selectedModel,
  onModelSelect,
  isGenerating = false,
  referenceImageUrls,
  onRegisterPasteHandler,
}: ChatInputProps) {
  const params = useParams()
  const [referenceImage, setReferenceImage] = useState<File | null>(null) // Single image (backward compatibility)
  const [referenceImages, setReferenceImages] = useState<File[]>([]) // Multiple images
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [browseModalOpen, setBrowseModalOpen] = useState(false)
  const [rendersModalOpen, setRendersModalOpen] = useState(false)
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [transformedPrompt, setTransformedPrompt] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Resizable input height - use refs for smooth dragging performance
  const [inputHeight, setInputHeight] = useState(52) // Default min height
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(52)
  const rafId = useRef<number | null>(null)
  const currentHeight = useRef(52)
  
  // Keep ref in sync with state
  useEffect(() => {
    currentHeight.current = inputHeight
  }, [inputHeight])
  
  // Get model-specific capabilities
  const { modelConfig, supportedAspectRatios, maxResolution, parameters: modelParameters } = useModelCapabilities(selectedModel)
  
  // Check if model supports image editing (reference images)
  const supportsImageEditing = modelConfig?.capabilities?.editing === true
  // Check if model supports multiple reference images
  const supportsMultiImage = modelConfig?.capabilities?.multiImageEditing === true

  // Get resolution options from model config or use defaults
  const resolutionOptions = modelParameters.find(p => p.name === 'resolution')?.options || [
    { label: '512px', value: 512 },
    { label: '1024px', value: 1024 },
    { label: '2048px', value: 2048 },
  ]
  
  // Update parameters when model changes if current values aren't supported
  useEffect(() => {
    if (modelConfig) {
      const updates: any = {}
      
      // Check aspect ratio
      if (!supportedAspectRatios.includes(parameters.aspectRatio)) {
        updates.aspectRatio = modelConfig.defaultAspectRatio || supportedAspectRatios[0]
      }
      
      // Check resolution - get valid resolution options from model config
      const resolutionParam = modelParameters.find(p => p.name === 'resolution')
      const validResolutions = resolutionParam?.options?.map((opt: any) => opt.value) || []
      if (validResolutions.length > 0 && !validResolutions.includes(parameters.resolution)) {
        // Use default from model config or first available option
        updates.resolution = resolutionParam?.default || validResolutions[0]
      } else if (parameters.resolution > maxResolution) {
        updates.resolution = maxResolution
      }
      
      // Enforce numOutputs based on model config
      const numOutputsParam = modelParameters.find(p => p.name === 'numOutputs')
      const allowedNumOutputs = numOutputsParam?.options?.map((opt: any) => opt.value) || []
      if (allowedNumOutputs.length === 1 && allowedNumOutputs[0] === 1) {
        // Model only allows 1 image (like Nano Banana Pro)
        if (parameters.numOutputs !== 1) {
          updates.numOutputs = 1
        }
      }
      
      // Clear reference images if switching to a model that doesn't support editing
      if (!supportsImageEditing) {
        // Clean up all preview URLs
        imagePreviewUrls.forEach(url => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url)
          }
        })
        setImagePreviewUrls([])
        setReferenceImages([])
        setReferenceImage(null)
      }
      
      if (Object.keys(updates).length > 0) {
        onParametersChange({ ...parameters, ...updates })
      }
    }
  }, [modelConfig, selectedModel, modelParameters])

  const handleSubmit = async () => {
    if (!prompt.trim()) return

    try {
      // Use multiple images if model supports it, otherwise use single image for backward compatibility
      if (supportsMultiImage && referenceImages.length > 0) {
        await onGenerate(prompt, { referenceImages })
      } else if (referenceImage) {
        await onGenerate(prompt, { referenceImage })
      } else {
        await onGenerate(prompt)
      }
      // Keep the last prompt in the input after generating (users often iterate on it)
      // DON'T clear reference images - keep them for next generation
    } catch (error) {
      console.error('Generation error:', error)
      // Error handling is done in the mutation
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Process and add image files (used by both file input and drag-and-drop)
  const processImageFiles = (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    
    if (imageFiles.length === 0) return
    
    if (supportsMultiImage) {
      // Add new images to the array
      const newFiles = [...referenceImages, ...imageFiles]
      const newPreviewUrls = [...imagePreviewUrls, ...imageFiles.map(file => URL.createObjectURL(file))]
      setReferenceImages(newFiles)
      setImagePreviewUrls(newPreviewUrls)
      // Keep single image for backward compatibility (use first one)
      if (newFiles.length > 0) {
        setReferenceImage(newFiles[0])
      }
    } else {
      // Single image mode - use first file only
      const file = imageFiles[0]
      // Clean up old preview URLs
      imagePreviewUrls.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
      const previewUrl = URL.createObjectURL(file)
      setImagePreviewUrls([previewUrl])
      setReferenceImage(file)
      setReferenceImages([file])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    processImageFiles(files)
    
    // Reset input value so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Drag-and-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!supportsImageEditing) return
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!supportsImageEditing) return
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
    
    if (!supportsImageEditing) return
    
    const files = Array.from(e.dataTransfer.files)
    processImageFiles(files)
  }

  // Resize handlers for expanding/collapsing input area
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
    const newHeight = Math.min(Math.max(resizeStartHeight.current + delta, 52), 300) // Min 52px, max 300px
    
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
    // Convert URL to File for image generation
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const file = new File([blob], 'reference.png', { type: blob.type })
      
      if (supportsMultiImage) {
        // Add to array
        const newFiles = [...referenceImages, file]
        const newPreviewUrls = [...imagePreviewUrls, imageUrl]
        setReferenceImages(newFiles)
        setImagePreviewUrls(newPreviewUrls)
        // Keep single image for backward compatibility
        if (newFiles.length === 1) {
          setReferenceImage(file)
        }
      } else {
        // Single image mode
        // Clean up old preview URLs
        imagePreviewUrls.forEach(url => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url)
          }
        })
        setImagePreviewUrls([imageUrl])
        setReferenceImage(file)
        setReferenceImages([file])
      }
      
      // Reset file input so a new image can be selected
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Error loading image from URL:', error)
    }
  }

  // Remove a specific image
  const handleRemoveImage = (index: number) => {
    const newFiles = referenceImages.filter((_, i) => i !== index)
    const urlToRemove = imagePreviewUrls[index]
    
    // Clean up preview URL if it's a blob URL
    if (urlToRemove && urlToRemove.startsWith('blob:')) {
      URL.revokeObjectURL(urlToRemove)
    }
    
    const newPreviewUrls = imagePreviewUrls.filter((_, i) => i !== index)
    setReferenceImages(newFiles)
    setImagePreviewUrls(newPreviewUrls)
    // Update single image reference
    setReferenceImage(newFiles.length > 0 ? newFiles[0] : null)
  }

  // Hydrate reference images from URLs provided by parent (e.g., when reusing parameters)
  useEffect(() => {
    if (!referenceImageUrls || referenceImageUrls.length === 0) {
      // Clear images if URLs are explicitly cleared (empty array)
      if (referenceImageUrls?.length === 0 && imagePreviewUrls.length > 0) {
        imagePreviewUrls.forEach(url => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url)
          }
        })
        setReferenceImages([])
        setImagePreviewUrls([])
        setReferenceImage(null)
      }
      return
    }
    
    // Check if we've already loaded these URLs (avoid re-fetching)
    const urlSet = new Set(referenceImageUrls)
    const currentUrlSet = new Set(imagePreviewUrls)
    const urlsMatch = urlSet.size === currentUrlSet.size && 
                      Array.from(urlSet).every(url => currentUrlSet.has(url))
    if (urlsMatch && referenceImages.length === referenceImageUrls.length) return
    
    ;(async () => {
      try {
        const files: File[] = []
        const previewUrls: string[] = []
        
        for (const url of referenceImageUrls) {
          // Handle data URLs directly
          if (url.startsWith('data:')) {
            // Convert data URL to File
            const response = await fetch(url)
            const blob = await response.blob()
            const file = new File([blob], 'reference.png', { type: blob.type })
            files.push(file)
            previewUrls.push(url) // Use data URL as preview
          } else {
            // Handle HTTP URLs
            const response = await fetch(url)
            const blob = await response.blob()
            const file = new File([blob], 'reference.png', { type: blob.type })
            files.push(file)
            previewUrls.push(url)
          }
        }
        
        // Clean up old preview URLs if they're blob URLs
        imagePreviewUrls.forEach(url => {
          if (url.startsWith('blob:') && !previewUrls.includes(url)) {
            URL.revokeObjectURL(url)
          }
        })
        
        setReferenceImages(files)
        setImagePreviewUrls(previewUrls)
        setReferenceImage(files.length > 0 ? files[0] : null)
      } catch (err) {
        console.error('Failed to hydrate reference image URLs:', err)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceImageUrls]) // Only depend on referenceImageUrls

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      imagePreviewUrls.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
    }
  }, [imagePreviewUrls])

  // Register paste handler with parent component
  useEffect(() => {
    if (!onRegisterPasteHandler || !supportsImageEditing) return
    
    const unregister = onRegisterPasteHandler((files) => {
      processImageFiles(files)
    })
    
    return unregister
  }, [onRegisterPasteHandler, supportsImageEditing])

  return (
    <div 
      className={`space-y-3 transition-all ${
        isDragging && supportsImageEditing
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
        <div className="flex-1 relative">
          {/* Resize handle at top of input */}
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
            placeholder={supportsImageEditing ? "Describe an image and click generate, or drag and drop images here..." : "Describe an image and click generate..."}
            value={transformedPrompt !== null ? transformedPrompt : prompt}
            onChange={(e) => {
              setTransformedPrompt(null) // Clear transformation when user types
              onPromptChange(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            data-generation-input="true"
            style={{ height: `${inputHeight}px` }}
            className={`resize-none px-4 py-3 text-sm rounded-lg bg-muted/50 border pr-10 overflow-y-auto ${
              isResizing ? '' : 'transition-all'
            } ${
              isEnhancing 
                ? 'border-primary/50 bg-primary/5 shadow-lg shadow-primary/10' 
                : isDragging && supportsImageEditing
                ? 'border-primary/50'
                : 'border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary'
            } ${isEnhancing ? 'enhancing-text' : ''}`}
          />
          <PromptEnhancementButton
            prompt={prompt}
            modelId={selectedModel}
            referenceImage={referenceImage}
            onEnhancementComplete={(enhancedPrompt) => {
              setTransformedPrompt(null)
              onPromptChange(enhancedPrompt)
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
            disabled={isGenerating}
          />
        </div>

        {/* Reference Image Thumbnails - Left of Generate Button */}
        {imagePreviewUrls.length > 0 && (
          <div className="flex items-center gap-2">
            {imagePreviewUrls.map((previewUrl, index) => (
              <div key={index} className="relative group">
                <div className="w-[52px] h-[52px] rounded-lg overflow-hidden border-2 border-primary shadow-md">
                  <img
                    src={previewUrl}
                    alt={`Reference ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  onClick={() => handleRemoveImage(index)}
                  className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
                  title="Remove reference image"
                >
                  <X className="h-3 w-3" />
                </button>
                {supportsMultiImage && imagePreviewUrls.length > 1 && (
                  <div className="absolute -bottom-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {index + 1}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        
        {/* Generate Button */}
        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim()}
          size="default"
          className="h-[52px] px-8 rounded-lg font-semibold shadow-sm hover:shadow transition-all"
        >
          Generate
        </Button>
      </div>

      {/* Parameter Controls - Compact Row */}
      <div className="flex items-center gap-2">
        {/* Model Picker - Inline */}
        <div className="[&>button]:h-8 [&>button]:text-xs [&>button]:px-3 [&>button]:rounded-lg">
          <ModelPicker
            selectedModel={selectedModel}
            onModelSelect={onModelSelect}
            generationType={generationType}
          />
        </div>

        {/* Style/Image Input - Popover with Upload/Browse - Only show if model supports editing */}
        {supportsImageEditing && (
          <Popover open={stylePopoverOpen} onOpenChange={setStylePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
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
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={supportsMultiImage}
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Renders Button - Product renders quick access */}
        {supportsImageEditing && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 rounded-lg"
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
        )}

        {/* Aspect Ratio Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
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
                onChange={(value) =>
                  onParametersChange({ ...parameters, aspectRatio: value })
                }
                options={supportedAspectRatios}
              />
            </div>
          </PopoverContent>
        </Popover>

        {/* Resolution Selector - Only show if model supports resolution options */}
        {resolutionOptions.length > 0 && (
          <Select
            value={String(parameters.resolution)}
            onValueChange={(value) =>
              onParametersChange({ ...parameters, resolution: parseInt(value) })
            }
          >
            <SelectTrigger className="h-8 w-[70px] text-xs px-2 rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resolutionOptions.map((option: any) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Keyboard Shortcut */}
        <span className="text-xs text-muted-foreground ml-auto hidden lg:inline-flex items-center gap-1">
          <kbd className="px-2 py-0.5 bg-muted rounded text-[10px] border">⌘</kbd>
          <span>+</span>
          <kbd className="px-2 py-0.5 bg-muted rounded text-[10px] border">Enter</kbd>
        </span>
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

