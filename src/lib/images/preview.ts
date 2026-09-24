/**
 * Previews Claude can actually see.
 *
 * MCP image blocks used to carry the full-resolution PNG and an
 * `audience: ['user']` annotation. A 2K draw is 5-8 MB, far over the 450 KB
 * inline cap, so the image was usually dropped; when it did fit, the
 * annotation told the client to hide it from the model. The agent that asked
 * for the image could not read it back.
 *
 * A preview is a JPEG, long edge at most 1568 px (the size Claude's vision
 * reads without downscaling), quality lowered until it fits the cap. It is a
 * preview, labelled as such; the full-resolution file stays behind its link.
 */

import sharp from 'sharp'

export const PREVIEW_MAX_BYTES = 450_000
export const PREVIEW_LONG_EDGE = 1568
const QUALITIES = [85, 75, 65, 55, 45]
const MIN_LONG_EDGE = 512

export interface ImagePreview {
  /** base64 JPEG, no data-URL prefix. */
  data: string
  mimeType: 'image/jpeg'
  bytes: number
  width: number
  height: number
  quality: number
}

export async function makeImagePreview(
  input: Buffer,
  options: { maxBytes?: number; longEdge?: number } = {}
): Promise<ImagePreview> {
  const maxBytes = options.maxBytes ?? PREVIEW_MAX_BYTES
  let longEdge = options.longEdge ?? PREVIEW_LONG_EDGE

  for (;;) {
    for (const quality of QUALITIES) {
      const { data, info } = await sharp(input, { limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: longEdge, height: longEdge, fit: 'inside', withoutEnlargement: true })
        // JPEG has no alpha: a transparent clown model reads as white, not black.
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true })
      if (data.byteLength <= maxBytes) {
        return {
          data: data.toString('base64'),
          mimeType: 'image/jpeg',
          bytes: data.byteLength,
          width: info.width,
          height: info.height,
          quality,
        }
      }
    }
    if (longEdge <= MIN_LONG_EDGE) {
      throw new Error('Could not make a preview under the inline cap.')
    }
    longEdge = Math.max(MIN_LONG_EDGE, Math.round(longEdge * 0.75))
  }
}
