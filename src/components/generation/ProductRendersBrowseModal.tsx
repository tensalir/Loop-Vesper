'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Search, Loader2, X, RefreshCw } from 'lucide-react'
import {
  useProductRenders,
  useProductNames,
  useGroupedRenders,
  useOrganizedProductNames,
  usePrefetchProductRenders,
  isDeprecatedProduct,
  SENSEWEAR_PRODUCTS,
  type ProductRender,
} from '@/hooks/useProductRenders'

// Available render type filters
const RENDER_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'single', label: 'Single' },
  { value: 'pair', label: 'Pair' },
  { value: 'case', label: 'Case' },
] as const

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
  // Local UI state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<string>('single') // Default to Single - most commonly used

  // Check if selected product is a Sensewear product (View Type filter doesn't apply to Sensewear)
  const isSensewearSelected = selectedProduct ? SENSEWEAR_PRODUCTS.includes(selectedProduct) : false
  
  // Don't apply type filter for Sensewear products
  const effectiveType = isSensewearSelected ? undefined : selectedType

  // React Query hooks for data fetching with caching
  const {
    data,
    isLoading: isInitialLoading,
    isFetching,
    isPlaceholderData,
  } = useProductRenders({
    search: searchQuery,
    name: selectedProduct || undefined,
    type: effectiveType,
    enabled: isOpen,
  })

  // Get stable product names list from unfiltered query
  const allProductNames = useProductNames(isOpen)
  
  // Use the product names from unfiltered query, fallback to current query's names
  const productNames = allProductNames.length > 0 ? allProductNames : (data?.productNames || [])

  // Memoized grouping of renders
  const { grouped, sortedProducts } = useGroupedRenders(data?.renders)
  
  // Memoized organization of product names into categories
  const { sensewearProducts, earplugProductsList, otherProducts } = useOrganizedProductNames(productNames)

  // Prefetch hook for hover optimization
  const prefetch = usePrefetchProductRenders()

  const handleSelectImage = (imageUrl: string) => {
    onSelectImage(imageUrl)
    onClose()
  }

  const handleClearFilters = () => {
    setSearchQuery('')
    setSelectedProduct(null)
    setSelectedType('single')
  }

  const hasActiveFilters = selectedProduct || searchQuery || selectedType !== 'single'
  
  // Distinguish between initial load and background refetch
  const showInitialLoader = isInitialLoading && !data
  const showUpdatingIndicator = isFetching && !isInitialLoading

  // Handle product chip click with prefetch on hover
  const handleProductHover = (productName: string) => {
    // Don't apply type filter for Sensewear products
    const typeForProduct = SENSEWEAR_PRODUCTS.includes(productName) ? undefined : selectedType
    prefetch({ name: productName, type: typeForProduct })
  }

  // Handle type change with prefetch on hover (only for non-Sensewear products)
  const handleTypeHover = (type: string) => {
    if (!isSensewearSelected) {
      prefetch({ name: selectedProduct || undefined, type })
    }
  }

  const renders = data?.renders || []
  const filteredRenders = renders.filter(r => !isDeprecatedProduct(r.name))

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Product Renders</DialogTitle>
              <DialogDescription>
                Select a product render to use as a reference image
              </DialogDescription>
            </div>
            {/* Subtle updating indicator */}
            {showUpdatingIndicator && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                <span>Updating...</span>
              </div>
            )}
          </div>
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

        {/* Product Category Chips */}
        <div className="space-y-2">
          {/* Clear filters button */}
          {hasActiveFilters && (
            <div className="flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            </div>
          )}

          {/* Earplugs Row */}
          {earplugProductsList.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20">Earplugs:</span>
              {earplugProductsList.map((name) => (
                <Button
                  key={name}
                  variant={selectedProduct === name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedProduct(selectedProduct === name ? null : name)}
                  onMouseEnter={() => handleProductHover(name)}
                  className="h-7 text-xs"
                >
                  {name}
                </Button>
              ))}
            </div>
          )}

          {/* Sensewear Row */}
          {sensewearProducts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20">Sensewear:</span>
              {sensewearProducts.map((name) => (
                <Button
                  key={name}
                  variant={selectedProduct === name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedProduct(selectedProduct === name ? null : name)}
                  onMouseEnter={() => handleProductHover(name)}
                  className="h-7 text-xs"
                >
                  {name}
                </Button>
              ))}
            </div>
          )}

          {/* Other Products (if any exist outside defined categories) */}
          {otherProducts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20">Other:</span>
              {otherProducts.map((name) => (
                <Button
                  key={name}
                  variant={selectedProduct === name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedProduct(selectedProduct === name ? null : name)}
                  onMouseEnter={() => handleProductHover(name)}
                  className="h-7 text-xs"
                >
                  {name}
                </Button>
              ))}
            </div>
          )}

          {/* Type Filter Row - Only show for Earplugs (not Sensewear) */}
          {!isSensewearSelected && (
            <div className="flex items-center gap-3 pt-3 mt-1 border-t border-border/30">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-20">View Type:</span>
              <Tabs value={selectedType} onValueChange={setSelectedType} className="w-auto">
                <TabsList className="h-8 bg-muted/50 p-0.5">
                  {RENDER_TYPE_OPTIONS.map((option) => (
                    <TabsTrigger
                      key={option.value}
                      value={option.value}
                      onMouseEnter={() => handleTypeHover(option.value)}
                      className="h-7 px-4 text-[11px] data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>

        {/* Render Grid */}
        <div className="flex-1 overflow-y-auto">
          {showInitialLoader ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRenders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <div className="w-8 h-8 rounded-full bg-white/20" />
              </div>
              <p className="text-lg mb-2">No product renders found</p>
              <p className="text-sm">
                {hasActiveFilters
                  ? 'Try adjusting your search or filters'
                  : 'Ask an admin to upload product renders'}
              </p>
            </div>
          ) : (
            <div className={`space-y-6 p-2 ${isPlaceholderData ? 'opacity-60' : ''} transition-opacity duration-150`}>
              {sortedProducts.map((productName, productIndex) => {
                const colorways = grouped[productName]
                if (!colorways) return null
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
                                <RenderThumbnail
                                  key={render.id}
                                  render={render}
                                  onSelect={handleSelectImage}
                                />
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
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Memoized thumbnail component to reduce re-renders when the grid updates
 */
function RenderThumbnail({
  render,
  onSelect,
}: {
  render: ProductRender
  onSelect: (imageUrl: string) => void
}) {
  return (
    <button
      onClick={() => onSelect(render.imageUrl)}
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
              e.currentTarget.style.display = 'none'
              const placeholder = e.currentTarget.nextElementSibling as HTMLElement
              if (placeholder) {
                placeholder.style.display = 'flex'
              }
            }}
            onLoad={(e) => {
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
  )
}
