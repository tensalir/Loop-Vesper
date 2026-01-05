'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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
  angle: string | null
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

  // Perf/debug refs (debug mode)
  const openCountRef = useRef(0)
  const perfRef = useRef<{ openAt: number; fetchStartAt: number; fetchEndAt: number }>({
    openAt: 0,
    fetchStartAt: 0,
    fetchEndAt: 0,
  })
  const totalCountRef = useRef(0)
  const loadedCountRef = useRef(0)
  const firstLoadLoggedRef = useRef(false)
  const firstErrorLoggedRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return

    openCountRef.current += 1
    perfRef.current.openAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    loadedCountRef.current = 0
    totalCountRef.current = 0
    firstLoadLoggedRef.current = false
    firstErrorLoggedRef.current = false

    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'A',location:'ProductRendersBrowseModal.tsx:open',message:'Modal opened',data:{selectedProduct: selectedProduct || null, searchQueryLen: searchQuery.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
  }, [isOpen])

  const fetchRenders = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (searchQuery) params.set('search', searchQuery)
      if (selectedProduct) params.set('name', selectedProduct)

      perfRef.current.fetchStartAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'A',location:'ProductRendersBrowseModal.tsx:fetch-start',message:'Fetch /api/product-renders start',data:{params: params.toString()},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      
      const response = await fetch(`/api/product-renders?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch renders')
      
      const data = await response.json()
      const fetchedRenders = data.renders || []
      perfRef.current.fetchEndAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
      totalCountRef.current = fetchedRenders.length
      loadedCountRef.current = 0
      firstLoadLoggedRef.current = false
      firstErrorLoggedRef.current = false

      const sourceCounts = fetchedRenders.reduce(
        (acc: Record<string, number>, r: ProductRender) => {
          acc[r.source] = (acc[r.source] || 0) + 1
          return acc
        },
        {}
      )
      const uniqueProducts = new Set(fetchedRenders.map((r: ProductRender) => r.name)).size
      const fetchDurationMs = Math.max(0, perfRef.current.fetchEndAt - perfRef.current.fetchStartAt)

      // #region agent log
      fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'A',location:'ProductRendersBrowseModal.tsx:fetch-end',message:'Fetch /api/product-renders end',data:{status: response.status, durationMs: Math.round(fetchDurationMs), total: fetchedRenders.length, uniqueProducts, sourceCounts},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      console.log('[ProductRenders] Fetched renders:', fetchedRenders.length, fetchedRenders)
      setRenders(fetchedRenders)
      
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
            <div className="space-y-6 p-2">
              {(() => {
                // Group renders by product, then by colorway
                const grouped = renders.reduce((acc, render) => {
                  const productName = render.name
                  const colorway = render.colorway || 'Default'
                  
                  if (!acc[productName]) {
                    acc[productName] = {}
                  }
                  if (!acc[productName][colorway]) {
                    acc[productName][colorway] = []
                  }
                  acc[productName][colorway].push(render)
                  return acc
                }, {} as Record<string, Record<string, ProductRender[]>>)

                // Sort products alphabetically
                const sortedProducts = Object.keys(grouped).sort()

                return sortedProducts.map((productName, productIndex) => {
                  const colorways = grouped[productName]
                  const sortedColorways = Object.keys(colorways).sort()

                  return (
                    <div key={productName}>
                      {/* Product Header with Tag */}
                      <div className="flex items-center gap-3 mb-3">
                        <div className="px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium">
                          {productName}
                        </div>
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-xs text-muted-foreground">
                          {Object.values(colorways).flat().length} render{Object.values(colorways).flat().length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      {/* Colorway Groups */}
                      <div className="space-y-4">
                        {sortedColorways.map((colorway) => {
                          const colorwayRenders = colorways[colorway]
                          return (
                            <div key={`${productName}-${colorway}`} className="space-y-2">
                              {/* Colorway Label (subtle) */}
                              <p className="text-xs text-muted-foreground px-1">
                                {colorway} ({colorwayRenders.length})
                              </p>
                              
                              {/* Renders Grid for this colorway */}
                              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
                                {colorwayRenders.map((render) => (
                                  <button
                                    key={render.id}
                                    onClick={() => handleSelectImage(render.imageUrl)}
                                    className="group relative aspect-square rounded-lg overflow-hidden border-2 border-border hover:border-primary transition-all duration-200 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary bg-muted/30"
                                    title={`${render.name}${render.colorway ? ` - ${render.colorway}` : ''}`}
                                  >
                                    {/* Thumbnail Image */}
                                    {render.imageUrl ? (
                                      <>
                                        <img
                                          src={render.imageUrl}
                                          alt={`${render.name}${render.colorway ? ` - ${render.colorway}` : ''}`}
                                          className="w-full h-full object-contain p-2 bg-white/5"
                                          loading="lazy"
                                          style={{ minHeight: '100%', minWidth: '100%' }}
                                          onError={(e) => {
                                            console.error('[ProductRenders] Failed to load image:', render.imageUrl, render)

                                            if (!firstErrorLoggedRef.current) {
                                              firstErrorLoggedRef.current = true
                                              let safe: any = { urlLen: render.imageUrl.length }
                                              try {
                                                const u = new URL(render.imageUrl)
                                                safe = { host: u.host, pathSuffix: u.pathname.slice(-80) }
                                              } catch {}
                                              // #region agent log
                                              fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'E',location:'ProductRendersBrowseModal.tsx:img-error',message:'Image failed to load (first error)',data:{renderId: render.id, source: render.source, safeUrl: safe},timestamp:Date.now()})}).catch(()=>{});
                                              // #endregion
                                            }

                                            e.currentTarget.style.display = 'none'
                                            const placeholder = e.currentTarget.nextElementSibling as HTMLElement
                                            if (placeholder) {
                                              placeholder.style.display = 'flex'
                                            }
                                          }}
                                          onLoad={(e) => {
                                            console.log('[ProductRenders] Image loaded successfully:', render.imageUrl)

                                            // Timing measurements
                                            const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now()
                                            loadedCountRef.current += 1
                                            const loaded = loadedCountRef.current
                                            const total = totalCountRef.current || renders.length
                                            const sinceFetchEndMs = Math.max(0, nowPerf - perfRef.current.fetchEndAt)
                                            const sinceOpenMs = Math.max(0, nowPerf - perfRef.current.openAt)

                                            let safe: any = { urlLen: render.imageUrl.length }
                                            try {
                                              const u = new URL(render.imageUrl)
                                              safe = { host: u.host, pathSuffix: u.pathname.slice(-80) }
                                            } catch {}

                                            if (!firstLoadLoggedRef.current) {
                                              firstLoadLoggedRef.current = true
                                              // #region agent log
                                              fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'B',location:'ProductRendersBrowseModal.tsx:first-img-load',message:'First image loaded',data:{renderId: render.id, source: render.source, loaded, total, sinceFetchEndMs: Math.round(sinceFetchEndMs), sinceOpenMs: Math.round(sinceOpenMs), safeUrl: safe},timestamp:Date.now()})}).catch(()=>{});
                                              // #endregion
                                            }

                                            if (loaded === Math.min(6, total)) {
                                              // #region agent log
                                              fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'D',location:'ProductRendersBrowseModal.tsx:six-img-load',message:'Six images loaded',data:{loaded, total, sinceFetchEndMs: Math.round(sinceFetchEndMs), sinceOpenMs: Math.round(sinceOpenMs)},timestamp:Date.now()})}).catch(()=>{});
                                              // #endregion
                                            }

                                            if (loaded === Math.min(12, total)) {
                                              // #region agent log
                                              fetch('http://127.0.0.1:7246/ingest/3373e882-99ce-4b60-8658-40ddbcfb2d4b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:`product-renders-open-${openCountRef.current}`,hypothesisId:'D',location:'ProductRendersBrowseModal.tsx:twelve-img-load',message:'Twelve images loaded',data:{loaded, total, sinceFetchEndMs: Math.round(sinceFetchEndMs), sinceOpenMs: Math.round(sinceOpenMs)},timestamp:Date.now()})}).catch(()=>{});
                                              // #endregion
                                            }

                                            // Hide placeholder when image loads successfully
                                            const placeholder = e.currentTarget.nextElementSibling as HTMLElement
                                            if (placeholder) {
                                              placeholder.style.display = 'none'
                                            }
                                          }}
                                        />
                                        {/* Placeholder for loading/failed images */}
                                        <div className="image-placeholder absolute inset-0 items-center justify-center bg-muted/50 flex" style={{ display: 'flex' }}>
                                          <div className="text-center p-2">
                                            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-muted-foreground" />
                                            <p className="text-xs text-muted-foreground font-medium">{render.name}</p>
                                            {render.colorway && (
                                              <p className="text-[10px] text-muted-foreground/70">{render.colorway}</p>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="absolute inset-0 items-center justify-center bg-muted/50 flex">
                                        <div className="text-center p-2">
                                          <p className="text-xs text-muted-foreground font-medium">{render.name}</p>
                                          {render.colorway && (
                                            <p className="text-[10px] text-muted-foreground/70">{render.colorway}</p>
                                          )}
                                          <p className="text-[10px] text-red-500/70 mt-1">No image URL</p>
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Hover overlay with info */}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/60 transition-colors duration-200" />
                                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                      {render.angle && (
                                        <p className="text-white/90 text-[9px] font-medium mb-0.5">{render.angle}</p>
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
                            </div>
                          )
                        })}
                      </div>

                      {/* Separator line between products (except last) */}
                      {productIndex < sortedProducts.length - 1 && (
                        <div className="mt-6 h-px bg-border" />
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

