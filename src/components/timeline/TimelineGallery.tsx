'use client'

import { useRef, useState, useCallback } from 'react'
import { Eye, GripHorizontal, Image as ImageIcon, Video, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTimelineOutputs, type ProjectOutput } from '@/hooks/useTimelineOutputs'

const TIMELINE_GALLERY_DRAG_MIME = 'application/x-timeline-gallery-item'

interface TimelineGalleryProps {
  projectId: string
  onPreview?: (output: ProjectOutput) => void
  onInsert?: (output: ProjectOutput) => void
  className?: string
}

export function TimelineGallery({ projectId, onPreview, onInsert, className }: TimelineGalleryProps) {
  const { outputs, isLoading, hasMore, fetchMore } = useTimelineOutputs(projectId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isExpanded, setIsExpanded] = useState(true)

  const handleScrollEnd = useCallback(() => {
    const el = scrollRef.current
    if (!el || !hasMore) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    if (scrollWidth - scrollLeft - clientWidth < 200) {
      fetchMore()
    }
  }, [hasMore, fetchMore])

  if (isLoading && outputs.length === 0) return null
  if (outputs.length === 0) return null

  return (
    <div className={cn(
      'flex flex-col rounded-lg border border-border/30 bg-card/60 overflow-hidden transition-all duration-200 ease-out',
      isExpanded ? 'max-h-[120px]' : 'max-h-[28px]',
      className,
    )}>
      <div className="flex items-center gap-1.5 px-2.5 py-1 min-h-[28px]">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <GripHorizontal className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">Assets</span>
          <span className="text-muted-foreground/60">({outputs.length})</span>
          {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="px-2 pb-1.5">
          <div
            ref={scrollRef}
            onScroll={handleScrollEnd}
            className="flex items-center gap-1.5 asset-rail-scroll py-0.5"
          >
            {outputs.map((output) => (
              <GalleryTile
                key={output.id}
                output={output}
                onPreview={onPreview}
                onInsert={onInsert}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function GalleryTile({
  output,
  onPreview,
  onInsert,
}: {
  output: ProjectOutput
  onPreview?: (output: ProjectOutput) => void
  onInsert?: (output: ProjectOutput) => void
}) {
  const isVideo = output.fileType === 'video'
  const durationLabel = isVideo && output.duration
    ? `${output.duration.toFixed(1)}s`
    : null

  return (
    <div className="relative group/tile flex-shrink-0 flex flex-col items-center gap-0.5">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copy'
          e.dataTransfer.setData(TIMELINE_GALLERY_DRAG_MIME, JSON.stringify({
            id: output.id,
            fileUrl: output.fileUrl,
            fileType: output.fileType,
            duration: output.duration,
          }))
          e.dataTransfer.setData('text/uri-list', output.fileUrl)
        }}
        onDoubleClick={() => onInsert?.(output)}
        className={cn(
          'relative rounded overflow-hidden cursor-grab active:cursor-grabbing',
          'w-[56px] h-[56px] border border-border/30 hover:border-primary/50 transition-all duration-100',
          'hover:shadow-sm hover:scale-105',
        )}
        title={output.prompt || (isVideo ? 'Video' : 'Image')}
      >
        {isVideo ? (
          <video
            src={output.fileUrl}
            className="w-full h-full object-cover pointer-events-none"
            muted
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={output.fileUrl}
            alt={output.prompt || 'Generated image'}
            className="w-full h-full object-cover"
            draggable={false}
          />
        )}

        {/* Type badge */}
        <div className="absolute top-0.5 left-0.5 p-0.5 rounded bg-black/50">
          {isVideo
            ? <Video className="h-2 w-2 text-white/80" />
            : <ImageIcon className="h-2 w-2 text-white/80" />
          }
        </div>

        {/* Duration badge for videos */}
        {durationLabel && (
          <div className="absolute bottom-0.5 right-0.5 px-1 py-0.5 rounded bg-black/60 text-[8px] text-white/80 font-mono tabular-nums leading-none">
            {durationLabel}
          </div>
        )}

        {/* Preview button on hover */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPreview?.(output) }}
          className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/50 text-white/80 hover:bg-primary/80 hover:text-primary-foreground opacity-0 group-hover/tile:opacity-100 transition-opacity z-10"
          title="Preview"
        >
          <Eye className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  )
}

export { TIMELINE_GALLERY_DRAG_MIME }
