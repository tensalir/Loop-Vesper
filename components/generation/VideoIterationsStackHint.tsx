'use client'

import { Video, Loader2 } from 'lucide-react'
import { useVideoIterations } from '@/hooks/useVideoIterations'

interface VideoIterationsStackHintProps {
  /** The source image output ID */
  outputId: string
  /** Callback when stack is clicked */
  onClick?: () => void
}

/**
 * Video button + stacked card effect for an image output.
 * 
 * - Always renders a video icon (bottom-right)
 * - When no videos exist: icon appears on hover only (white)
 * - When videos exist: icon is always visible (green with glow) + stacked layers behind card
 */
export function VideoIterationsStackHint({ outputId, onClick }: VideoIterationsStackHintProps) {
  const { count, hasProcessing } = useVideoIterations(outputId, {
    limit: 1,
    enabled: true,
  })
  
  const hasVideos = count > 0
  // Show stack effect when videos exist OR when one is currently processing
  const showStackEffect = hasVideos || hasProcessing
  
  // Number of stacked layers to show (cosmetic, not based on actual count)
  const stackLayers = 3
  
  return (
    <>
      {/* Stacked layers wrapper - show when videos exist OR when processing */}
      {showStackEffect && (
        <div 
          className={`absolute inset-0 pointer-events-none overflow-visible ${hasProcessing ? 'animate-stack-pulse' : ''}`} 
          style={{ zIndex: 0 }}
        >
          {/* Stacked card layers - cosmetic effect positioned behind the image card, only on right side */}
          {Array.from({ length: stackLayers }).map((_, index) => {
            const layerIndex = stackLayers - index - 1 // Reverse order so first layer is furthest back
            const offset = (layerIndex + 1) * 8 // 8px, 16px, 24px offsets
            const verticalOffset = offset * 0.3 // Slight vertical offset for natural stacking
            // Slightly brighter when processing to make glow more noticeable
            const baseOpacity = hasProcessing ? 0.2 : 0.15
            const opacity = baseOpacity - (layerIndex * 0.03)
            const scale = 1 - (layerIndex * 0.02) // Slightly smaller for depth
            
            return (
              <div
                key={`stack-layer-${layerIndex}`}
                className="absolute pointer-events-none rounded-xl transition-all duration-500"
                style={{
                  // Full-width layer shifted right so only the extra portion peeks out (no hard cut)
                  top: `${verticalOffset}px`,
                  left: `${offset}px`,
                  right: `${-offset}px`,
                  bottom: `${-verticalOffset}px`,
                  zIndex: -10 - layerIndex, // Ensure they're behind everything
                  transform: `scale(${scale})`,
                  background: `linear-gradient(to left,
                    hsl(var(--primary) / ${opacity * 0.35}) 0%,
                    hsl(var(--primary) / ${opacity * 0.18}) 45%,
                    transparent 85%
                  )`,
                  border: `1.5px solid hsl(var(--primary) / ${opacity * 0.8})`,
                  borderLeft: '0',
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                  boxShadow: `
                    ${offset}px 0 ${offset * 2}px -${offset * 0.65}px hsl(var(--primary) / ${opacity * 0.55}),
                    inset 10px 0 ${12 + layerIndex * 2}px hsl(var(--primary) / ${opacity * 0.25})
                  `,
                  backdropFilter: 'blur(1px)',
                }}
              />
            )
          })}
        </div>
      )}
      
      {/* Video icon button - hover-only when no videos/processing, always visible when videos exist or processing */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
        className={`
          absolute bottom-2 right-2 pointer-events-auto transition-all hover:scale-110
          ${showStackEffect ? '' : 'opacity-0 group-hover:opacity-100'}
        `}
        style={{ zIndex: 10 }}
        title={hasProcessing ? 'Video generating...' : hasVideos ? `${count} video${count !== 1 ? 's' : ''} - Click to view` : 'Convert to video'}
      >
        {hasProcessing ? (
          <Loader2 
            className="h-4 w-4 text-primary animate-spin"
            style={{
              filter: 'drop-shadow(0 0 6px hsl(var(--primary) / 0.6)) drop-shadow(0 0 12px hsl(var(--primary) / 0.3))',
            }}
          />
        ) : hasVideos ? (
          <Video 
            className="h-4 w-4 text-primary"
            style={{
              filter: 'drop-shadow(0 0 6px hsl(var(--primary) / 0.5)) drop-shadow(0 0 10px hsl(var(--primary) / 0.25))',
            }}
          />
        ) : (
          <Video className="h-4 w-4 text-white" />
        )}
      </button>
    </>
  )
}

/**
 * Lightweight version that just shows a badge, no stacked layers.
 * Use this when you want minimal visual overhead.
 */
export function VideoIterationsBadge({ outputId, onClick }: VideoIterationsStackHintProps) {
  const { count, hasProcessing } = useVideoIterations(outputId, {
    limit: 1,
    enabled: true,
  })
  
  // Show badge when videos exist OR when processing
  if (count === 0 && !hasProcessing) return null
  
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium
        transition-colors
        ${hasProcessing 
          ? 'bg-primary/20 text-primary hover:bg-primary/30 animate-pulse' 
          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
        }
      `}
      title={hasProcessing ? 'Video generating...' : `${count} video${count !== 1 ? 's' : ''} generated from this image`}
    >
      {hasProcessing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Video className="h-3 w-3" />
      )}
      <span>{hasProcessing && count === 0 ? '...' : count}</span>
    </button>
  )
}

