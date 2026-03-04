import * as THREE from 'three'

let _toonGradient3: THREE.DataTexture | null = null
let _toonGradient5: THREE.DataTexture | null = null

/**
 * 3-step toon gradient: shadow / mid / highlight.
 * Creates crisp cel-shading bands when used as `gradientMap` on MeshToonMaterial.
 */
export function getToonGradient3(): THREE.DataTexture {
  if (_toonGradient3) return _toonGradient3

  const colors = new Uint8Array([60, 130, 240])
  const texture = new THREE.DataTexture(colors, 3, 1, THREE.RedFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  _toonGradient3 = texture
  return texture
}

/**
 * 5-step toon gradient for smoother shading on larger surfaces.
 */
export function getToonGradient5(): THREE.DataTexture {
  if (_toonGradient5) return _toonGradient5

  const colors = new Uint8Array([40, 80, 130, 190, 245])
  const texture = new THREE.DataTexture(colors, 5, 1, THREE.RedFormat)
  texture.needsUpdate = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  _toonGradient5 = texture
  return texture
}
