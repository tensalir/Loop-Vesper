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
  RefreshCw
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

interface ProductRender {
  id: string
  name: string
  colorway: string | null
  imageUrl: string
  storagePath: string | null
  source: 'local' | 'frontify'
  frontifyId: string | null
  createdAt: string
  updatedAt: string
}

export function RendersManagementSettings() {
  const [renders, setRenders] = useState<ProductRender[]>([])
  const [productNames, setProductNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  
  // Upload dialog state
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
  const [uploadForm, setUploadForm] = useState({
    name: '',
    colorway: '',
    image: null as string | null,
    imagePreview: null as string | null,
  })
  const [uploading, setUploading] = useState(false)
  
  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingRender, setEditingRender] = useState<ProductRender | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    colorway: '',
    image: null as string | null,
    imagePreview: null as string | null,
  })
  const [saving, setSaving] = useState(false)
  
  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingRender, setDeletingRender] = useState<ProductRender | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const editFileInputRef = useRef<HTMLInputElement>(null)

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

  // Filter renders
  const filteredRenders = renders.filter(render => {
    const matchesSearch = !searchQuery || 
      render.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      render.colorway?.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesProduct = !selectedProduct || render.name === selectedProduct
    
    return matchesSearch && matchesProduct
  })

  // Handle file selection for upload
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, isEdit = false) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Read file as base64
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result as string
      if (isEdit) {
        setEditForm(prev => ({ 
          ...prev, 
          image: base64,
          imagePreview: base64
        }))
      } else {
        setUploadForm(prev => ({ 
          ...prev, 
          image: base64,
          imagePreview: base64
        }))
      }
    }
    reader.readAsDataURL(file)
  }

  // Handle upload
  const handleUpload = async () => {
    if (!uploadForm.name || !uploadForm.image) return

    setUploading(true)
    try {
      const response = await fetch('/api/admin/product-renders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: uploadForm.name,
          colorway: uploadForm.colorway || null,
          image: uploadForm.image,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to upload')
      }

      // Reset form and close dialog
      setUploadForm({ name: '', colorway: '', image: null, imagePreview: null })
      setUploadDialogOpen(false)
      
      // Refresh list
      fetchRenders()
    } catch (error: any) {
      console.error('Upload error:', error)
      alert(error.message || 'Failed to upload render')
    } finally {
      setUploading(false)
    }
  }

  // Handle edit
  const handleEdit = (render: ProductRender) => {
    setEditingRender(render)
    setEditForm({
      name: render.name,
      colorway: render.colorway || '',
      image: null,
      imagePreview: render.imageUrl,
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
          image: editForm.image, // Only if changed
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save')
      }

      // Reset form and close dialog
      setEditingRender(null)
      setEditForm({ name: '', colorway: '', image: null, imagePreview: null })
      setEditDialogOpen(false)
      
      // Refresh list
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

      // Close dialog and refresh
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
              Manage product renders for quick access during generation
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
              onClick={() => setUploadDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Render
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
              placeholder="Search renders..."
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
              {productNames.map((name) => (
                <Button
                  key={name}
                  variant={selectedProduct === name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedProduct(selectedProduct === name ? null : name)}
                  className="h-8 text-xs"
                >
                  {name}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Renders Grid */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRenders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <Upload className="h-6 w-6" />
            </div>
            <p className="text-sm">No product renders found</p>
            <p className="text-xs">Click "Add Render" to upload your first product render</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filteredRenders.map((render) => (
              <div
                key={render.id}
                className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted/30 hover:border-primary transition-colors"
              >
                <img
                  src={render.imageUrl}
                  alt={`${render.name}${render.colorway ? ` - ${render.colorway}` : ''}`}
                  className="w-full h-full object-contain p-2"
                />
                
                {/* Info overlay */}
                <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-white text-xs font-medium truncate">{render.name}</p>
                  {render.colorway && (
                    <p className="text-white/70 text-[10px] truncate">{render.colorway}</p>
                  )}
                </div>
                
                {/* Source badge */}
                {render.source === 'frontify' && (
                  <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-blue-500/80 text-white text-[8px] font-medium rounded">
                    Frontify
                  </div>
                )}
                
                {/* Action buttons - show on hover */}
                <div className="absolute top-1 left-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleEdit(render)}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleDelete(render)}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
          <span>{renders.length} total renders</span>
          <span>{renders.filter(r => r.source === 'local').length} local</span>
          <span>{renders.filter(r => r.source === 'frontify').length} from Frontify</span>
        </div>
      </CardContent>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product Render</DialogTitle>
            <DialogDescription>
              Upload a new product render image
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Product Name *</Label>
              <Input
                id="name"
                placeholder="e.g., MCL38"
                value={uploadForm.name}
                onChange={(e) => setUploadForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="colorway">Colorway</Label>
              <Input
                id="colorway"
                placeholder="e.g., Papaya Orange"
                value={uploadForm.colorway}
                onChange={(e) => setUploadForm(prev => ({ ...prev, colorway: e.target.value }))}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Image *</Label>
              {uploadForm.imagePreview ? (
                <div className="relative aspect-video w-full bg-muted/30 rounded-lg overflow-hidden border">
                  <img
                    src={uploadForm.imagePreview}
                    alt="Preview"
                    className="w-full h-full object-contain p-4"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-7 w-7"
                    onClick={() => setUploadForm(prev => ({ ...prev, image: null, imagePreview: null }))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="aspect-video w-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Click to upload image</p>
                  <p className="text-xs text-muted-foreground">PNG with transparency recommended</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e, false)}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleUpload}
              disabled={!uploadForm.name || !uploadForm.image || uploading}
            >
              {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upload
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
              <Label>Image</Label>
              {editForm.imagePreview ? (
                <div className="relative aspect-video w-full bg-muted/30 rounded-lg overflow-hidden border">
                  <img
                    src={editForm.imagePreview}
                    alt="Preview"
                    className="w-full h-full object-contain p-4"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 right-2"
                    onClick={() => editFileInputRef.current?.click()}
                  >
                    <Upload className="h-3 w-3 mr-1" />
                    Replace
                  </Button>
                </div>
              ) : (
                <div
                  className="aspect-video w-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors"
                  onClick={() => editFileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">Click to upload new image</p>
                </div>
              )}
              <input
                ref={editFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e, true)}
              />
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
              Are you sure you want to delete "{deletingRender?.name}
              {deletingRender?.colorway ? ` - ${deletingRender.colorway}` : ''}"? 
              This action cannot be undone.
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

