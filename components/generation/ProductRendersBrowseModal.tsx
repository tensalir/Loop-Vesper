'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Loader2, X } from 'lucide-react'
import Image from 'next/image'

interface ProductRender {
  id: string
  name: string
  colorway: string | null
  imageUrl: string
  source: 'local' | 'frontify'
}

interface ProductRendersBrowseModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectImage: (imageUrl: string) => void
}

export function ProductRendersBrowseModal({
  isOpen,
  onClose,
  onSelectImage,
}: ProductRendersBrowseModalProps) {
  const [renders, setRenders] = useState<ProductRender[]>([])
  const [productNames, setProductNames] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)

  const fetchRenders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('search', searchQuery)
      if (selectedProduct) params.set('name', selectedProduct)
      
      const response = await fetch(`/api/product-renders?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch renders')
      
      const data = await response.json()
      setRenders(data.renders || [])
      
      // Only update product names on initial load (not when filtering)
      if (!selectedProduct && !searchQuery) {
        setProductNames(data.productNames || [])
      }
    } catch (error) {
      console.error('Error fetching product renders:', error)
    } finally {
      setLoading(false)
    }
  }, [searchQuery, selectedProduct])

  useEffect(() => {
    if (isOpen) {
      fetchRenders()
    }
  }, [isOpen, fetchRenders])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isOpen) {
        fetchRenders()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, isOpen, fetchRenders])

  const handleSelectImage = (imageUrl: string) => {
    onSelectImage(imageUrl)
    onClose()
  }

  const handleClearFilters = () => {
    setSearchQuery('')
    setSelectedProduct(null)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Product Renders</DialogTitle>
          <DialogDescription>
            Select a product render to use as a reference image
          </DialogDescription>
        </DialogHeader>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by product name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter Chips */}
        {productNames.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(selectedProduct || searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            )}
            {productNames.map((name) => (
              <Button
                key={name}
                variant={selectedProduct === name ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedProduct(selectedProduct === name ? null : name)}
                className="h-7 text-xs"
              >
                {name}
              </Button>
            ))}
          </div>
        )}

        {/* Render Grid */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : renders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <div className="w-8 h-8 rounded-full bg-white/20" />
              </div>
              <p className="text-lg mb-2">No product renders found</p>
              <p className="text-sm">
                {searchQuery || selectedProduct
                  ? 'Try adjusting your search or filters'
                  : 'Ask an admin to upload product renders'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 p-2">
              {renders.map((render) => (
                <button
                  key={render.id}
                  onClick={() => handleSelectImage(render.imageUrl)}
                  className="group relative aspect-square rounded-lg overflow-hidden border-2 border-border hover:border-primary transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary bg-muted/30"
                  title={`${render.name}${render.colorway ? ` - ${render.colorway}` : ''}`}
                >
                  {/* Use img for external URLs, handling transparent PNGs */}
                  <img
                    src={render.imageUrl}
                    alt={`${render.name}${render.colorway ? ` - ${render.colorway}` : ''}`}
                    className="w-full h-full object-contain p-2"
                  />
                  
                  {/* Hover overlay with info */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors duration-200" />
                  <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <p className="text-white text-xs font-medium truncate">{render.name}</p>
                    {render.colorway && (
                      <p className="text-white/70 text-[10px] truncate">{render.colorway}</p>
                    )}
                  </div>
                  
                  {/* Source badge */}
                  {render.source === 'frontify' && (
                    <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-blue-500/80 text-white text-[8px] font-medium rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      Frontify
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

