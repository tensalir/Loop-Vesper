'use client'

import { useRef, useState, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { getToonGradient3 } from './toon-materials'
import type { StageConfig } from '@/lib/brand-world/world-config'

interface StageHotspotProps {
  stage: StageConfig
  isSelected: boolean
  onClick: (stageId: string) => void
}

export function StageHotspot({ stage, isSelected, onClick }: StageHotspotProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const glowMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const gradientMap = useMemo(() => getToonGradient3(), [])

  const s = stage.scale
  const isHero = s > 1.5

  useFrame((_, delta) => {
    if (glowMatRef.current) {
      const target = hovered || isSelected ? 0.6 : 0.2
      glowMatRef.current.opacity = THREE.MathUtils.lerp(
        glowMatRef.current.opacity,
        target,
        delta * 6
      )
    }
  })

  return (
    <group
      ref={groupRef}
      position={stage.position}
      scale={[s, s, s]}
      onClick={(e) => {
        e.stopPropagation()
        onClick(stage.id)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
    >
      {/* Stage platform */}
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[6, 6.5, 0.3, 8]} />
        <meshToonMaterial
          color={isSelected ? stage.color : '#8a8a8a'}
          gradientMap={gradientMap}
        />
      </mesh>

      {/* Inner platform ring */}
      <mesh position={[0, 0.31, 0]} receiveShadow>
        <cylinderGeometry args={[4.5, 5, 0.08, 8]} />
        <meshToonMaterial color={stage.color} gradientMap={gradientMap} />
      </mesh>

      {/* Stage structure - back wall */}
      <mesh position={[0, 3.3, -4]} castShadow>
        <boxGeometry args={[10, 6, 0.3]} />
        <meshToonMaterial color="#6a6a6a" gradientMap={gradientMap} />
      </mesh>

      {/* Stage structure - side pylons */}
      {[-5, 5].map((x) => (
        <mesh key={`pylon-${x}`} position={[x, 3.5, -2]} castShadow>
          <boxGeometry args={[0.5, 7, 0.5]} />
          <meshToonMaterial color="#7a7a7a" gradientMap={gradientMap} />
        </mesh>
      ))}

      {/* Stage roof truss */}
      <mesh position={[0, 7, -2]} castShadow>
        <boxGeometry args={[11, 0.4, 3]} />
        <meshToonMaterial color="#7a7a7a" gradientMap={gradientMap} />
      </mesh>

      {/* Hero stage extras: arched top truss + LED strips */}
      {isHero && (
        <>
          {/* Arched top piece */}
          <mesh position={[0, 8.5, -3]} castShadow>
            <boxGeometry args={[13, 0.5, 0.5]} />
            <meshToonMaterial color="#6a6a6a" gradientMap={gradientMap} />
          </mesh>
          <mesh position={[0, 9.5, -3.5]} castShadow>
            <boxGeometry args={[10, 0.4, 0.4]} />
            <meshToonMaterial color="#606060" gradientMap={gradientMap} />
          </mesh>

          {/* LED strip accents along truss edges */}
          {[-5.3, 5.3].map((x) => (
            <mesh key={`led-v-${x}`} position={[x, 5, -2]}>
              <boxGeometry args={[0.15, 5, 0.15]} />
              <meshBasicMaterial color={stage.color} />
            </mesh>
          ))}
          <mesh position={[0, 7.3, -2]}>
            <boxGeometry args={[10.8, 0.12, 0.12]} />
            <meshBasicMaterial color={stage.color} />
          </mesh>
          <mesh position={[0, 8.7, -3]}>
            <boxGeometry args={[12.8, 0.1, 0.1]} />
            <meshBasicMaterial color="#ff9944" />
          </mesh>

          {/* Side speaker stacks */}
          {[-7, 7].map((x) => (
            <group key={`speaker-${x}`} position={[x, 0, -1]}>
              <mesh position={[0, 1, 0]} castShadow>
                <boxGeometry args={[1.5, 2, 1.2]} />
                <meshToonMaterial color="#555555" gradientMap={gradientMap} />
              </mesh>
              <mesh position={[0, 2.8, 0]} castShadow>
                <boxGeometry args={[1.3, 1.5, 1]} />
                <meshToonMaterial color="#606060" gradientMap={gradientMap} />
              </mesh>
            </group>
          ))}
        </>
      )}

      {/* Glow ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6, 7.2, 32]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color={stage.color}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Stage label */}
      <Text
        position={[0, isHero ? 10.5 : 8, -2]}
        fontSize={isHero ? 1.2 : 0.9}
        color={isSelected || hovered ? stage.color : '#444444'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.04}
        outlineColor="#ffffff"
      >
        {stage.name.toUpperCase()}
      </Text>

      {/* Selection indicator */}
      {isSelected && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[5.5, 5.9, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}
