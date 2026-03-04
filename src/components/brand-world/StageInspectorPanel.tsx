'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { X, Sparkles, ExternalLink } from 'lucide-react'
import type { StageConfig } from '@/lib/brand-world/world-config'
import type { PlacedBanner } from '@/lib/brand-world/placement'

interface StageInspectorPanelProps {
  stage: StageConfig
  banners: PlacedBanner[]
  projectId: string | null
  onDismiss: () => void
}

export function StageInspectorPanel({
  stage,
  banners,
  projectId,
  onDismiss,
}: StageInspectorPanelProps) {
  const router = useRouter()

  const handleGenerate = () => {
    if (!projectId) return
    const prompt = encodeURIComponent(
      `Festival ${stage.name.toLowerCase()} scene, vibrant atmosphere, crowd energy`
    )
    router.push(`/projects/${projectId}?prefillPrompt=${prompt}`)
  }

  const handleOpenProject = () => {
    if (!projectId) return
    router.push(`/projects/${projectId}`)
  }

  return (
    <div className="absolute top-4 right-4 w-80 bg-background/95 backdrop-blur-md border border-border/60 rounded-lg shadow-xl overflow-hidden z-10">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: stage.color }}
          />
          <h3 className="text-sm font-semibold truncate">{stage.name}</h3>
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

      {/* Description */}
      <div className="px-4 py-3 border-b border-border/30">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {stage.description}
        </p>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
          <span>{stage.bannerSlots.length} banner slots</span>
          <span className="w-px h-3 bg-border" />
          <span>{banners.length} media placed</span>
        </div>
      </div>

      {/* Media thumbnails */}
      {banners.length > 0 && (
        <div className="px-4 py-3 border-b border-border/30">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
            Placed media
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {banners.map((b) => (
              <div
                key={b.slot.id}
                className="relative aspect-video rounded overflow-hidden border border-border/30 bg-muted/30"
                title={b.output.prompt}
              >
                {b.output.fileType === 'image' ? (
                  <Image
                    src={b.output.fileUrl}
                    alt={b.output.prompt}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[9px] text-muted-foreground">
                    Video
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 flex flex-col gap-2">
        {projectId && (
          <>
            <Button
              size="sm"
              className="w-full text-xs gap-1.5"
              onClick={handleGenerate}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate for this stage
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs gap-1.5"
              onClick={handleOpenProject}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open project
            </Button>
          </>
        )}
        {!projectId && (
          <p className="text-xs text-muted-foreground text-center py-1">
            Select a project to generate content for this stage.
          </p>
        )}
      </div>
    </div>
  )
}
