'use client'

import { useMemo, useState } from 'react'
import { Camera, Paintbrush, ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GenerationWithOutputs } from '@/types/generation'

interface BranchItem {
  outputId: string
  fileUrl: string
  sourceKind: 'original' | 'snapshot' | 'edited' | null
  label: string | null
}

interface ImageBranchStackProps {
  /** The output currently displayed as the primary (large) image */
  primaryOutputId: string
  /** All generations in the session — used to discover branches */
  generations: GenerationWithOutputs[]
  /** Called when user clicks a branch thumbnail to swap it into primary position */
  onSwap?: (outputId: string, fileUrl: string) => void
  className?: string
}

const kindIcons: Record<string, typeof Camera> = {
  snapshot: Camera,
  edited: Paintbrush,
  original: ImageIcon,
}

/**
 * Vertical thumbnail stack shown to the right of an image card.
 * Groups image outputs that share a lineage root (sourceRootOutputId).
 * Clicking a thumbnail swaps it into the primary card position.
 */
export function ImageBranchStack({
  primaryOutputId,
  generations,
  onSwap,
  className,
}: ImageBranchStackProps) {
  // Build branch siblings: outputs whose sourceRootOutputId matches the primaryOutputId
  const branches = useMemo(() => {
    const items: BranchItem[] = []
    for (const gen of generations) {
      const params = gen.parameters as any
      const rootId = params?.sourceRootOutputId
      if (!rootId || rootId !== primaryOutputId) continue
      // Only image branches
      for (const output of gen.outputs || []) {
        if (output.fileType !== 'image') continue
        if (output.id === primaryOutputId) continue
        items.push({
          outputId: output.id,
          fileUrl: output.fileUrl,
          sourceKind: params?.sourceKind ?? null,
          label: params?.sourceLabel ?? null,
        })
      }
    }
    return items
  }, [generations, primaryOutputId])

  if (branches.length === 0) return null

  return (
    <div className={cn('absolute right-1.5 top-1.5 flex flex-col gap-1 z-10', className)}>
      {branches.slice(0, 5).map((branch) => {
        const KindIcon = kindIcons[branch.sourceKind || 'original'] || ImageIcon
        return (
          <button
            key={branch.outputId}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSwap?.(branch.outputId, branch.fileUrl)
            }}
            className={cn(
              'relative w-7 h-7 rounded overflow-hidden',
              'border-2 border-white/70 shadow-md',
              'hover:border-primary hover:scale-110 transition-all duration-150',
              'bg-muted'
            )}
            title={branch.label || (branch.sourceKind === 'snapshot' ? 'Snapshot branch' : branch.sourceKind === 'edited' ? 'Edited branch' : 'Branch')}
          >
            <img
              src={branch.fileUrl}
              alt={branch.label || 'Branch'}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute bottom-0 right-0 p-[2px] bg-black/60 rounded-tl-sm">
              <KindIcon className="h-2 w-2 text-white/80" />
            </div>
          </button>
        )
      })}
      {branches.length > 5 && (
        <div className="text-[8px] text-white/70 text-center drop-shadow-sm">
          +{branches.length - 5}
        </div>
      )}
    </div>
  )
}
