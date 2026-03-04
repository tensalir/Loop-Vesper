'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { FestivalScene } from './FestivalScene'
import { StageInspectorPanel } from './StageInspectorPanel'
import { useProjectOutputs } from './useProjectOutputs'
import { assignOutputsToRobots, assignPendingToRobots } from '@/lib/brand-world/placement'
import type { BrandWorldOutput, PendingGeneration } from '@/lib/brand-world/placement'
import { WORLD_CONFIG, getStageById } from '@/lib/brand-world/world-config'
import type { StageConfig } from '@/lib/brand-world/world-config'
import { X } from 'lucide-react'

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
  const [pendingGenerations, setPendingGenerations] = useState<PendingGeneration[]>([])
  const [zoomTarget, setZoomTarget] = useState<{ pos: [number, number, number]; output: BrandWorldOutput } | null>(null)
  const [zoomMode, setZoomMode] = useState<'idle' | 'zoom-in' | 'focused' | 'zoom-out'>('idle')
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { outputs, isLoading, refetch } = useProjectOutputs(projectId)

  useEffect(() => {
    if (pendingGenerations.length === 0) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return
    }

    pollTimerRef.current = setInterval(() => {
      refetch()
    }, 4000)

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [pendingGenerations.length, refetch])

  useEffect(() => {
    if (pendingGenerations.length === 0) return
    const outputIds = new Set(outputs.map((o) => o.generationId))
    setPendingGenerations((prev) => prev.filter((p) => !outputIds.has(p.id)))
  }, [outputs, pendingGenerations.length])

  const handleGenerationStarted = useCallback((gen: PendingGeneration) => {
    setPendingGenerations((prev) => [...prev, gen])
  }, [])

  const placedRobots = assignOutputsToRobots(outputs)
  const pendingRobots = assignPendingToRobots(pendingGenerations)
  const focusedOutputId = zoomTarget?.output.id ?? null

  const handleStageClick = useCallback((stageId: string) => {
    if (zoomMode !== 'idle') return
    const stage = getStageById(stageId)
    setSelectedStage((prev) => (prev?.id === stageId ? null : stage ?? null))
    setGenerateStage(null)
  }, [zoomMode])

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

  const handleRobotClick = useCallback((output: BrandWorldOutput, worldPosition?: [number, number, number]) => {
    if (zoomMode !== 'idle') return
    const pos = worldPosition ?? [0, 1, 0] as [number, number, number]
    setZoomTarget({ pos, output })
    setZoomMode('zoom-in')
    setSelectedStage(null)
    setGenerateStage(null)
  }, [zoomMode])

  const handleZoomInComplete = useCallback(() => {
    setZoomMode('focused')
  }, [])

  const handleDismissZoom = useCallback(() => {
    if (zoomMode === 'focused' || zoomMode === 'zoom-in') {
      setZoomMode('zoom-out')
    }
  }, [zoomMode])

  const handleZoomOutComplete = useCallback(() => {
    setZoomTarget(null)
    setZoomMode('idle')
  }, [])

  useEffect(() => {
    if (zoomMode === 'idle') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismissZoom()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zoomMode, handleDismissZoom])

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
          placedRobots={placedRobots}
          pendingRobots={pendingRobots}
          selectedStageId={selectedStage?.id ?? null}
          onStageClick={handleStageClick}
          onRobotClick={handleRobotClick}
          focusedOutputId={focusedOutputId}
        />
        <CameraController
          zoomTarget={zoomTarget?.pos ?? null}
          zoomMode={zoomMode}
          onZoomInComplete={handleZoomInComplete}
          onZoomOutComplete={handleZoomOutComplete}
        />
      </Canvas>

      {/* Loading overlay */}
      {isLoading && (
        <div className="absolute top-4 left-4 bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-4 py-2 text-sm text-muted-foreground">
          Loading media&hellip;
        </div>
      )}

      {/* Stats bar */}
      {!isLoading && zoomMode === 'idle' && (
        <div className="absolute bottom-4 left-4 bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg px-4 py-2 text-xs text-muted-foreground flex items-center gap-3">
          <span>{outputs.length} outputs loaded</span>
          <span className="w-px h-3 bg-border" />
          <span>{placedRobots.length} robots placed</span>
          {pendingGenerations.length > 0 && (
            <>
              <span className="w-px h-3 bg-border" />
              <span className="text-primary font-medium">{pendingGenerations.length} generating&hellip;</span>
            </>
          )}
          {projectName && (
            <>
              <span className="w-px h-3 bg-border" />
              <span className="font-medium text-foreground">{projectName}</span>
            </>
          )}
        </div>
      )}

      {/* Focused robot prompt label */}
      {(zoomMode === 'focused' || zoomMode === 'zoom-in') && zoomTarget && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 max-w-lg bg-background/90 backdrop-blur-md border border-border/60 rounded-xl shadow-2xl px-5 py-3 flex items-start gap-3 z-10">
          <p className="text-xs text-muted-foreground leading-relaxed flex-1 line-clamp-3">
            {zoomTarget.output.prompt}
          </p>
          <button
            onClick={handleDismissZoom}
            className="shrink-0 p-1 rounded-md hover:bg-muted/60 transition-colors"
            title="Back to overview"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Stage popup */}
      {selectedStage && !generateStage && zoomMode === 'idle' && (
        <StageInspectorPanel
          stage={selectedStage}
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
          onGenerationStarted={handleGenerationStarted}
        />
      )}
    </div>
  )
}

