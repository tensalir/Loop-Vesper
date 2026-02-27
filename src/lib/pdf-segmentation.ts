/**
 * Browser-side segmentation adapter for PDF page images.
 *
 * Strategy: send rendered page bitmaps to a server-side Claude endpoint
 * that identifies visual regions (photos, illustrations, diagrams) and
 * returns crop coordinates. The client then crops the images locally.
 *
 * Feature-flagged: only runs when explicitly requested by the user.
 */

export interface SegmentCandidate {
  blob: Blob
  file: File
  width: number
  height: number
  label: string
  pageIndex: number
}

export interface CropRegion {
  x: number
  y: number
  width: number
  height: number
  label: string
  confidence: number
}

export interface RenderedPageImage {
  blob: Blob
  file: File
  width: number
  height: number
  pageIndex: number
  source: 'rendered'
}

export interface SegmentedImage {
  blob: Blob
  file: File
  width: number
  height: number
  pageIndex: number
  source: 'segmented'
}

function detectVisualRegionsFromBitmap(
  canvas: HTMLCanvasElement,
  pageIndex: number
): CropRegion[] {
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  const { width, height } = canvas
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const visited = new Uint8Array(width * height)
  const regions: CropRegion[] = []
  const stackX: number[] = []
  const stackY: number[] = []
  const pageArea = width * height

  const isVisualPixel = (idx: number) => {
    const alpha = data[idx + 3]
    if (alpha < 32) return false
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    // Treat near-black background as non-visual; keep actual image content.
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return luminance > 24
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (visited[p]) continue
      visited[p] = 1

      const idx = p * 4
      if (!isVisualPixel(idx)) continue

      let minX = x
      let minY = y
      let maxX = x
      let maxY = y
      let area = 0

      stackX.push(x)
      stackY.push(y)

      while (stackX.length > 0) {
        const cx = stackX.pop()!
        const cy = stackY.pop()!
        const cp = cy * width + cx
        const cidx = cp * 4
        if (!isVisualPixel(cidx)) continue

        area += 1
        if (cx < minX) minX = cx
        if (cy < minY) minY = cy
        if (cx > maxX) maxX = cx
        if (cy > maxY) maxY = cy

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ]
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const np = ny * width + nx
          if (visited[np]) continue
          visited[np] = 1
          stackX.push(nx)
          stackY.push(ny)
        }
      }

      const regionWidth = maxX - minX + 1
      const regionHeight = maxY - minY + 1
      const boxArea = regionWidth * regionHeight
      const areaRatio = boxArea / pageArea

      // Filter tiny text/noise and near-full-page captures.
      if (boxArea < 10_000 || area < 2_500) continue
      if (areaRatio < 0.003 || areaRatio > 0.72) continue
      if (regionWidth < 80 || regionHeight < 80) continue

      const pad = 8
      regions.push({
        x: Math.max(0, minX - pad),
        y: Math.max(0, minY - pad),
        width: Math.min(width - Math.max(0, minX - pad), regionWidth + pad * 2),
        height: Math.min(height - Math.max(0, minY - pad), regionHeight + pad * 2),
        label: `visual-${pageIndex + 1}-${regions.length + 1}`,
        confidence: 0.5,
      })
    }
  }

  return regions
}

/**
 * Ask Claude to identify image regions in a rendered PDF page.
 * Returns crop coordinates for each detected visual element.
 */
export async function identifyImageRegions(
  pageImageBlob: Blob,
  projectId: string
): Promise<CropRegion[]> {
  const formData = new FormData()
  formData.append('image', pageImageBlob)

  const res = await fetch(`/api/projects/${projectId}/pdf-buckets/segment`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) return []

  const data = await res.json()
  return data.regions ?? []
}

/**
 * Crop a specific region from a source canvas/image.
 */
