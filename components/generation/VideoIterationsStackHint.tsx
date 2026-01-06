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
 * Visual indicator showing video iterations exist for an image.
 * 
 * Due to CSS overflow limitations in scrollable containers, we show a 
 * glowing border effect + badge instead of actual stacked cards behind.
 * The badge is clickable to open the full overlay with all iterations.
 */
export function VideoIterationsStackHint({ outputId, onClick }: VideoIterationsStackHintProps) {
  const { iterations, count, hasProcessing } = useVideoIterations(outputId, {
    limit: 1,
    enabled: true,
  })
  
  // Don't render if no iterations
  if (count === 0) return null
  
  return (
    <>
      {/* Glow effect ring around the card - indicates video iterations exist */}
      <div 
        className="absolute -inset-1 rounded-2xl pointer-events-none"
        style={{
          background: `linear-gradient(135deg, hsl(var(--primary) / 0.5) 0%, hsl(var(--primary) / 0.3) 50%, hsl(var(--primary) / 0.5) 100%)`,
          boxShadow: hasProcessing 
            ? '0 0 20px hsl(var(--primary) / 0.5), inset 0 0 15px hsl(var(--primary) / 0.2)' 
            : '0 0 12px hsl(var(--primary) / 0.4)',
          zIndex: -1,
        }}
      />
      
      {/* Animated pulse effect when processing */}
      {hasProcessing && (
        <div 
          className="absolute -inset-2 rounded-2xl pointer-events-none animate-pulse"
          style={{
            background: 'transparent',
            boxShadow: '0 0 30px hsl(var(--primary) / 0.3)',
            zIndex: -2,
          }}
        />
      )}
      
      {/* Badge showing count and status - positioned at bottom-right corner */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClick?.()
        }}
        className="absolute -bottom-2 -right-2 cursor-pointer"
        style={{ zIndex: 50 }}
        title={`${count} video iteration${count !== 1 ? 's' : ''} - Click to view`}
      >
        <div className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold
          shadow-xl backdrop-blur-md
          transition-all hover:scale-110 hover:shadow-2xl
          ${hasProcessing 
            ? 'bg-primary text-primary-foreground animate-pulse' 
            : 'bg-background text-foreground border-2 border-primary'
          }
        `}>
          {hasProcessing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Video className="h-3.5 w-3.5 text-primary" />
          )}
          <span>{count}</span>
        </div>
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
  
  if (count === 0) return null
  
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium
        transition-colors
        ${hasProcessing 
          ? 'bg-primary/20 text-primary hover:bg-primary/30' 
          : 'bg-muted/50 text-muted-foreground hover:bg-muted'
        }
      `}
      title={`${count} video${count !== 1 ? 's' : ''} generated from this image`}
    >
      {hasProcessing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Video className="h-3 w-3" />
      )}
      <span>{count}</span>
    </button>
  )
}

