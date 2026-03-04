'use client'

import { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getToonGradient3 } from './toon-materials'
import type { BrandWorldOutput } from '@/lib/brand-world/placement'

interface RobotBillboardProps {
  output: BrandWorldOutput
  position: [number, number, number]
  rotation?: number
  onClick?: (output: BrandWorldOutput) => void
}

export function RobotBillboard({ output, position, rotation = 0, onClick }: RobotBillboardProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const textureRef = useRef<THREE.Texture | null>(null)
  const gradientMap = useMemo(() => getToonGradient3(), [])
  const idleOffset = useMemo(() => Math.random() * Math.PI * 2, [])

  useEffect(() => {
    if (output.fileType !== 'image') return

    const loader = new THREE.TextureLoader()
    loader.load(
      output.fileUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        textureRef.current = tex
        setTexture(tex)
      },
      undefined,
      () => {}
    )

    return () => {
      textureRef.current?.dispose()
      textureRef.current = null
    }
  }, [output.fileUrl, output.fileType])

  useFrame((state) => {
    if (groupRef.current) {
      const t = state.clock.elapsedTime + idleOffset
      groupRef.current.position.y = position[1] + Math.sin(t * 0.8) * 0.06
      groupRef.current.rotation.y = rotation + Math.sin(t * 0.5) * 0.05
    }
  })

  const bodyColor = hovered ? '#c0c0c0' : '#a0a0a8'
  const limbColor = '#888890'

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotation, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(output)
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
      {/* Legs */}
      {[-0.2, 0.2].map((x) => (
        <mesh key={`leg-${x}`} position={[x, 0.35, 0]} castShadow>
          <boxGeometry args={[0.15, 0.7, 0.15]} />
          <meshToonMaterial color={limbColor} gradientMap={gradientMap} />
        </mesh>
      ))}

      {/* Body / torso */}
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[0.7, 0.9, 0.4]} />
        <meshToonMaterial color={bodyColor} gradientMap={gradientMap} />
      </mesh>

      {/* Chest screen — shows the generated output */}
      <mesh position={[0, 1.15, 0.21]}>
        <planeGeometry args={[0.55, 0.55]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} />
        ) : output.fileType === 'video' ? (
          <meshBasicMaterial color="#1a2a3a" />
        ) : (
          <meshBasicMaterial color="#2a2a3a" />
        )}
      </mesh>

      {/* Screen bezel */}
      <mesh position={[0, 1.15, 0.205]}>
        <planeGeometry args={[0.6, 0.6]} />
        <meshBasicMaterial color="#333" />
      </mesh>

      {/* Video play indicator on chest */}
      {output.fileType === 'video' && (
        <mesh position={[0, 1.15, 0.22]}>
          <circleGeometry args={[0.1, 6]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      )}

      {/* Arms */}
      {[-0.48, 0.48].map((x) => (
        <mesh key={`arm-${x}`} position={[x, 1.0, 0]} castShadow>
          <boxGeometry args={[0.12, 0.6, 0.12]} />
          <meshToonMaterial color={limbColor} gradientMap={gradientMap} />
        </mesh>
      ))}

      {/* Head */}
      <mesh position={[0, 1.85, 0]} castShadow>
        <boxGeometry args={[0.4, 0.35, 0.35]} />
        <meshToonMaterial color={bodyColor} gradientMap={gradientMap} />
      </mesh>

      {/* Eyes */}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`eye-${x}`} position={[x, 1.88, 0.18]}>
          <sphereGeometry args={[0.04, 6, 4]} />
          <meshBasicMaterial color={hovered ? '#44ff88' : '#44aaff'} />
        </mesh>
      ))}

      {/* Antenna */}
      <mesh position={[0, 2.1, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.2, 4]} />
        <meshToonMaterial color="#666" gradientMap={gradientMap} />
      </mesh>
      <mesh position={[0, 2.22, 0]}>
        <sphereGeometry args={[0.04, 6, 4]} />
        <meshBasicMaterial color={hovered ? '#ff6644' : '#ff4444'} />
      </mesh>

      {/* Hover highlight ring */}
      {hovered && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6, 0.75, 16]} />
          <meshBasicMaterial color="#44aaff" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}
