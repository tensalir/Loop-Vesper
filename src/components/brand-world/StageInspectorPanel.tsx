'use client'

import { Button } from '@/components/ui/button'
import { X, Sparkles, ChevronRight } from 'lucide-react'
import type { StageConfig } from '@/lib/brand-world/world-config'

interface StageInspectorPanelProps {
  stage: StageConfig
  projectId: string
  onDismiss: () => void
  onOpenGenerate: () => void
}

export function StageInspectorPanel({
  stage,
  onDismiss,
  onOpenGenerate,
}: StageInspectorPanelProps) {
  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[420px] max-w-[calc(100vw-2rem)] bg-background/95 backdrop-blur-md border border-border/60 rounded-xl shadow-2xl overflow-hidden z-10">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: stage.color }}
          />
          <h3 className="text-sm font-bold truncate">{stage.name}</h3>
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

      <div className="px-5 py-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {stage.description}
        </p>
      </div>

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
