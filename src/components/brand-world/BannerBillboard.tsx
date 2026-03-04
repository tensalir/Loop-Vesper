'use client'

import { useRef, useState, useEffect } from 'react'
import * as THREE from 'three'
import type { PlacedBanner } from '@/lib/brand-world/placement'

interface BannerBillboardProps {
  banner: PlacedBanner
  stagePosition: [number, number, number]
}

export function BannerBillboard({ banner, stagePosition }: BannerBillboardProps) {
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

  const worldPos: [number, number, number] = [
    stagePosition[0] + slot.position[0],
    stagePosition[1] + slot.position[1],
    stagePosition[2] + slot.position[2],
  ]

  return (
    <group position={worldPos} rotation={slot.rotation}>
      {/* Banner frame */}
      <mesh ref={meshRef} castShadow>
        <planeGeometry args={[slot.size[0], slot.size[1]]} />
        {texture && !hasError ? (
          <meshStandardMaterial
            map={texture}
            roughness={0.3}
            metalness={0.1}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshStandardMaterial
            color={hasError ? '#333333' : '#1a1a2e'}
            roughness={0.5}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      {/* Frame border */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(slot.size[0], slot.size[1])]} />
        <lineBasicMaterial color="#666666" linewidth={1} />
      </lineSegments>

      {/* Video indicator */}
      {output.fileType === 'video' && (
        <mesh position={[0, 0, 0.01]}>
          <circleGeometry args={[0.4, 16]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  )
}
