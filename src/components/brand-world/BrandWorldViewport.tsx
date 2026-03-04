'use client'

import { useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Canvas } from '@react-three/fiber'
import { FestivalScene } from './FestivalScene'
import { StageInspectorPanel } from './StageInspectorPanel'
import { useProjectOutputs } from './useProjectOutputs'
import { assignOutputsToSlots, assignOutputsToRobots } from '@/lib/brand-world/placement'
import type { BrandWorldOutput } from '@/lib/brand-world/placement'
import { WORLD_CONFIG, getStageById } from '@/lib/brand-world/world-config'
import type { StageConfig } from '@/lib/brand-world/world-config'

const ZoneGenerationPopup = dynamic(
  () => import('./ZoneGenerationPopup').then((m) => m.ZoneGenerationPopup),
  { ssr: false }
)

interface BrandWorldViewportProps {
  projectId: string
  projectName: string
}

export function BrandWorldViewport({ projectId, projectName }: BrandWorldViewportProps) {
  const [selectedStage, setSelectedStage] = useState<StageConfig | null>(null)
  const [generateStage, setGenerateStage] = useState<StageConfig | null>(null)
  const [previewOutput, setPreviewOutput] = useState<{ url: string; type: 'image' | 'video'; prompt: string } | null>(null)
  const { outputs, isLoading } = useProjectOutputs(projectId)

  const placedBanners = assignOutputsToSlots(outputs)
  const placedRobots = assignOutputsToRobots(outputs)

  const handleStageClick = useCallback((stageId: string) => {
    const stage = getStageById(stageId)
    setSelectedStage((prev) => (prev?.id === stageId ? null : stage ?? null))
    setGenerateStage(null)
  }, [])

  const handleDismiss = useCallback(() => {
    setSelectedStage(null)
    setGenerateStage(null)
  }, [])

  const handleOpenGenerate = useCallback(() => {
    if (selectedStage) {
      setGenerateStage(selectedStage)
    }
  }, [selectedStage])

  const handleCloseGenerate = useCallback(() => {
    setGenerateStage(null)
  }, [])

  const handleClosePreview = useCallback(() => {
    setPreviewOutput(null)
  }, [])

  const handleRobotClick = useCallback((output: BrandWorldOutput) => {
    setPreviewOutput({ url: output.fileUrl, type: output.fileType, prompt: output.prompt })
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
          far: 300,
        }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: false }}
        style={{ background: '#b8d4e8' }}
      >
        <FestivalScene
          placedBanners={placedBanners}
          placedRobots={placedRobots}
          selectedStageId={selectedStage?.id ?? null}
          onStageClick={handleStageClick}
          onRobotClick={handleRobotClick}
        />
      </Canvas>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-4 py-2 text-sm text-muted-foreground">
          Loading media&hellip;
        </div>
      )}

      {/* Stats bar */}
      {!isLoading && (
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

      {/* Stage popup */}
      {selectedStage && !generateStage && (
        <StageInspectorPanel
          stage={selectedStage}
          banners={stageBanners}
          projectId={projectId}
          onDismiss={handleDismiss}
          onOpenGenerate={handleOpenGenerate}
        />
      )}

      {/* Generation popup */}
      {generateStage && projectId && (
        <ZoneGenerationPopup
          stage={generateStage}
          projectId={projectId}
          onClose={handleCloseGenerate}
        />
      )}

      {/* Fullscreen preview */}
      {previewOutput && (
        <AssetPreviewOverlay
          url={previewOutput.url}
          type={previewOutput.type}
          prompt={previewOutput.prompt}
          onClose={handleClosePreview}
        />
      )}
    </div>
  )
}

function AssetPreviewOverlay({ url, type, prompt, onClose }: { url: string; type: 'image' | 'video'; prompt: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        {type === 'image' ? (
          <img src={url} alt={prompt} className="max-w-full max-h-[calc(90vh-80px)] object-contain rounded-lg shadow-2xl" />
        ) : (
          <video src={url} controls autoPlay className="max-w-full max-h-[calc(90vh-80px)] rounded-lg shadow-2xl" />
        )}
        <p className="text-xs text-white/70 max-w-lg text-center line-clamp-2">{prompt}</p>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        >
          <span className="text-white text-sm">&#x2715;</span>
        </button>
      </div>
    </div>
  )
}
