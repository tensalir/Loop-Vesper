'use client'

import { useRef } from 'react'
import { OrbitControls, Sky, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { StageHotspot } from './StageHotspot'
import { BannerBillboard } from './BannerBillboard'
import { STAGES, WORLD_CONFIG } from '@/lib/brand-world/world-config'
import type { PlacedBanner } from '@/lib/brand-world/placement'

interface FestivalSceneProps {
  placedBanners: PlacedBanner[]
  selectedStageId: string | null
  onStageClick: (stageId: string) => void
}

export function FestivalScene({
  placedBanners,
  selectedStageId,
  onStageClick,
}: FestivalSceneProps) {
  const controlsRef = useRef<any>(null)

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={WORLD_CONFIG.ambientLightIntensity} />
      <directionalLight
        position={WORLD_CONFIG.directionalLightPosition}
        intensity={WORLD_CONFIG.directionalLightIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={80}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />
      <hemisphereLight
        args={['#8899aa', '#445566', 0.3]}
      />

      {/* Sky */}
      <Sky
        distance={450000}
        sunPosition={[100, 20, 100]}
        inclination={0.52}
        azimuth={0.25}
        turbidity={8}
        rayleigh={2}
      />

      {/* Fog */}
      <fog attach="fog" args={[WORLD_CONFIG.fogColor, WORLD_CONFIG.fogNear, WORLD_CONFIG.fogFar]} />

      {/* Ground plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[WORLD_CONFIG.groundSize, WORLD_CONFIG.groundSize]} />
        <meshStandardMaterial color="#2d5a27" roughness={0.9} />
      </mesh>

      {/* Grid overlay */}
      <Grid
        position={[0, 0.01, 0]}
        args={[WORLD_CONFIG.groundSize, WORLD_CONFIG.groundSize]}
        cellSize={4}
        cellThickness={0.4}
        cellColor="#3a7a33"
        sectionSize={20}
        sectionThickness={0.8}
        sectionColor="#4a9a43"
        fadeDistance={60}
        fadeStrength={1.5}
        infiniteGrid={false}
      />

      {/* Paths between stages */}
      <StagePaths />

      {/* Stage structures */}
      {STAGES.map((stage) => (
        <StageHotspot
          key={stage.id}
          stage={stage}
          isSelected={selectedStageId === stage.id}
          onClick={onStageClick}
        />
      ))}

      {/* Banner billboards */}
      {placedBanners.map((banner) => {
        const stagePos = STAGES.find((s) => s.id === banner.slot.stageId)?.position ?? [0, 0, 0]
        return (
          <BannerBillboard
            key={banner.slot.id}
            banner={banner}
            stagePosition={stagePos}
          />
        )
      })}

      {/* Decorative trees */}
      <TreeCluster position={[-30, 0, -25]} count={6} spread={5} />
      <TreeCluster position={[30, 0, -30]} count={4} spread={4} />
      <TreeCluster position={[-25, 0, 30]} count={5} spread={6} />
      <TreeCluster position={[30, 0, 30]} count={3} spread={4} />
      <TreeCluster position={[-35, 0, 5]} count={4} spread={3} />
      <TreeCluster position={[35, 0, 5]} count={5} spread={5} />

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={15}
        maxDistance={80}
        maxPolarAngle={Math.PI / 2.5}
        minPolarAngle={Math.PI / 8}
        target={WORLD_CONFIG.cameraTarget}
      />
    </>
  )
}

function StagePaths() {
  const pathColor = '#8B7355'
  return (
    <group>
      {STAGES.map((stage, i) => {
        const next = STAGES[(i + 1) % STAGES.length]
        const points = [
          new THREE.Vector3(stage.position[0], 0.02, stage.position[2]),
          new THREE.Vector3(
            (stage.position[0] + next.position[0]) / 2,
            0.02,
            (stage.position[2] + next.position[2]) / 2
          ),
          new THREE.Vector3(next.position[0], 0.02, next.position[2]),
        ]
        const curve = new THREE.CatmullRomCurve3(points)
        const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.8, 4, false)
        return (
          <mesh key={`path-${stage.id}-${next.id}`} geometry={tubeGeo} receiveShadow>
            <meshStandardMaterial color={pathColor} roughness={0.95} />
          </mesh>
        )
      })}
    </group>
  )
}

function TreeCluster({
  position,
  count,
  spread,
}: {
  position: [number, number, number]
  count: number
  spread: number
}) {
  const trees = Array.from({ length: count }, (_, i) => {
    const seed = position[0] * 100 + position[2] * 10 + i
    const angle = (seed * 2.399) % (Math.PI * 2)
    const dist = ((seed * 0.618) % 1) * spread
    const x = position[0] + Math.cos(angle) * dist
    const z = position[2] + Math.sin(angle) * dist
    const height = 2 + ((seed * 0.31) % 1) * 2
    const trunkHeight = height * 0.4
    return { x, z, height, trunkHeight, key: `tree-${seed}` }
  })

  return (
    <group>
      {trees.map((t) => (
        <group key={t.key} position={[t.x, 0, t.z]}>
          {/* Trunk */}
          <mesh position={[0, trunkH(t.trunkHeight), 0]} castShadow>
            <cylinderGeometry args={[0.1, 0.15, t.trunkHeight, 6]} />
            <meshStandardMaterial color="#5a3d2b" roughness={0.9} />
          </mesh>
          {/* Canopy */}
          <mesh position={[0, t.trunkHeight + t.height * 0.3, 0]} castShadow>
            <coneGeometry args={[t.height * 0.35, t.height * 0.6, 6]} />
            <meshStandardMaterial color="#2d6b30" roughness={0.85} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function trunkH(h: number) {
  return h / 2
}
