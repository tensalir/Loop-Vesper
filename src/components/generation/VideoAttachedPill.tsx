'use client'

import { Video, Loader2 } from 'lucide-react'
import { useVideoIterations } from '@/hooks/useVideoIterations'

interface VideoAttachedPillProps {
  /** The source image output ID */
  outputId: string
  /** Click handler — usually opens the convert-to-video flow / video list */
  onClick?: () => void
}

/**
 * Subtle pill rendered above the top-right corner of an image card to
 * indicate that one or more videos have been generated from this image.
 *
 * Hidden when there are no linked videos (and none processing).
 */
export function VideoAttachedPill({ outputId, onClick }: VideoAttachedPillProps) {
  const { count, hasProcessing } = useVideoIterations(outputId, {
    limit: 1,
    enabled: true,
  })

  const hasVideos = count > 0
  if (!hasVideos && !hasProcessing) return null

  const label = hasProcessing
    ? count > 0
      ? `${count} video${count !== 1 ? 's' : ''} · generating`
      : 'Video generating'
    : `${count} video${count !== 1 ? 's' : ''}`

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={`
        absolute -top-2.5 right-2 z-20
        inline-flex items-center gap-1
        h-5 px-1.5 rounded-full
        text-[10px] font-medium leading-none
        bg-background/90 backdrop-blur-sm border border-primary/30
        text-foreground/80 hover:text-foreground
        shadow-sm transition-all hover:scale-[1.03] hover:border-primary/60
        ${hasProcessing ? 'animate-pulse' : ''}
      `}
      title={hasProcessing ? 'Video generating from this image' : `${count} video${count !== 1 ? 's' : ''} attached`}
      aria-label={label}
    >
      {hasProcessing ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
      ) : (
        <Video className="h-2.5 w-2.5 text-primary" />
      )}
      <span>{label}</span>
    </button>
  )
}