export function cropRegion(
  sourceImage: HTMLCanvasElement | HTMLImageElement,
  region: CropRegion
): { blob: Blob; file: File } | null {
  const canvas = document.createElement('canvas')
  canvas.width = region.width
  canvas.height = region.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(
    sourceImage,
    region.x, region.y, region.width, region.height,
    0, 0, region.width, region.height
  )

  let result: { blob: Blob; file: File } | null = null
  canvas.toBlob((blob) => {
    if (blob) {
      const file = new File([blob], `segment-${region.label}.png`, { type: 'image/png' })
      result = { blob, file }
    }
  }, 'image/png')

  return result
}

/**
 * Process rendered page images through the segmentation pipeline.
 * Returns cropped candidate images for each detected region.
 */
export async function segmentPageImages(
  pageImages: Array<{ blob: Blob; canvas: HTMLCanvasElement; pageIndex: number }>,
  projectId: string,
  onProgress?: (msg: string) => void
): Promise<SegmentCandidate[]> {
  const candidates: SegmentCandidate[] = []

  for (let i = 0; i < pageImages.length; i++) {
    const { blob, canvas, pageIndex } = pageImages[i]
    onProgress?.(`Analyzing page ${i + 1}/${pageImages.length}...`)

    const regions = await identifyImageRegions(blob, projectId)

    for (const region of regions) {
      if (region.width < 64 || region.height < 64) continue

      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = region.width
      cropCanvas.height = region.height
      const ctx = cropCanvas.getContext('2d')
      if (!ctx) continue

      ctx.drawImage(
        canvas,
        region.x, region.y, region.width, region.height,
        0, 0, region.width, region.height
      )

      const cropBlob = await new Promise<Blob | null>((resolve) =>
        cropCanvas.toBlob(resolve, 'image/png')
      )
      if (!cropBlob) continue

      const file = new File(
        [cropBlob],
        `pdf-seg-p${pageIndex + 1}-${region.label.replace(/\s+/g, '-')}.png`,
        { type: 'image/png' }
      )

      candidates.push({
        blob: cropBlob,
        file,
        width: region.width,
        height: region.height,
        label: region.label,
        pageIndex,
      })
    }
  }

  return candidates
}

/**
 * Check if segmentation is available (feature flag).
 */
export function isSegmentationEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const setting = localStorage.getItem('vesper_pdf_segmentation')
    if (setting === null) return true
    return setting === 'true'
  } catch {
    return true
  }
}

export async function segmentRenderedImages(
  renderedImages: RenderedPageImage[],
  projectId: string
): Promise<SegmentedImage[]> {
  const segmented: SegmentedImage[] = []

  for (const rendered of renderedImages) {
    let regions = await identifyImageRegions(rendered.blob, projectId)
    const imageBitmap = await createImageBitmap(rendered.blob)
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = rendered.width
    pageCanvas.height = rendered.height
    const pageCtx = pageCanvas.getContext('2d')
    if (!pageCtx) continue
    pageCtx.drawImage(imageBitmap, 0, 0)
    imageBitmap.close()

    if (regions.length === 0) {
      regions = detectVisualRegionsFromBitmap(pageCanvas, rendered.pageIndex)
    }
    if (regions.length === 0) continue

    const pageArea = rendered.width * rendered.height
    const filteredRegions = regions.filter((region) => {
      const areaRatio = (region.width * region.height) / pageArea
      // Reject near-full-page crops; those are usually the background slide itself.
      return areaRatio >= 0.015 && areaRatio <= 0.75 && region.confidence >= 0.35
    })

    for (const region of filteredRegions) {
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = region.width
      cropCanvas.height = region.height
      const cropCtx = cropCanvas.getContext('2d')
      if (!cropCtx) continue

      cropCtx.drawImage(
        pageCanvas,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        region.width,
        region.height
      )

      const cropBlob = await new Promise<Blob | null>((resolve) =>
        cropCanvas.toBlob(resolve, 'image/png')
      )
      if (!cropBlob) continue

      segmented.push({
        blob: cropBlob,
        file: new File(
          [cropBlob],
          `pdf-segmented-p${rendered.pageIndex + 1}-${segmented.length}.png`,
          { type: 'image/png' }
        ),
        width: region.width,
        height: region.height,
        pageIndex: rendered.pageIndex,
        source: 'segmented',
      })
    }
  }

  return segmented
}
