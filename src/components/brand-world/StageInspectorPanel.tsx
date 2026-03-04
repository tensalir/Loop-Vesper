'use client'

import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { X, Sparkles, ChevronRight } from 'lucide-react'
import type { StageConfig } from '@/lib/brand-world/world-config'
import type { PlacedBanner } from '@/lib/brand-world/placement'

interface StageInspectorPanelProps {
  stage: StageConfig
  banners: PlacedBanner[]
  projectId: string
  onDismiss: () => void
  onOpenGenerate: () => void
}

export function StageInspectorPanel({
  stage,
  banners,
  projectId,
  onDismiss,
  onOpenGenerate,
}: StageInspectorPanelProps) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[420px] max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-md border border-border/60 rounded-xl shadow-2xl overflow-hidden z-10">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: stage.color }}
          />
          <h3 className="text-sm font-bold truncate">{stage.name}</h3>
          <span className="text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full font-medium">
            {banners.length} media
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Description + Media grid */}
      <div className="px-5 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          {stage.description}
        </p>

        {banners.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {banners.slice(0, 8).map((b) => (
              <div
                key={b.slot.id}
                className="relative aspect-square rounded-md overflow-hidden border border-border/30 bg-muted/30"
                title={b.output.prompt}
              >
                {b.output.fileType === 'image' ? (
                  <Image
                    src={b.output.fileUrl}
                    alt={b.output.prompt}
                    fill
                    sizes="60px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[9px] text-muted-foreground">
                    Video
                  </div>
                )}
              </div>
            ))}
            {banners.length > 8 && (
              <div className="aspect-square rounded-md border border-border/30 bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground font-medium">
                +{banners.length - 8}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 flex items-center gap-2">
        <Button
          size="sm"
          className="flex-1 text-xs gap-1.5 h-9"
          onClick={onOpenGenerate}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Generate for this zone
          <ChevronRight className="h-3 w-3 ml-auto" />
        </Button>
      </div>
    </div>
  )
}
