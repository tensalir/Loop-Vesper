'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  Loader2, 
  Plus, 
  Trash2, 
  Pencil, 
  Upload, 
  X,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Sparkles,
  FolderOpen,
  Image as ImageIcon,
  GripVertical,
  Check,
  AlertCircle
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ProductRender {
  id: string
  name: string
  colorway: string | null
  angle: string | null
  sortOrder: number
  imageUrl: string
  storagePath: string | null
  source: 'local' | 'frontify'
  frontifyId: string | null
  createdAt: string
  updatedAt: string
}

interface PendingImage {
  id: string
  file: File
  base64: string
  preview: string
  suggestedColorway: string
  suggestedAngle: string
  colorDescription: string
  confidence: number
}

interface ColorwayGroup {
  colorway: string
  images: PendingImage[]
  expanded: boolean
}

// Angle options
const ANGLE_OPTIONS = [
  'front',
  'side',
  'rear',
  '3/4 front',
  '3/4 rear',
  'top',
  'bottom',
  'detail',
  'other',
]

export function RendersManagementSettings() {
  const [renders, setRenders] = useState<ProductRender[]>([])
  const [productNames, setProductNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [expandedColorways, setExpandedColorways] = useState<Set<string>>(new Set())
  
  // Bulk upload dialog state
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false)
  const [productName, setProductName] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingRender, setEditingRender] = useState<ProductRender | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    colorway: '',
    angle: '',
  })
  const [saving, setSaving] = useState(false)
  
  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingRender, setDeletingRender] = useState<ProductRender | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const fetchRenders = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/product-renders')
      if (!response.ok) throw new Error('Failed to fetch renders')
      
      const data = await response.json()
      setRenders(data.renders || [])
      setProductNames(data.productNames || [])
    } catch (error) {
      console.error('Error fetching renders:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRenders()
  }, [fetchRenders])

  // Group renders by product and colorway
  const groupedRenders = renders.reduce((acc, render) => {
    const productKey = render.name
    const colorwayKey = render.colorway || 'Default'
    
    if (!acc[productKey]) {
      acc[productKey] = {}
    }
    if (!acc[productKey][colorwayKey]) {
      acc[productKey][colorwayKey] = []
    }
    acc[productKey][colorwayKey].push(render)
    
    return acc
  }, {} as Record<string, Record<string, ProductRender[]>>)

  // Filter products
  const filteredProducts = Object.keys(groupedRenders).filter(product => {
    if (searchQuery) {
      return product.toLowerCase().includes(searchQuery.toLowerCase())
    }
    if (selectedProduct) {
      return product === selectedProduct
    }
    return true
  }).sort()

  // Toggle product expansion
  const toggleProduct = (product: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev)
      if (next.has(product)) {
        next.delete(product)
      } else {
        next.add(product)
      }
      return next
    })
  }

  // Toggle colorway expansion
  const toggleColorway = (key: string) => {
    setExpandedColorways(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Compress image to reduce payload size
  const compressImage = (file: File, maxWidth = 1024, quality = 0.85): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = new Image()
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height

          // Scale down if too large
          if (width > maxWidth) {
            height = (height * maxWidth) / width
            width = maxWidth
          }

          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Could not get canvas context'))
            return
          }

          ctx.drawImage(img, 0, 0, width, height)
          const compressedBase64 = canvas.toDataURL('image/jpeg', quality)
          resolve(compressedBase64)
        }
        img.onerror = reject
        img.src = e.target?.result as string
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Handle file drop/selection for bulk upload
  const handleFilesSelected = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    const imageFiles = fileArray.filter(f => f.type.startsWith('image/'))
    
    if (imageFiles.length === 0) return

    // Convert files to compressed base64 and create pending images
    const newPending: PendingImage[] = await Promise.all(
      imageFiles.map(async (file) => {
        // Use original for preview, compressed for analysis
        const previewBase64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })

        // Compress for API calls (smaller payload)
        const compressedBase64 = await compressImage(file, 1024, 0.85)

        return {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          base64: compressedBase64, // Use compressed version for API
          preview: previewBase64, // Use original for preview
          suggestedColorway: 'Unanalyzed',
          suggestedAngle: 'front',
          colorDescription: '',
          confidence: 0,
        }
      })
    )

    setPendingImages(prev => [...prev, ...newPending])
    // Reset analysis state when new images are added
    setAnalysisComplete(false)
    setAnalysisError(null)
  }

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.add('border-primary', 'bg-primary/5')
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.remove('border-primary', 'bg-primary/5')
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dropZoneRef.current) {
      dropZoneRef.current.classList.remove('border-primary', 'bg-primary/5')
    }
    
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files)
    }
  }

  // Analyze images with Claude Vision (in batches to avoid payload limits)
  const analyzeImages = async () => {
    if (pendingImages.length === 0) return
    
    setIsAnalyzing(true)
    setAnalysisError(null)
    setAnalysisComplete(false)
    
    const BATCH_SIZE = 2 // Process 2 images at a time to stay under 4.5MB limit (base64 is ~33% larger)
    const allResults: Array<{ id: string; suggestedColorway: string; suggestedAngle: string; colorDescription: string; confidence: number }> = []
    
    try {
      // Split images into batches
      const batches: typeof pendingImages[] = []
      for (let i = 0; i < pendingImages.length; i += BATCH_SIZE) {
        batches.push(pendingImages.slice(i, i + BATCH_SIZE))
      }

      console.log(`[Analyze] Processing ${pendingImages.length} images in ${batches.length} batches...`)

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex]
        const imagesToAnalyze = batch.map(img => ({
          id: img.id,
          base64: img.base64,
          filename: img.file.name,
        }))

        // Calculate payload size
        const payload = JSON.stringify({
          images: imagesToAnalyze,
          productName: productName || undefined,
        })
        const payloadSizeMB = new Blob([payload]).size / (1024 * 1024)
        console.log(`[Analyze] Batch ${batchIndex + 1}/${batches.length}: ${batch.length} images, payload: ${payloadSizeMB.toFixed(2)}MB`)

        if (payloadSizeMB > 4) {
          console.warn(`[Analyze] Warning: Payload size (${payloadSizeMB.toFixed(2)}MB) is close to limit`)
        }

        const response = await fetch('/api/admin/product-renders/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: imagesToAnalyze,
            productName: productName || undefined,
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `Batch ${batchIndex + 1} failed: ${response.status}`)
        }

        const result = await response.json()
        console.log(`[Analyze] Batch ${batchIndex + 1} results:`, result.images?.length || 0, 'images')
        
        if (result.images) {
          allResults.push(...result.images)
        }

        // Update progress after each batch
        setPendingImages(prev => prev.map(img => {
          const analysis = result.images?.find((a: any) => a.id === img.id)
          if (analysis) {
            return {
              ...img,
              suggestedColorway: analysis.suggestedColorway || 'Default',
              suggestedAngle: analysis.suggestedAngle || 'front',
              colorDescription: analysis.colorDescription || '',
              confidence: analysis.confidence || 0.5,
            }
          }
          return img
        }))
      }

      console.log(`[Analyze] Complete: ${allResults.length} images analyzed`)
      setAnalysisComplete(true)
    } catch (error: any) {
      console.error('[Analyze] Error:', error)
      setAnalysisError(error.message || 'Analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Track if analysis has been done
  const [analysisComplete, setAnalysisComplete] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  
  // Track colorway editing
  const [editingColorway, setEditingColorway] = useState<string | null>(null)
  const [editingColorwayName, setEditingColorwayName] = useState('')
  const [creatingColorway, setCreatingColorway] = useState(false)
  const [creatingColorwayForImage, setCreatingColorwayForImage] = useState<string | null>(null)
  const [newColorwayName, setNewColorwayName] = useState('')

  // Get all unique colorways (sorted, including 'Unanalyzed' if present)
  const allColorways = Array.from(
    new Set(pendingImages.map(img => img.suggestedColorway))
  ).sort()

  // Group pending images by colorway
  const pendingByColorway = pendingImages.reduce((acc, img) => {
    const colorway = img.suggestedColorway
    if (!acc[colorway]) {
      acc[colorway] = []
    }
    acc[colorway].push(img)
    return acc
  }, {} as Record<string, PendingImage[]>)

  // Update image colorway
  const updateImageColorway = (imageId: string, colorway: string) => {
    setPendingImages(prev => prev.map(img => 
      img.id === imageId ? { ...img, suggestedColorway: colorway } : img
    ))
  }

  // Rename a colorway (updates all images with that colorway)
  const renameColorway = (oldName: string, newName: string) => {
    if (!newName.trim() || newName === oldName) {
      setEditingColorway(null)
      return
    }
    
    setPendingImages(prev => prev.map(img => 
      img.suggestedColorway === oldName 
        ? { ...img, suggestedColorway: newName.trim() }
        : img
    ))
    setEditingColorway(null)
  }

  // Start editing colorway name
  const startEditingColorway = (colorway: string) => {
    setEditingColorway(colorway)
    setEditingColorwayName(colorway)
  }

  // Create a new colorway and assign selected image to it
  const createNewColorway = () => {
    if (!newColorwayName.trim()) {
      setCreatingColorway(false)
      setCreatingColorwayForImage(null)
      return
    }
    
    const trimmedName = newColorwayName.trim()
    
    // If creating for a specific image, assign it immediately
    if (creatingColorwayForImage) {
      updateImageColorway(creatingColorwayForImage, trimmedName)
      setCreatingColorwayForImage(null)
    }
    
    setNewColorwayName('')
    setCreatingColorway(false)
  }

  // Update image angle
  const updateImageAngle = (imageId: string, angle: string) => {
    setPendingImages(prev => prev.map(img => 
      img.id === imageId ? { ...img, suggestedAngle: angle } : img
    ))
  }

  // Remove pending image
  const removePendingImage = (imageId: string) => {
    setPendingImages(prev => prev.filter(img => img.id !== imageId))
  }

  // Handle bulk upload
  const handleBulkUpload = async () => {
    if (!productName.trim() || pendingImages.length === 0) return

    setIsUploading(true)
    setUploadProgress(0)

    try {
      const imagesToUpload = pendingImages.map((img, index) => ({
        id: img.id,
        base64: img.base64,
        colorway: img.suggestedColorway,
        angle: img.suggestedAngle,
        sortOrder: index,
      }))

      const response = await fetch('/api/admin/product-renders/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: productName.trim(),
          images: imagesToUpload,
        }),
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const result = await response.json()
      
      // Reset and close
      setProductName('')
      setPendingImages([])
      setBulkUploadOpen(false)
      
      // Refresh list
      fetchRenders()
      
      // Show success message
      alert(`Successfully uploaded ${result.summary.successful} images${result.summary.failed > 0 ? ` (${result.summary.failed} failed)` : ''}`)
    } catch (error: any) {
      console.error('Upload error:', error)
      alert(error.message || 'Failed to upload images')
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  // Handle edit
  const handleEdit = (render: ProductRender) => {
    setEditingRender(render)
    setEditForm({
      name: render.name,
      colorway: render.colorway || '',
      angle: render.angle || '',
    })
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingRender || !editForm.name) return

    setSaving(true)
    try {
      const response = await fetch(`/api/admin/product-renders/${editingRender.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name,
          colorway: editForm.colorway || null,
          angle: editForm.angle || null,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save')
      }

      setEditingRender(null)
      setEditDialogOpen(false)
      fetchRenders()
    } catch (error: any) {
      console.error('Save error:', error)
      alert(error.message || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  // Handle delete
  const handleDelete = (render: ProductRender) => {
    setDeletingRender(render)
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deletingRender) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/admin/product-renders/${deletingRender.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete')
      }

      setDeletingRender(null)
      setDeleteDialogOpen(false)
      fetchRenders()
    } catch (error: any) {
      console.error('Delete error:', error)
      alert(error.message || 'Failed to delete render')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Product Renders</CardTitle>
            <CardDescription>
              Manage product renders organized by product, colorway, and angle
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchRenders}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => setBulkUploadOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Bulk Upload
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search and Filter */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          
          {productNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(selectedProduct || searchQuery) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setSelectedProduct(null)
                  }}
                  className="h-8 text-xs"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Hierarchical Renders View */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <Upload className="h-6 w-6" />
            </div>
            <p className="text-sm">No product renders found</p>
            <p className="text-xs">Click &quot;Bulk Upload&quot; to add product renders</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredProducts.map((product) => (
              <div key={product} className="border rounded-lg overflow-hidden">
                {/* Product Header */}
                <button
                  className="w-full flex items-center gap-2 p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                  onClick={() => toggleProduct(product)}
                >
                  {expandedProducts.has(product) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <FolderOpen className="h-4 w-4 text-primary" />
                  <span className="font-medium">{product}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {Object.keys(groupedRenders[product]).length} colorway(s), {Object.values(groupedRenders[product]).flat().length} image(s)
                  </span>
                </button>

                {/* Colorways */}
                {expandedProducts.has(product) && (
                  <div className="border-t">
                    {Object.entries(groupedRenders[product]).map(([colorway, images]) => {
                      const colorwayKey = `${product}-${colorway}`
                      return (
                        <div key={colorwayKey} className="border-b last:border-b-0">
                          {/* Colorway Header */}
                          <button
                            className="w-full flex items-center gap-2 p-2 pl-8 hover:bg-muted/30 transition-colors text-left"
                            onClick={() => toggleColorway(colorwayKey)}
                          >
                            {expandedColorways.has(colorwayKey) ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <div 
                              className="w-3 h-3 rounded-full border" 
                              style={{ 
                                background: colorway === 'Default' ? '#888' : undefined 
                              }}
                            />
                            <span className="text-sm">{colorway}</span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {images.length} angle(s)
                            </span>
                          </button>

                          {/* Images Grid */}
                          {expandedColorways.has(colorwayKey) && (
                            <div className="p-2 pl-12 grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                              {images.map((render) => (
                                <div
                                  key={render.id}
                                  className="group relative aspect-square rounded-md overflow-hidden border bg-muted/30 hover:border-primary transition-colors"
                                >
                                  <img
                                    src={render.imageUrl}
                                    alt={`${render.name} - ${render.colorway || 'Default'} - ${render.angle || 'view'}`}
                                    className="w-full h-full object-contain p-1"
                                  />
                                  
                                  {/* Angle label */}
                                  {render.angle && (
                                    <div className="absolute bottom-0 inset-x-0 p-0.5 bg-black/60 text-center">
                                      <span className="text-[8px] text-white">{render.angle}</span>
                                    </div>
                                  )}
                                  
                                  {/* Actions */}
                                  <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      variant="secondary"
                                      size="icon"
                                      className="h-5 w-5"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEdit(render)
                                      }}
                                    >
                                      <Pencil className="h-2.5 w-2.5" />
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      size="icon"
                                      className="h-5 w-5"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDelete(render)
                                      }}
                                    >
                                      <Trash2 className="h-2.5 w-2.5" />
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
          <span>{renders.length} total renders</span>
          <span>{productNames.length} products</span>
          <span>{renders.filter(r => r.source === 'frontify').length} from Frontify</span>
        </div>
      </CardContent>

      {/* Bulk Upload Dialog */}
      <Dialog open={bulkUploadOpen} onOpenChange={setBulkUploadOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Bulk Upload Product Renders
            </DialogTitle>
            <DialogDescription>
              Upload multiple images and let AI automatically detect and group colorways
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {/* Product Name */}
            <div className="space-y-2">
              <Label htmlFor="productName">Product Name *</Label>
              <Input
                id="productName"
                placeholder="e.g., MCL38"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                This will be the category name for all uploaded images
              </p>
            </div>

            {/* Drop Zone */}
            <div
              ref={dropZoneRef}
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">Drag & drop images here</p>
              <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              <p className="text-xs text-muted-foreground mt-2">PNG with transparency recommended</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => e.target.files && handleFilesSelected(e.target.files)}
            />

            {/* Pending Images by Colorway */}
            {pendingImages.length > 0 && (
              <div className="space-y-4">
                {/* Analysis Controls */}
                <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="font-medium">AI Colorway Detection</span>
                    {analysisComplete && (
                      <span className="text-xs text-green-500 flex items-center gap-1">
                        <Check className="h-3 w-3" />
                        Complete
                      </span>
                    )}
                    {analysisError && (
                      <span className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {analysisError}
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={analyzeImages}
                    disabled={isAnalyzing || pendingImages.length === 0}
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Analyzing... ({pendingImages.filter(i => i.confidence > 0).length}/{pendingImages.length})
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        {analysisComplete ? 'Re-analyze' : `Analyze ${pendingImages.length} images`}
                      </>
                    )}
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="text-sm text-muted-foreground">
                    {analysisComplete ? 'Detected Colorways' : 'Images to Upload'} ({pendingImages.length})
                  </h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setCreatingColorwayForImage(null)
                      setCreatingColorway(true)
                      setNewColorwayName('')
                    }}
                    className="h-7 text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    New Colorway
                  </Button>
                </div>

                {/* Create new colorway dialog */}
                {creatingColorway && (
                  <div className="border rounded-lg p-3 bg-muted/30 space-y-2">
                    <Label className="text-xs">Create New Colorway</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newColorwayName}
                        onChange={(e) => setNewColorwayName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            createNewColorway()
                          } else if (e.key === 'Escape') {
                            setCreatingColorway(false)
                          }
                        }}
                        placeholder="e.g., Monaco Blue"
                        className="h-7 text-xs"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={createNewColorway}
                        disabled={!newColorwayName.trim()}
                        className="h-7 text-xs"
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Create
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCreatingColorway(false)}
                        className="h-7 text-xs"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {Object.entries(pendingByColorway).map(([colorway, images]) => (
                  <div key={colorway} className="border rounded-lg p-3 space-y-3">
                    <div className="flex items-center gap-2 group/colorway">
                      <div className="w-4 h-4 rounded-full bg-muted border" />
                      {editingColorway === colorway ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            value={editingColorwayName}
                            onChange={(e) => setEditingColorwayName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                renameColorway(colorway, editingColorwayName)
                              } else if (e.key === 'Escape') {
                                setEditingColorway(null)
                              }
                            }}
                            className="h-7 text-sm flex-1"
                            autoFocus
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => renameColorway(colorway, editingColorwayName)}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setEditingColorway(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="font-medium text-sm">{colorway}</span>
                          <span className="text-xs text-muted-foreground">({images.length} images)</span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-0 group-hover/colorway:opacity-100 transition-opacity"
                            onClick={() => startEditingColorway(colorway)}
                            title="Rename colorway"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {images.map((img) => (
                        <div key={img.id} className="relative">
                          <div className="aspect-square rounded-md overflow-hidden border bg-muted/30">
                            <img
                              src={img.preview}
                              alt="Preview"
                              className="w-full h-full object-contain p-1"
                            />
                          </div>
                          
                          {/* Remove button */}
                          <Button
                            variant="destructive"
                            size="icon"
                            className="absolute -top-1 -right-1 h-5 w-5"
                            onClick={() => removePendingImage(img.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>

                          {/* Confidence indicator */}
                          {img.confidence > 0 && (
                            <div className={`absolute bottom-0 left-0 right-0 h-1 ${
                              img.confidence >= 0.8 ? 'bg-green-500' :
                              img.confidence >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                            }`} />
                          )}

                          {/* Editable fields */}
                          <div className="mt-1 space-y-1">
                            <div className="flex gap-1">
                              <Select
                                value={img.suggestedColorway}
                                onValueChange={(v) => {
                                  if (v === '__create_new__') {
                                    setCreatingColorwayForImage(img.id)
                                    setCreatingColorway(true)
                                    setNewColorwayName('')
                                  } else {
                                    updateImageColorway(img.id, v)
                                  }
                                }}
                              >
                                <SelectTrigger className="h-6 text-xs flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {allColorways.map((cw) => (
                                    <SelectItem key={cw} value={cw} className="text-xs">
                                      {cw}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="__create_new__" className="text-xs text-primary font-medium">
                                    + Create new colorway
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <Select
                              value={img.suggestedAngle}
                              onValueChange={(v) => updateImageAngle(img.id, v)}
                            >
                              <SelectTrigger className="h-6 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ANGLE_OPTIONS.map((angle) => (
                                  <SelectItem key={angle} value={angle} className="text-xs">
                                    {angle}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <DialogFooter className="border-t pt-4">
            <div className="flex items-center gap-2 mr-auto text-xs text-muted-foreground">
              {pendingImages.length > 0 && (
                <>
                  <Check className="h-3 w-3 text-green-500" />
                  {pendingImages.length} images ready
                </>
              )}
            </div>
            <Button variant="outline" onClick={() => setBulkUploadOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleBulkUpload}
              disabled={!productName.trim() || pendingImages.length === 0 || isAnalyzing || isUploading}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload {pendingImages.length} Images
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product Render</DialogTitle>
            <DialogDescription>
              Update the product render details
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Product Name *</Label>
              <Input
                id="edit-name"
                placeholder="e.g., MCL38"
                value={editForm.name}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-colorway">Colorway</Label>
              <Input
                id="edit-colorway"
                placeholder="e.g., Papaya Orange"
                value={editForm.colorway}
                onChange={(e) => setEditForm(prev => ({ ...prev, colorway: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-angle">Angle</Label>
              <Select
                value={editForm.angle || 'other'}
                onValueChange={(v) => setEditForm(prev => ({ ...prev, angle: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANGLE_OPTIONS.map((angle) => (
                    <SelectItem key={angle} value={angle}>
                      {angle}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={!editForm.name || saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product Render</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this render? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
