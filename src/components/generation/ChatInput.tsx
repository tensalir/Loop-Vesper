'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Image as ImageIcon, ImagePlus, Ratio, ChevronDown, Upload, FolderOpen, X, Circle, GripHorizontal, Pin, ZoomIn, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import { useModelCapabilities } from '@/hooks/useModelCapabilities'
import { usePinnedImages } from '@/hooks/usePinnedImages'
import { useToast } from '@/components/ui/use-toast'
import { AspectRatioSelector } from './AspectRatioSelector'
import { ModelPicker } from './ModelPicker'
import { ImageBrowseModal } from './ImageBrowseModal'
import { ProductRendersBrowseModal } from './ProductRendersBrowseModal'
import { ModelOptionControls } from './ModelOptionControls'
import { PromptEnhancementButton } from './PromptEnhancementButton'
import { IterationButton } from './IterationButton'
import { PdfBucketRail, PDF_BUCKET_MIME } from './PdfBucketRail'
import { usePdfIngestion } from '@/hooks/usePdfIngestion'
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
  onReferenceImageUrlsChange?: (urls: string[]) => void // Keep parent URLs in sync with UI removals
  onRegisterPasteHandler?: (handler: (files: File[]) => void) => () => void // Register to receive pasted images
  onRegisterSubmit?: (submit: () => void) => () => void // Register submit for global shortcut
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
  onReferenceImageUrlsChange,
  onRegisterPasteHandler,
  onRegisterSubmit,
}: ChatInputProps) {
  const params = useParams()
  const { toast } = useToast()
  const projectId = params.id as string | undefined
  const { pinImage } = usePinnedImages(projectId)
  const [referenceImage, setReferenceImage] = useState<File | null>(null) // Single image (backward compatibility)
  const [referenceImages, setReferenceImages] = useState<File[]>([]) // Multiple images
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const imagePreviewUrlsRef = useRef<string[]>([])
  // Track which URLs we've successfully loaded to avoid stale closure issues
  const lastLoadedUrlsRef = useRef<string[]>([])
  // Prevent out-of-order async hydration from overwriting newer selections
  const hydrateRequestIdRef = useRef(0)
  const hydrateInFlightKeyRef = useRef<string | null>(null)
  const [browseModalOpen, setBrowseModalOpen] = useState(false)
  const [rendersModalOpen, setRendersModalOpen] = useState(false)
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false)
  // Full-view lightbox state
  const [fullviewOpen, setFullviewOpen] = useState(false)
  const [fullviewImageUrl, setFullviewImageUrl] = useState<string | null>(null)
  const [isEnhancing, setIsEnhancing] = useState(false)
  // Ref guard to avoid race conditions where users click Generate
  // before React has re-rendered with the latest enhancing state.
  const isEnhancingRef = useRef(false)
  const [transformedPrompt, setTransformedPrompt] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const maskInputRef = useRef<HTMLInputElement>(null)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState<string | null>(null)
  
  // Brief visual feedback when generate is triggered
  const [showGeneratingFeedback, setShowGeneratingFeedback] = useState(false)
  
  // Resizable input height - use refs for smooth dragging performance
  const [inputHeight, setInputHeight] = useState(52) // Default min height
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(52)
  const rafId = useRef<number | null>(null)
  const currentHeight = useRef(52)
  
  // PDF ingestion
  const { ingestPdf, isProcessing: isPdfProcessing } = usePdfIngestion(projectId || '')

  // Keep ref in sync with state
  useEffect(() => {
    currentHeight.current = inputHeight
  }, [inputHeight])

  useEffect(() => {
    imagePreviewUrlsRef.current = imagePreviewUrls
  }, [imagePreviewUrls])
  
  // Get model-specific capabilities
  const { modelConfig, supportedAspectRatios, maxResolution, parameters: modelParameters } = useModelCapabilities(selectedModel)
  
  // Check if model supports image editing (reference images)
  const supportsImageEditing = modelConfig?.capabilities?.editing === true
  // Check if model supports multiple reference images
  const supportsMultiImage = modelConfig?.capabilities?.multiImageEditing === true
  // Max reference images for multi-image models (default 14 per Gemini API docs)
  const maxReferenceImages = modelConfig?.capabilities?.maxReferenceImages ?? (supportsMultiImage ? 14 : 1)

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
      const supportsEditing = modelConfig.capabilities?.editing === true
      
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
      
      // Clear reference images and mask if switching to a model that doesn't support editing
      if (!supportsEditing) {
        // Clean up all preview URLs
        imagePreviewUrlsRef.current.forEach(url => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url)
          }
        })
        setImagePreviewUrls([])
        setReferenceImages([])
        setReferenceImage(null)
        setMaskPreviewUrl(null)
        lastLoadedUrlsRef.current = []
        hydrateInFlightKeyRef.current = null
        hydrateRequestIdRef.current += 1
        onReferenceImageUrlsChange?.([])
      }
      
      // Reset model-specific extended parameters to config defaults (or undefined)
      const extendedKeys = ['quality', 'outputFormat', 'outputCompression', 'background', 'moderation'] as const
      for (const key of extendedKeys) {
        const paramDef = modelParameters.find(p => p.name === key)
        if (paramDef) {
          if ((parameters as any)[key] === undefined) {
            updates[key] = paramDef.default
          }
        } else if ((parameters as any)[key] !== undefined) {
          updates[key] = undefined
        }
      }

      if (Object.keys(updates).length > 0) {
        onParametersChange({ ...parameters, ...updates })
      }
    }
  }, [modelConfig, selectedModel, modelParameters])

  const handleMaskSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    if (file.type !== 'image/png') {
      toast({ title: 'Invalid mask', description: 'Mask must be a PNG file with an alpha channel.', variant: 'destructive' })
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: 'Mask too large', description: 'Mask must be under 50 MB.', variant: 'destructive' })
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      setMaskPreviewUrl(dataUrl)
      onParametersChange({ ...parameters, mask: dataUrl })
    }
    reader.readAsDataURL(file)
  }, [parameters, onParametersChange, toast])

  const handleClearMask = useCallback(() => {
    setMaskPreviewUrl(null)
    const { mask: _removed, ...rest } = parameters as any
    onParametersChange(rest)
  }, [parameters, onParametersChange])

  const handleSubmit = async () => {
    // Best practice (see `.sentinel.md`): avoid submitting during transient UI state.
    // While the wand animation runs, the textarea can display `transformedPrompt`
    // before the enhanced prompt is committed to `prompt`, which leads to stale submissions.
    if (isEnhancingRef.current) {
      toast({
        title: 'Enhancing prompt…',
        description: 'Wait for the enhancement to finish, then generate.',
      })
      return
    }
    if (!prompt.trim()) return

    try {
      // Show brief visual feedback that generation was triggered
      setShowGeneratingFeedback(true)
      
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
      setShowGeneratingFeedback(false) // Clear feedback on error
    }
  }
  
  // Auto-reset generating feedback after brief display
  useEffect(() => {
    if (showGeneratingFeedback) {
      const timer = setTimeout(() => {
        setShowGeneratingFeedback(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [showGeneratingFeedback])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      if (isEnhancingRef.current) return
      handleSubmit()
    }
  }

  // Route PDF files to the ingestion pipeline
  const processPdfFile = useCallback((file: File) => {
    if (!projectId) {
      toast({ title: 'No project', description: 'PDF upload requires a project context.' })
      return
    }
    ingestPdf(file)
    toast({ title: 'Processing PDF...', description: `Extracting images from ${file.name}` })
  }, [projectId, ingestPdf, toast])

  // Process and add image files (used by both file input and drag-and-drop)
  // Uses functional state updates to ensure correct behavior when called from stale closures (e.g., paste handlers)
  const processImageFiles = (files: File[]) => {
    // Route any PDF files to the PDF ingestion pipeline
    const pdfFiles = files.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    pdfFiles.forEach(processPdfFile)

    const imageFiles = files.filter(file => file.type.startsWith('image/'))
    
    if (imageFiles.length === 0) return
    
    if (supportsMultiImage) {
      // Use functional updates to get the current state values
      // This is critical for paste handlers which may have stale closures
      setReferenceImages(prevReferenceImages => {
        const currentCount = prevReferenceImages.length
        const availableSlots = maxReferenceImages - currentCount
        
        if (availableSlots <= 0) {
          toast({
            title: 'Maximum images reached',
            description: `This model supports up to ${maxReferenceImages} reference images.`,
          })
          return prevReferenceImages
        }
        
        // Only take as many images as we have slots for
        const filesToAdd = imageFiles.slice(0, availableSlots)
        if (filesToAdd.length < imageFiles.length) {
          toast({
            title: 'Some images not added',
            description: `Only ${filesToAdd.length} of ${imageFiles.length} images added. Maximum is ${maxReferenceImages}.`,
          })
        }
        
        // Add new images to the array
        const newFiles = [...prevReferenceImages, ...filesToAdd]
        
        // Update preview URLs using ref to get current value, then set state
        const newPreviewUrls = [...imagePreviewUrlsRef.current, ...filesToAdd.map(file => URL.createObjectURL(file))]
        setImagePreviewUrls(newPreviewUrls)
        
        // Keep single image for backward compatibility (use first one)
        if (newFiles.length > 0) {
          setReferenceImage(newFiles[0])
        }
        
        return newFiles
      })
    } else {
      // Single image mode - use first file only
      const file = imageFiles[0]
      // Clean up old preview URLs using ref for current value
      imagePreviewUrlsRef.current.forEach(url => {
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

  // Drag-and-drop handlers (accept both images and PDFs)
  const hasPdfInDrag = (e: React.DragEvent) => {
    return Array.from(e.dataTransfer.items).some(
      (item) => item.type === 'application/pdf'
    )
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const hasBucketDrag = Array.from(e.dataTransfer.types).includes(PDF_BUCKET_MIME)
    if (!supportsImageEditing && !hasPdfInDrag(e) && !hasBucketDrag) return
    setIsDragging(true)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
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

    const bucketUrl = e.dataTransfer.getData(PDF_BUCKET_MIME)
    if (bucketUrl) {
      handleBrowseSelect(bucketUrl)
      return
    }
    
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
      if (supportsMultiImage) {
        // Check if we've reached the max
        if (referenceImages.length >= maxReferenceImages) {
          toast({
            title: 'Maximum images reached',
            description: `This model supports up to ${maxReferenceImages} reference images.`,
          })
          return
        }
      }
      
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

  // Open fullview lightbox for a thumbnail
  const handleThumbnailClick = (previewUrl: string) => {
    setFullviewImageUrl(previewUrl)
    setFullviewOpen(true)
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
    // Keep parent URL state in sync (avoid stale urls reappearing on next pinned click)
    const nextParentUrls = newPreviewUrls.filter((u) => !u.startsWith('blob:'))
    onReferenceImageUrlsChange?.(nextParentUrls)
    // Mark hydration state based on remaining hydrated urls
    lastLoadedUrlsRef.current = nextParentUrls
    hydrateInFlightKeyRef.current = null
    hydrateRequestIdRef.current += 1
  }

  // Hydrate reference images from URLs provided by parent (e.g., when reusing parameters or pinned images)
  useEffect(() => {
    if (!referenceImageUrls || referenceImageUrls.length === 0) {
      // Invalidate any in-flight hydration so it can't overwrite cleared state
      hydrateRequestIdRef.current += 1
      hydrateInFlightKeyRef.current = null

      // Clear images if URLs are explicitly cleared (empty array)
      if (referenceImageUrls?.length === 0 && lastLoadedUrlsRef.current.length > 0) {
        // Clean up blob URLs before clearing
        imagePreviewUrlsRef.current.forEach(url => {
          if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url)
          }
        })
        setReferenceImages([])
        setImagePreviewUrls([])
        setReferenceImage(null)
        lastLoadedUrlsRef.current = []
      }
      return
    }
    
    // Check if we've already loaded these exact URLs (using ref to avoid stale closure)
    const newUrlsKey = [...referenceImageUrls].sort().join('|')
    const lastUrlsKey = [...lastLoadedUrlsRef.current].sort().join('|')
    if (newUrlsKey === lastUrlsKey) return
    if (hydrateInFlightKeyRef.current === newUrlsKey) return

    const requestId = (hydrateRequestIdRef.current += 1)
    hydrateInFlightKeyRef.current = newUrlsKey
    
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
            if (!response.ok) {
              console.error(`Failed to fetch image: ${url} (${response.status})`)
              continue
            }
            const blob = await response.blob()
            const file = new File([blob], 'reference.png', { type: blob.type })
            files.push(file)
            previewUrls.push(url)
          }
        }
        
        // If a newer hydration request started, ignore these results
        if (requestId !== hydrateRequestIdRef.current) return

        // Clean up old blob preview URLs
        imagePreviewUrlsRef.current.forEach(url => {
          if (url.startsWith('blob:') && !previewUrls.includes(url)) {
            URL.revokeObjectURL(url)
          }
        })
        
        setReferenceImages(files)
        setImagePreviewUrls(previewUrls)
        setReferenceImage(files.length > 0 ? files[0] : null)

        // Only mark as loaded if we successfully hydrated all requested URLs
        lastLoadedUrlsRef.current =
          previewUrls.length === referenceImageUrls.length ? [...referenceImageUrls] : []
        hydrateInFlightKeyRef.current = null
      } catch (err) {
        console.error('Failed to hydrate reference image URLs:', err)
        // Reset the ref so user can try again
        if (requestId === hydrateRequestIdRef.current) {
          lastLoadedUrlsRef.current = []
          hydrateInFlightKeyRef.current = null
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referenceImageUrls]) // Only depend on referenceImageUrls

  // Cleanup blob preview URLs on unmount only (point-of-removal revocation is
  // handled by handleRemoveImage, model-switch, and hydration-clear individually).
  useEffect(() => {
    return () => {
      imagePreviewUrlsRef.current.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Register paste handler with parent component
  useEffect(() => {
    if (!onRegisterPasteHandler || !supportsImageEditing) return
    
    const unregister = onRegisterPasteHandler((files) => {
      processImageFiles(files)
    })
    
    return unregister
  }, [onRegisterPasteHandler, supportsImageEditing])

  // Register submit handler with parent for global Cmd/Ctrl+Enter shortcut
  const handleSubmitRef = useRef(handleSubmit)
  handleSubmitRef.current = handleSubmit

  useEffect(() => {
    if (!onRegisterSubmit) return
    return onRegisterSubmit(() => handleSubmitRef.current())
  }, [onRegisterSubmit])

  return (
    <div 
      className={`space-y-3 transition-all ${
        isDragging
          ? 'ring-2 ring-primary ring-offset-2 rounded-lg p-2 -m-2 bg-primary/5'
          : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* PDF Bucket Rail - above the input area */}
      {projectId && supportsImageEditing && (
        <PdfBucketRail projectId={projectId} />
      )}

      {/* Main Input Area - Card Style */}
      <div className="flex items-center gap-3">
        {/* Input column with optional thumbnails above (for multi-image models) */}
        <div className="flex-1 flex flex-col gap-2">
          {/* Reference image bar - always visible when model supports editing */}
          {supportsMultiImage && supportsImageEditing && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
              {imagePreviewUrls.map((previewUrl, index) => (
                <div key={previewUrl} className="relative group flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => handleThumbnailClick(previewUrl)}
                    className="rounded-md overflow-hidden border-2 border-primary/50 shadow-lg transition-transform duration-300 group-hover:scale-105 w-[32px] h-[32px] cursor-pointer"
                    title="Click to view full size"
                  >
                    <img
                      src={previewUrl}
                      alt={`Reference ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    {/* Zoom indicator on hover */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ZoomIn className="h-3 w-3 text-white" />
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveImage(index)
                    }}
                    className="absolute -top-1 -right-1 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
                    title="Remove reference image"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                  {/* Pin button - only show if we have a proper URL (not blob) */}
                  {projectId && previewUrl.startsWith('http') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        pinImage({ imageUrl: previewUrl })
                        toast({
                          title: 'Image pinned',
                          description: 'Reference image added to project pins',
                        })
                      }}
                      className="absolute -top-1 -left-1 bg-primary text-primary-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-primary/90 z-10"
                      title="Pin to project"
                    >
                      <Pin className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
              
              {/* Add more button inline with thumbnails */}
              {imagePreviewUrls.length < maxReferenceImages && (
                <Popover open={stylePopoverOpen} onOpenChange={setStylePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={isGenerating}
                      className="rounded-md border-2 border-dashed border-white/20 hover:border-primary/50 hover:bg-primary/10 transition-all flex items-center justify-center w-[32px] h-[32px] flex-shrink-0"
                      title={`Add reference image (${imagePreviewUrls.length}/${maxReferenceImages})`}
                    >
                      <ImagePlus className="h-3.5 w-3.5 text-muted-foreground/70" />
                    </button>
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
              
              {/* Image count indicator */}
              <span className="text-xs text-muted-foreground flex-shrink-0 ml-1">
                {imagePreviewUrls.length}/{maxReferenceImages}
              </span>
            </div>
          )}

          {/* Input with resize handle */}
          <div className={`relative rounded-lg ${isEnhancing ? 'enhancing-container' : ''}`}>
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
              className={`resize-none px-4 py-3 text-sm rounded-lg bg-muted/50 border pr-16 overflow-y-auto ${
                isResizing ? '' : 'transition-all'
              } ${
                isEnhancing 
                  ? 'border-transparent' 
                  : isDragging && supportsImageEditing
                  ? 'border-primary/50'
                  : 'border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary'
              } ${isEnhancing ? 'enhancing-text' : ''}`}
            />
            <IterationButton
              prompt={prompt}
              modelId={selectedModel}
              referenceImage={referenceImage}
              onApplyToPrompt={(variantPrompt) => {
                setTransformedPrompt(null)
                onPromptChange(variantPrompt)
              }}
              disabled={isGenerating || isEnhancing}
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
                isEnhancingRef.current = enhancing
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
        </div>

        {/* Reference Image Picker - Right of prompt (single-image editing models only) */}
        {supportsImageEditing && !supportsMultiImage && (
          <div className="flex items-center gap-2">
            {(
              <div className="relative group">
                <Popover open={stylePopoverOpen} onOpenChange={setStylePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={isGenerating}
                      className={`rounded-md transition-all flex items-center justify-center w-[32px] h-[32px] ${
                        imagePreviewUrls.length > 0
                          ? 'border-2 border-primary/50 shadow-lg hover:shadow'
                          : 'border-2 border-dashed border-white/20 hover:border-primary/50 hover:bg-primary/10'
                      }`}
                      title={imagePreviewUrls.length > 0 ? 'Change reference image' : 'Add reference image'}
                    >
                      {imagePreviewUrls.length > 0 ? (
                        <img
                          src={imagePreviewUrls[0]}
                          alt="Reference"
                          className="w-full h-full object-cover rounded-[4px]"
                        />
                      ) : (
                        <ImagePlus className="h-3.5 w-3.5 text-muted-foreground/70" />
                      )}
                    </button>
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

                {imagePreviewUrls.length > 0 && (
                  <button
                    onClick={() => handleRemoveImage(0)}
                    className="absolute -top-1 -right-1 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
                    title="Remove reference image"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,application/pdf"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        )}

        {/* Hidden file input for multi-image models (no right-side picker) */}
        {supportsImageEditing && supportsMultiImage && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        )}
        
        {/* Generate Button */}
        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim() || isEnhancing || transformedPrompt !== null || showGeneratingFeedback}
          size="default"
          className="h-[52px] px-8 rounded-lg font-semibold shadow-sm hover:shadow transition-all"
        >
          {showGeneratingFeedback ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating
            </>
          ) : (
            'Generate'
          )}
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

        {/* Style/Image Input moved to right of prompt (above). */}

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

        {/* Mask upload — visible when editing model + refs attached */}
        {supportsImageEditing && imagePreviewUrls.length > 0 && (
          <div className="relative group">
            <button
              type="button"
              onClick={() => maskInputRef.current?.click()}
              className={`h-8 px-2 rounded-lg border text-xs flex items-center gap-1 transition-all ${
                maskPreviewUrl
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-dashed border-muted-foreground/30 hover:border-primary/50'
              }`}
              title={maskPreviewUrl ? 'Change mask' : 'Add mask (PNG with alpha)'}
            >
              {maskPreviewUrl ? (
                <img src={maskPreviewUrl} alt="Mask" className="h-5 w-5 object-cover rounded-sm" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-muted-foreground/70" />
              )}
              <span className="text-muted-foreground">Mask</span>
            </button>
            {maskPreviewUrl && (
              <button
                onClick={handleClearMask}
                className="absolute -top-1 -right-1 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
                title="Remove mask"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
            <input
              ref={maskInputRef}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={handleMaskSelect}
            />
          </div>
        )}

        {/* Model-specific option controls (quality, format, etc.) */}
        <ModelOptionControls
          modelParameters={modelParameters}
          parameters={parameters}
          onParametersChange={onParametersChange}
        />

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

      {/* Fullview Lightbox Dialog */}
      <Dialog open={fullviewOpen} onOpenChange={setFullviewOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-transparent border-none shadow-none [&>button]:text-white [&>button]:bg-black/50 [&>button]:hover:bg-black/70">
          {fullviewImageUrl && (
            <div className="flex items-center justify-center">
              <img
                src={fullviewImageUrl}
                alt="Full view"
                className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  )
}

