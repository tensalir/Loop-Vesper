'use client'

import { useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { FestivalScene } from './FestivalScene'
import { StageInspectorPanel } from './StageInspectorPanel'
import { useProjectOutputs } from './useProjectOutputs'
import { assignOutputsToSlots } from '@/lib/brand-world/placement'
import { WORLD_CONFIG, getStageById } from '@/lib/brand-world/world-config'
import type { StageConfig } from '@/lib/brand-world/world-config'

interface BrandWorldViewportProps {
  projectId: string | null
  projectName: string | null
}

export function BrandWorldViewport({ projectId, projectName }: BrandWorldViewportProps) {
  const [selectedStage, setSelectedStage] = useState<StageConfig | null>(null)
  const { outputs, isLoading } = useProjectOutputs(projectId)

  const placedBanners = assignOutputsToSlots(outputs)

  const handleStageClick = useCallback((stageId: string) => {
    const stage = getStageById(stageId)
    setSelectedStage((prev) => (prev?.id === stageId ? null : stage ?? null))
  }, [])

  const handleDismiss = useCallback(() => {
    setSelectedStage(null)
  }, [])

  const stageBanners = selectedStage
    ? placedBanners.filter((b) => b.slot.stageId === selectedStage.id)
    : []

  return (
    <div className="w-full h-full relative">
      <Canvas
        shadows
        camera={{
          position: WORLD_CONFIG.cameraPosition,
          fov: 35,
          near: 0.1,
          far: 200,
        }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: WORLD_CONFIG.fogColor }}
      >
        <FestivalScene
          placedBanners={placedBanners}
          selectedStageId={selectedStage?.id ?? null}
          onStageClick={handleStageClick}
        />
      </Canvas>

      {/* Empty state overlay */}
      {!projectId && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-8 py-6 text-center max-w-sm">
            <h3 className="text-base font-semibold mb-1">Select a project</h3>
            <p className="text-sm text-muted-foreground">
              Choose a project above to populate the festival world with generated media.
            </p>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {projectId && isLoading && (
        <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-4 py-2 text-sm text-muted-foreground">
          Loading media&hellip;
        </div>
      )}

      {/* Stats bar */}
      {projectId && !isLoading && (
        <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-4 py-2 text-xs text-muted-foreground flex items-center gap-3">
          <span>{outputs.length} outputs loaded</span>
          <span className="w-px h-3 bg-border" />
          <span>{placedBanners.length} banners placed</span>
          {projectName && (
            <>
              <span className="w-px h-3 bg-border" />
              <span className="font-medium text-foreground">{projectName}</span>
            </>
          )}
        </div>
      )}

      {/* Stage inspector */}
      {selectedStage && (
        <StageInspectorPanel
          stage={selectedStage}
          banners={stageBanners}
          projectId={projectId}
          onDismiss={handleDismiss}
        />
      )}
    </div>
  )
}