function CameraController({
  zoomTarget,
  zoomMode,
  onZoomInComplete,
  onZoomOutComplete,
}: {
  zoomTarget: [number, number, number] | null
  zoomMode: 'idle' | 'zoom-in' | 'focused' | 'zoom-out'
  onZoomInComplete: () => void
  onZoomOutComplete: () => void
}) {
  const { camera } = useThree()
  const progress = useRef(0)
  const startPos = useRef(new THREE.Vector3())
  const goalPos = useRef(new THREE.Vector3())
  const startLookAt = useRef(new THREE.Vector3())
  const goalLookAt = useRef(new THREE.Vector3())
  const homePos = useRef(new THREE.Vector3(...WORLD_CONFIG.cameraPosition))
  const homeLookAt = useRef(new THREE.Vector3(...WORLD_CONFIG.cameraTarget))
  const lastMode = useRef(zoomMode)

  useEffect(() => {
    if (zoomMode === 'zoom-in' && zoomTarget) {
      homePos.current.copy(camera.position)
      homeLookAt.current.set(...WORLD_CONFIG.cameraTarget)

      startPos.current.copy(camera.position)
      startLookAt.current.copy(homeLookAt.current)

      const chestY = zoomTarget[1] + 1.15
      const dx = camera.position.x - zoomTarget[0]
      const dz = camera.position.z - zoomTarget[2]
      const len = Math.sqrt(dx * dx + dz * dz) || 1
      const nx = dx / len
      const nz = dz / len

      goalPos.current.set(
        zoomTarget[0] + nx * 1.6,
        chestY + 0.05,
        zoomTarget[2] + nz * 1.6
      )
      goalLookAt.current.set(zoomTarget[0], chestY, zoomTarget[2])
      progress.current = 0
    }

    if (zoomMode === 'zoom-out') {
      startPos.current.copy(camera.position)
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      startLookAt.current.copy(camera.position).add(dir.multiplyScalar(2))

      goalPos.current.copy(homePos.current)
      goalLookAt.current.copy(homeLookAt.current)
      progress.current = 0
    }

    lastMode.current = zoomMode
  }, [zoomMode, zoomTarget, camera])

  useFrame((_, delta) => {
    if (zoomMode === 'idle' || zoomMode === 'focused') return

    progress.current = Math.min(progress.current + delta * 2.0, 1)
    const t = 1 - Math.pow(1 - progress.current, 3)

    camera.position.lerpVectors(startPos.current, goalPos.current, t)

    const look = new THREE.Vector3().lerpVectors(startLookAt.current, goalLookAt.current, t)
    camera.lookAt(look)

    if (progress.current >= 1) {
      if (zoomMode === 'zoom-in') onZoomInComplete()
      if (zoomMode === 'zoom-out') onZoomOutComplete()
    }
  })

  return null
}
