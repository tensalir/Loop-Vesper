'use client'

import { useState, useRef } from 'react'
import { X, Loader2, Image as ImageIcon } from 'lucide-react'
import { usePinnedImages, type PinnedImage } from '@/hooks/usePinnedImages'
import { cn } from '@/lib/utils'

interface PinnedImagesRailProps {
  projectId: string
  onSelectImage: (imageUrl: string) => void
  className?: string
}

export function PinnedImagesRail({ projectId, onSelectImage, className }: PinnedImagesRailProps) {
  const { pinnedImages, isLoading, unpinImage, isUnpinning } = usePinnedImages(projectId)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set())

  const handleImageError = (imageId: string) => {
    setImageErrors((prev) => new Set(prev).add(imageId))
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading pins...</span>
      </div>
    )
  }

  if (pinnedImages.length === 0) {
    return null // Don't show anything if no pinned images
  }

  return (
    <div className={cn('flex items-center gap-1.5 overflow-x-auto scrollbar-none', className)}>
        {pinnedImages.map((image) => {
          const hasError = imageErrors.has(image.id)
          const isHovered = hoveredId === image.id
          
          return (
            <div
              key={image.id}
              className="relative group flex-shrink-0"
              onMouseEnter={() => setHoveredId(image.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Thumbnail button */}
              <button
                onClick={() => onSelectImage(image.imageUrl)}
                className={cn(
                  'w-9 h-9 rounded-lg overflow-hidden border transition-all duration-150',
                  'hover:scale-105 hover:border-border hover:shadow-md',
                  'focus:outline-none focus:ring-2 focus:ring-muted-foreground/30 focus:ring-offset-1',
                  'border-border/30 bg-muted/30'
                )}
                title={image.label || 'Click to use as reference'}
              >
                {hasError ? (
                  <div className="w-full h-full flex items-center justify-center bg-muted">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                ) : (
                  <img
                    src={image.imageUrl}
                    alt={image.label || 'Pinned reference'}
                    className="w-full h-full object-cover"
                    onError={() => handleImageError(image.id)}
                  />
                )}
              </button>

              {/* Unpin button - shows on hover */}
              {isHovered && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    unpinImage(image.id)
                  }}
                  disabled={isUnpinning}
                  className={cn(
                    'absolute -top-1 -right-1 w-4 h-4 rounded-full',
                    'bg-destructive/90 text-white flex items-center justify-center',
                    'hover:bg-destructive transition-colors shadow-sm',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                  title="Unpin image"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          )
        })}
    </div>
  )
}
