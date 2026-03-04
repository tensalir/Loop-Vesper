'use client'

import { Camera, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useSnapshots, type SnapshotOutput } from '@/hooks/useSnapshots'

export const SNAPSHOT_RAIL_MIME = 'application/x-loop-snapshot-image'

interface SnapshotRailProps {
  projectId: string
  onSelect?: (snapshot: SnapshotOutput) => void
  className?: string
}

/**
 * Compact rail showing captured video snapshots.
 * Replaces the PDF bucket rail in the video tab.
 * Click a snapshot to preview it, or drag into frame slots.
 */
export function SnapshotRail({ projectId, onSelect, className }: SnapshotRailProps) {
  const { snapshots, isLoading, deleteSnapshot } = useSnapshots(projectId)
  const [isExpanded, setIsExpanded] = useState(true)

  if (isLoading || snapshots.length === 0) return null

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-border/40 bg-muted/20 overflow-hidden transition-all duration-200 ease-out',
        isExpanded ? 'max-h-[200px]' : 'max-h-[28px]',
        className
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 min-h-[28px]">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Camera className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">Snapshots</span>
          <span className="text-muted-foreground/60">({snapshots.length})</span>
          {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        </button>
      </div>

      {isExpanded && (
        <div className="px-2 pb-1.5">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
            {snapshots.map((snap) => (
              <div
                key={snap.id}
                className="relative group/snap flex-shrink-0 flex flex-col items-center gap-0.5"
              >
                <button
                  type="button"
                  onClick={() => onSelect?.(snap)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(SNAPSHOT_RAIL_MIME, snap.fileUrl)
                    e.dataTransfer.setData('text/uri-list', snap.fileUrl)
                  }}
                  className={cn(
                    'relative rounded overflow-hidden',
                    'w-[32px] h-[32px] border border-border/30 hover:border-primary/50 transition-all duration-100',
                    'hover:shadow-sm hover:scale-105'
                  )}
                  title={snap.label || `Snapshot @ ${snap.timecodeMs != null ? (snap.timecodeMs / 1000).toFixed(1) + 's' : 'unknown'}`}
                >
                  <img
                    src={snap.fileUrl}
                    alt={snap.label || 'Snapshot'}
                    className="w-full h-full object-cover"
                    draggable={false}
                  />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteSnapshot.mutate(snap.generationId)
                  }}
                  className="absolute -top-1 -right-1 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover/snap:opacity-100 transition-opacity shadow-sm hover:bg-destructive hover:text-destructive-foreground z-10"
                  title="Remove snapshot"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
                <span className="text-[9px] leading-none text-muted-foreground/70 tabular-nums select-none">
                  {formatSnapshotTimecode(snap.timecodeMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function formatSnapshotTimecode(timecodeMs: number | null): string {
  if (typeof timecodeMs !== 'number' || timecodeMs < 0) return '--:--'
  const totalSeconds = timecodeMs / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`
  }
  return `0:${seconds.toFixed(1).padStart(4, '0')}`
}
