'use client'

import { useRef, useState, useEffect } from 'react'
import * as THREE from 'three'
import type { PlacedBanner } from '@/lib/brand-world/placement'

interface BannerBillboardProps {
  banner: PlacedBanner
  stagePosition: [number, number, number]
  stageScale: number
}

export function BannerBillboard({ banner, stagePosition, stageScale }: BannerBillboardProps) {
  const { slot, output } = banner
  const meshRef = useRef<THREE.Mesh>(null)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const [hasError, setHasError] = useState(false)
  const textureRef = useRef<THREE.Texture | null>(null)

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
      () => setHasError(true)
    )

    return () => {
      textureRef.current?.dispose()
      textureRef.current = null
    }
  }, [output.fileUrl, output.fileType])

  const s = stageScale
  const worldPos: [number, number, number] = [
    stagePosition[0] + slot.position[0] * s,
    stagePosition[1] + slot.position[1] * s,
    stagePosition[2] + slot.position[2] * s,
  ]

  return (
    <group position={worldPos} rotation={slot.rotation} scale={[s, s, s]}>
      {/* Banner surface — meshBasicMaterial so photos render unshaded */}
      <mesh ref={meshRef} castShadow>
        <planeGeometry args={[slot.size[0], slot.size[1]]} />
        {texture && !hasError ? (
          <meshBasicMaterial
            map={texture}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        ) : (
          <meshBasicMaterial
            color={hasError ? '#3a2a2a' : '#1a1a2e'}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      {/* Frame border */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(slot.size[0], slot.size[1])]} />
        <lineBasicMaterial color="#887766" linewidth={1} />
      </lineSegments>

      {/* Video play indicator */}
      {output.fileType === 'video' && (
        <group position={[0, 0, 0.02]}>
          <mesh>
            <circleGeometry args={[0.5, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
          </mesh>
          <mesh position={[0.1, 0, 0.01]}>
            <coneGeometry args={[0.2, 0.35, 3]} />
            <meshBasicMaterial color="#333333" />
          </mesh>
        </group>
      )}
    </group>
  )
}
