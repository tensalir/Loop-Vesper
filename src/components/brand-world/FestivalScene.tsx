'use client'

import { useRef, useMemo } from 'react'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { StageHotspot } from './StageHotspot'
import { BannerBillboard } from './BannerBillboard'
import { RobotBillboard } from './RobotBillboard'
import { getToonGradient3, getToonGradient5 } from './toon-materials'
import { STAGES, WORLD_CONFIG } from '@/lib/brand-world/world-config'
import type { PlacedBanner, PlacedRobot, BrandWorldOutput } from '@/lib/brand-world/placement'

function createSkyDomeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(WORLD_CONFIG.skyZenithColor) },
      uMid: { value: new THREE.Color(WORLD_CONFIG.skyMidColor) },
      uHorizon: { value: new THREE.Color(WORLD_CONFIG.skyHorizonColor) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition).y;
        float t = clamp(h, 0.0, 1.0);
        vec3 color;
        if (t < 0.15) {
          color = mix(uHorizon, uMid, t / 0.15);
        } else {
          color = mix(uMid, uZenith, (t - 0.15) / 0.85);
        }
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  })
}

interface FestivalSceneProps {
  placedBanners: PlacedBanner[]
  placedRobots: PlacedRobot[]
  selectedStageId: string | null
  onStageClick: (stageId: string) => void
  onRobotClick?: (output: BrandWorldOutput) => void
}

export function FestivalScene({
  placedBanners,
  placedRobots,
  selectedStageId,
  onStageClick,
  onRobotClick,
}: FestivalSceneProps) {
  const controlsRef = useRef<any>(null)
  const grad3 = useMemo(() => getToonGradient3(), [])
  const grad5 = useMemo(() => getToonGradient5(), [])
  const skyMaterial = useMemo(() => createSkyDomeMaterial(), [])

  return (
    <>
      <ambientLight intensity={WORLD_CONFIG.ambientLightIntensity} color="#e8eef5" />
      <directionalLight
        position={WORLD_CONFIG.directionalLightPosition}
        intensity={WORLD_CONFIG.directionalLightIntensity}
        color="#fffbe8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={120}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <hemisphereLight args={['#87ceeb', '#4a7a3a', 0.35]} />

      {/* Sky dome */}
      <mesh>
        <sphereGeometry args={[250, 32, 16]} />
        <primitive object={skyMaterial} attach="material" />
      </mesh>

      {/* Fog */}
      <fog attach="fog" args={[WORLD_CONFIG.fogColor, WORLD_CONFIG.fogNear, WORLD_CONFIG.fogFar]} />

      {/* Main grass field — extends to horizon */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[WORLD_CONFIG.groundSize, WORLD_CONFIG.groundSize]} />
        <meshToonMaterial color="#5a9e4a" gradientMap={grad5} />
      </mesh>

      {/* Inner field — slightly lighter grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshToonMaterial color="#68b058" gradientMap={grad5} />
      </mesh>

      {/* Gentle terrain berms */}
      <TerrainBerms gradientMap={grad5} />

      {/* Perimeter fences */}
      <PerimeterFences gradientMap={grad3} />

      {/* Paths between stages */}
      <StagePaths gradientMap={grad3} />

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
        const stage = STAGES.find((s) => s.id === banner.slot.stageId)
        const stagePos = stage?.position ?? [0, 0, 0]
        return (
          <BannerBillboard
            key={banner.slot.id}
            banner={banner}
            stagePosition={stagePos}
            stageScale={stage?.scale ?? 1}
          />
        )
      })}

      {/* Robot billboard actors */}
      {placedRobots.map((robot) => (
        <RobotBillboard
          key={`robot-${robot.output.id}`}
          output={robot.output}
          position={robot.position}
          rotation={robot.rotation}
          onClick={onRobotClick}
        />
      ))}

      {/* Decorative trees */}
      <TreeCluster position={[-32, 0, -20]} count={7} spread={6} gradientMap={grad3} />
      <TreeCluster position={[32, 0, -25]} count={5} spread={5} gradientMap={grad3} />
      <TreeCluster position={[-28, 0, 28]} count={6} spread={7} gradientMap={grad3} />
      <TreeCluster position={[30, 0, 30]} count={4} spread={5} gradientMap={grad3} />
      <TreeCluster position={[-38, 0, 5]} count={5} spread={4} gradientMap={grad3} />
      <TreeCluster position={[38, 0, 5]} count={6} spread={6} gradientMap={grad3} />
      <TreeCluster position={[-10, 0, -40]} count={4} spread={5} gradientMap={grad3} />
      <TreeCluster position={[10, 0, -42]} count={4} spread={4} gradientMap={grad3} />
      {/* Far background trees to soften horizon */}
      <TreeCluster position={[-50, 0, -60]} count={8} spread={10} gradientMap={grad3} />
      <TreeCluster position={[50, 0, -55]} count={7} spread={9} gradientMap={grad3} />
      <TreeCluster position={[0, 0, -65]} count={6} spread={12} gradientMap={grad3} />
      <TreeCluster position={[-55, 0, 40]} count={5} spread={8} gradientMap={grad3} />
      <TreeCluster position={[55, 0, 45]} count={5} spread={8} gradientMap={grad3} />

      {/* Camera controls */}
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={15}
        maxDistance={90}
        maxPolarAngle={Math.PI / 2.3}
        minPolarAngle={Math.PI / 8}
        target={WORLD_CONFIG.cameraTarget}
      />
    </>
  )
}

