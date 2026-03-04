'use client'

import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
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

  useFrame((_, delta) => {
    if (glowMatRef.current) {
      const target = hovered || isSelected ? 0.6 : 0.15
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
        <cylinderGeometry args={[6, 6.5, 0.3, 24]} />
        <meshStandardMaterial
          color={isSelected ? stage.color : '#444444'}
          roughness={0.6}
          metalness={0.2}
        />
      </mesh>

      {/* Inner platform ring */}
      <mesh position={[0, 0.31, 0]} receiveShadow>
        <cylinderGeometry args={[4.5, 5, 0.05, 24]} />
        <meshStandardMaterial color={stage.color} roughness={0.4} metalness={0.3} />
      </mesh>

      {/* Stage structure - back wall */}
      <RoundedBox
        args={[10, 6, 0.3]}
        radius={0.1}
        position={[0, 3.3, -4]}
        castShadow
      >
        <meshStandardMaterial
          color="#333333"
          roughness={0.5}
          metalness={0.4}
        />
      </RoundedBox>

      {/* Stage structure - side pylons */}
      {[-5, 5].map((x) => (
        <mesh key={`pylon-${x}`} position={[x, 3.5, -2]} castShadow>
          <boxGeometry args={[0.4, 7, 0.4]} />
          <meshStandardMaterial color="#555555" roughness={0.4} metalness={0.5} />
        </mesh>
      ))}

      {/* Stage roof truss */}
      <mesh position={[0, 7, -2]} castShadow>
        <boxGeometry args={[11, 0.3, 3]} />
        <meshStandardMaterial color="#444444" roughness={0.5} metalness={0.4} />
      </mesh>

      {/* Glow ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[6, 7, 32]} />
        <meshBasicMaterial
          ref={glowMatRef}
          color={stage.color}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Stage label */}
      <Text
        position={[0, 8, -2]}
        fontSize={0.9}
        color={isSelected || hovered ? stage.color : '#cccccc'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.03}
        outlineColor="#000000"
      >
        {stage.name.toUpperCase()}
      </Text>

      {/* Selection indicator */}
      {isSelected && (
        <mesh position={[0, 0.4, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[5.5, 5.8, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}
