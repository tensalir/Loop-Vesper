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
  status?: 'completed' | 'processing'
  focused?: boolean
}

function createPixelShader() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor1: { value: new THREE.Color('#22cc66') },
      uColor2: { value: new THREE.Color('#115533') },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor1;
      uniform vec3 uColor2;
      varying vec2 vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      void main() {
        vec2 grid = floor(vUv * 8.0);
        float t = floor(uTime * 6.0);
        float noise = hash(grid + t);

        float scanline = step(0.5, fract(vUv.y * 16.0 - uTime * 2.0));
        float brightness = mix(0.3, 1.0, noise) * mix(0.7, 1.0, scanline);

        vec3 color = mix(uColor2, uColor1, noise * 0.7);
        color *= brightness;

        float border = step(0.08, vUv.x) * step(vUv.x, 0.92)
                     * step(0.08, vUv.y) * step(vUv.y, 0.92);
        color *= border;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    toneMapped: false,
  })
}

export function RobotBillboard({
  output,
  position,
  rotation = 0,
  onClick,
  status = 'completed',
  focused = false,
}: RobotBillboardProps) {
  const groupRef = useRef<THREE.Group>(null)
  const leftArmRef = useRef<THREE.Mesh>(null)
  const rightArmRef = useRef<THREE.Mesh>(null)
  const leftLegRef = useRef<THREE.Mesh>(null)
  const rightLegRef = useRef<THREE.Mesh>(null)
  const headRef = useRef<THREE.Mesh>(null)
  const torsoRef = useRef<THREE.Group>(null)

  const [hovered, setHovered] = useState(false)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const textureRef = useRef<THREE.Texture | null>(null)
  const pixelMatRef = useRef<THREE.ShaderMaterial | null>(null)
  const gradientMap = useMemo(() => getToonGradient3(), [])
  const idleOffset = useMemo(() => Math.random() * Math.PI * 2, [])
  const danceAmplitude = useRef(1)
  const isProcessing = status === 'processing'

  const pixelMaterial = useMemo(() => {
    if (!isProcessing) return null
    const mat = createPixelShader()
    pixelMatRef.current = mat
    return mat
  }, [isProcessing])

  useEffect(() => {
    if (isProcessing || output.fileType !== 'image') return

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
  }, [output.fileUrl, output.fileType, isProcessing])

  useFrame((state, delta) => {
    const targetAmp = focused ? 0 : 1
    danceAmplitude.current = THREE.MathUtils.lerp(danceAmplitude.current, targetAmp, delta * 5)
    const amp = danceAmplitude.current

    const t = state.clock.elapsedTime + idleOffset
    const bobSpeed = isProcessing ? 1.6 : 0.8
    const bobAmount = isProcessing ? 0.12 : 0.06

    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t * bobSpeed) * bobAmount * amp

      const cam = state.camera.position
      const faceAngle = Math.atan2(cam.x - position[0], cam.z - position[2])
      groupRef.current.rotation.y = faceAngle
    }

    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = Math.sin(t * 2.5) * 0.3 * amp
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.x = Math.sin(t * 2.5 + Math.PI) * 0.3 * amp
    }
    if (leftLegRef.current) {
      leftLegRef.current.rotation.x = Math.sin(t * 2.5 + Math.PI) * 0.15 * amp
    }
    if (rightLegRef.current) {
      rightLegRef.current.rotation.x = Math.sin(t * 2.5) * 0.15 * amp
    }
    if (headRef.current) {
      headRef.current.rotation.z = Math.sin(t * 1.5) * 0.1 * amp
    }
    if (torsoRef.current) {
      torsoRef.current.rotation.y = Math.sin(t * 1.0) * 0.05 * amp
    }

    if (pixelMatRef.current) {
      pixelMatRef.current.uniforms.uTime.value = state.clock.elapsedTime
    }
  })

  const bodyColor = isProcessing
    ? (hovered ? '#88cc99' : '#66aa77')
    : (hovered ? '#c0c0c0' : '#a0a0a8')
  const limbColor = isProcessing ? '#558866' : '#888890'
  const eyeColor = isProcessing ? '#44ff88' : (hovered ? '#44ff88' : '#44aaff')
  const antennaColor = isProcessing ? '#44ff88' : (hovered ? '#ff6644' : '#ff4444')

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotation, 0]}
      onClick={(e) => {
        e.stopPropagation()
        if (!isProcessing) onClick?.(output)
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = isProcessing ? 'wait' : 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
    >
      {/* Left leg */}
      <mesh ref={leftLegRef} position={[-0.2, 0.35, 0]} castShadow>
        <boxGeometry args={[0.15, 0.7, 0.15]} />
        <meshToonMaterial color={limbColor} gradientMap={gradientMap} />
      </mesh>
      {/* Right leg */}
      <mesh ref={rightLegRef} position={[0.2, 0.35, 0]} castShadow>
        <boxGeometry args={[0.15, 0.7, 0.15]} />
        <meshToonMaterial color={limbColor} gradientMap={gradientMap} />
      </mesh>

      {/* Torso group — holds body + chest screen + bezel */}
      <group ref={torsoRef}>
        <mesh position={[0, 1.1, 0]} castShadow>
          <boxGeometry args={[0.7, 0.9, 0.4]} />
          <meshToonMaterial color={bodyColor} gradientMap={gradientMap} />
        </mesh>

        {/* Chest screen */}
        <mesh position={[0, 1.15, 0.21]}>
          <planeGeometry args={[0.55, 0.55]} />
          {isProcessing && pixelMaterial ? (
            <primitive object={pixelMaterial} attach="material" />
          ) : texture ? (
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

        {/* Video play indicator */}
        {!isProcessing && output.fileType === 'video' && (
          <mesh position={[0, 1.15, 0.22]}>
            <circleGeometry args={[0.1, 6]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
          </mesh>
        )}
      </group>

      {/* Left arm */}
      <mesh ref={leftArmRef} position={[-0.48, 1.0, 0]} castShadow>
        <boxGeometry args={[0.12, 0.6, 0.12]} />
        <meshToonMaterial color={limbColor} gradientMap={gradientMap} />
      </mesh>
      {/* Right arm */}
      <mesh ref={rightArmRef} position={[0.48, 1.0, 0]} castShadow>
        <boxGeometry args={[0.12, 0.6, 0.12]} />
        <meshToonMaterial color={limbColor} gradientMap={gradientMap} />
      </mesh>

      {/* Head */}
      <mesh ref={headRef} position={[0, 1.85, 0]} castShadow>
        <boxGeometry args={[0.4, 0.35, 0.35]} />
        <meshToonMaterial color={bodyColor} gradientMap={gradientMap} />
      </mesh>

      {/* Eyes */}
      {[-0.1, 0.1].map((x) => (
        <mesh key={`eye-${x}`} position={[x, 1.88, 0.18]}>
          <sphereGeometry args={[0.04, 6, 4]} />
          <meshBasicMaterial color={eyeColor} />
        </mesh>
      ))}

      {/* Antenna */}
      <mesh position={[0, 2.1, 0]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.2, 4]} />
        <meshToonMaterial color="#666" gradientMap={gradientMap} />
      </mesh>
      <mesh position={[0, 2.22, 0]}>
        <sphereGeometry args={[0.04, 6, 4]} />
        <meshBasicMaterial color={antennaColor} />
      </mesh>

      {/* Hover / processing / focused ring */}
      {(hovered || isProcessing || focused) && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.6, 0.75, 16]} />
          <meshBasicMaterial
            color={isProcessing ? '#44ff88' : focused ? '#ffffff' : '#44aaff'}
            transparent
            opacity={isProcessing ? 0.5 : focused ? 0.6 : 0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}