function TerrainBerms({ gradientMap }: { gradientMap: THREE.DataTexture }) {
  const berms = useMemo(() => [
    { pos: [-60, 0, -50] as const, sx: 30, sy: 2.5, sz: 15, color: '#4d8a3e' },
    { pos: [55, 0, -45] as const, sx: 25, sy: 2, sz: 12, color: '#52913f' },
    { pos: [-50, 0, 50] as const, sx: 20, sy: 1.8, sz: 18, color: '#4a8538' },
    { pos: [60, 0, 55] as const, sx: 28, sy: 2.2, sz: 14, color: '#4d8a3e' },
    { pos: [0, 0, -70] as const, sx: 40, sy: 3, sz: 10, color: '#458035' },
  ], [])

  return (
    <group>
      {berms.map((b, i) => (
        <mesh key={`berm-${i}`} position={[b.pos[0], b.sy / 2, b.pos[2]]} castShadow receiveShadow>
          <sphereGeometry args={[1, 6, 4]} />
          <meshToonMaterial color={b.color} gradientMap={gradientMap} />
          <group scale={[b.sx, b.sy, b.sz]} />
        </mesh>
      ))}
      {berms.map((b, i) => (
        <mesh
          key={`berm-scaled-${i}`}
          position={[b.pos[0], b.sy * 0.4, b.pos[2]]}
          scale={[b.sx, b.sy, b.sz]}
          receiveShadow
        >
          <sphereGeometry args={[0.5, 6, 4]} />
          <meshToonMaterial color={b.color} gradientMap={gradientMap} />
        </mesh>
      ))}
    </group>
  )
}

function PerimeterFences({ gradientMap }: { gradientMap: THREE.DataTexture }) {
  const fenceSegments = useMemo(() => {
    const segments: Array<{ start: THREE.Vector3; end: THREE.Vector3 }> = []
    const r = 42
    const sides = 12
    for (let i = 0; i < sides; i++) {
      const a1 = (i / sides) * Math.PI * 2
      const a2 = ((i + 1) / sides) * Math.PI * 2
      segments.push({
        start: new THREE.Vector3(Math.cos(a1) * r, 0, Math.sin(a1) * r),
        end: new THREE.Vector3(Math.cos(a2) * r, 0, Math.sin(a2) * r),
      })
    }
    return segments
  }, [])

  return (
    <group>
      {fenceSegments.map((seg, i) => {
        const mid = new THREE.Vector3().lerpVectors(seg.start, seg.end, 0.5)
        const dir = new THREE.Vector3().subVectors(seg.end, seg.start)
        const len = dir.length()
        const angle = Math.atan2(dir.x, dir.z)

        return (
          <group key={`fence-${i}`}>
            {/* Horizontal rail */}
            <mesh position={[mid.x, 0.8, mid.z]} rotation={[0, angle, 0]} castShadow>
              <boxGeometry args={[0.1, 0.1, len]} />
              <meshToonMaterial color="#c4a06a" gradientMap={gradientMap} />
            </mesh>
            <mesh position={[mid.x, 0.5, mid.z]} rotation={[0, angle, 0]} castShadow>
              <boxGeometry args={[0.1, 0.1, len]} />
              <meshToonMaterial color="#b8945e" gradientMap={gradientMap} />
            </mesh>
            {/* Posts at segment ends */}
            <mesh position={[seg.start.x, 0.45, seg.start.z]} castShadow>
              <boxGeometry args={[0.15, 0.9, 0.15]} />
              <meshToonMaterial color="#8b6e4a" gradientMap={gradientMap} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function StagePaths({ gradientMap }: { gradientMap: THREE.DataTexture }) {
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
            <meshToonMaterial color="#d4be8a" gradientMap={gradientMap} />
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
  gradientMap,
}: {
  position: [number, number, number]
  count: number
  spread: number
  gradientMap: THREE.DataTexture
}) {
  const trees = useMemo(() =>
    Array.from({ length: count }, (_, i) => {
      const seed = position[0] * 100 + position[2] * 10 + i
      const angle = (seed * 2.399) % (Math.PI * 2)
      const dist = ((seed * 0.618) % 1) * spread
      const x = position[0] + Math.cos(angle) * dist
      const z = position[2] + Math.sin(angle) * dist
      const height = 2.5 + ((seed * 0.31) % 1) * 2.5
      const trunkHeight = height * 0.35
      const canopyHue = 0.28 + ((seed * 0.17) % 1) * 0.08
      return { x, z, height, trunkHeight, canopyHue, key: `tree-${seed}` }
    }), [position, count, spread]
  )

  return (
    <group>
      {trees.map((t) => (
        <group key={t.key} position={[t.x, 0, t.z]}>
          <mesh position={[0, t.trunkHeight / 2, 0]} castShadow>
            <cylinderGeometry args={[0.12, 0.18, t.trunkHeight, 5]} />
            <meshToonMaterial
              color={new THREE.Color().setHSL(0.08, 0.45, 0.3)}
              gradientMap={gradientMap}
            />
          </mesh>
          <mesh position={[0, t.trunkHeight + t.height * 0.22, 0]} castShadow>
            <sphereGeometry args={[t.height * 0.3, 6, 5]} />
            <meshToonMaterial
              color={new THREE.Color().setHSL(t.canopyHue, 0.55, 0.38)}
              gradientMap={gradientMap}
            />
          </mesh>
        </group>
      ))}
    </group>
  )
}
