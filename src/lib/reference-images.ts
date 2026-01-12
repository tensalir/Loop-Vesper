import { createHash } from 'crypto'

export interface ReferenceImagePointer {
  referenceImageId: string
  referenceImageBucket: string
  referenceImagePath: string
  referenceImageUrl: string
  referenceImageChecksum: string
  referenceImageMimeType: string
}

const DEFAULT_BUCKET = 'generated-images'
type Uploader = (base64DataUrl: string, bucket: string, path: string) => Promise<string>

function parseBase64DataUrl(value: string): { mimeType: string; base64Payload: string } {
  // Expected format: data:<mimeType>[;param...];base64,<payload>
  // Avoid regex here: extremely large strings can cause RegExp engines to blow the stack.
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    throw new Error('Invalid reference image format. Expected data URL.')
  }

  const commaIndex = value.indexOf(',')
  if (commaIndex === -1) {
    throw new Error('Invalid reference image format. Expected data URL with comma separator.')
  }

  const meta = value.slice('data:'.length, commaIndex) // e.g. "image/png;base64" or "image/jpeg;charset=utf-8;base64"
  const base64Payload = value.slice(commaIndex + 1)

  // Guardrail: avoid trying to hash/upload extremely large payloads (usually accidental video/file paste)
  // ~25MB of base64 chars is already far beyond what we want for reference images.
  const MAX_BASE64_CHARS = 25_000_000
  if (base64Payload.length > MAX_BASE64_CHARS) {
    throw new Error(
      `Reference image too large (${(base64Payload.length / (1024 * 1024)).toFixed(1)}MB base64). ` +
      `Please use a smaller image.`
    )
  }

  const parts = meta.split(';').filter(Boolean)
  const mimeType = parts[0] || 'application/octet-stream'
  const isBase64 = parts.includes('base64')
  if (!isBase64) {
    throw new Error('Invalid reference image format. Expected base64-encoded data URL.')
  }

  return { mimeType, base64Payload }
}

export async function persistReferenceImage(
  base64DataUrl: string,
  userId: string,
  referenceImageId?: string,
  uploader?: Uploader
): Promise<ReferenceImagePointer> {
  const { mimeType, base64Payload } = parseBase64DataUrl(base64DataUrl)
  const extension = mimeType.includes('png') ? 'png' : 'jpg'
  const checksum = createHash('sha256').update(base64Payload).digest('hex')
  const pointerId = referenceImageId || `ref-${Date.now()}`
  const storagePath = `references/${userId}/${pointerId}.${extension}`
  const resolvedUploader =
    uploader ?? (await import('@/lib/supabase/storage')).uploadBase64ToStorage
  const publicUrl = await resolvedUploader(base64DataUrl, DEFAULT_BUCKET, storagePath)

  return {
    referenceImageId: pointerId,
    referenceImageBucket: DEFAULT_BUCKET,
    referenceImagePath: storagePath,
    referenceImageUrl: publicUrl,
    referenceImageChecksum: checksum,
    referenceImageMimeType: mimeType,
  }
}

/**
 * Persist multiple reference images to storage in parallel.
 * Returns an array of public URLs for the uploaded images.
 * 
 * @param base64DataUrls - Array of base64 data URLs to upload
 * @param userId - User ID for storage path organization
 * @param generationId - Generation ID for creating unique reference IDs
 * @param uploader - Optional custom uploader function (for testing)
 * @returns Array of public URLs for the uploaded images
 */
export async function persistReferenceImages(
  base64DataUrls: string[],
  userId: string,
  generationId: string,
  uploader?: Uploader
): Promise<string[]> {
  // Import p-limit dynamically to handle ESM module
  const pLimit = (await import('p-limit')).default
  const limit = pLimit(3) // Max 3 concurrent uploads
  
  const results = await Promise.all(
    base64DataUrls.map((dataUrl, index) =>
      limit(async () => {
        const pointer = await persistReferenceImage(
          dataUrl,
          userId,
          `ref-${generationId}-${index}`,
          uploader
        )
        return pointer.referenceImageUrl
      })
    )
  )
  
  return results
}

export async function downloadReferenceImageAsDataUrl(
  url: string,
  mimeHint?: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const response = await fetcher(url)
  if (!response.ok) {
    throw new Error(`Failed to download reference image: ${response.status} ${response.statusText}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const mimeType = mimeHint || response.headers.get('content-type') || 'image/jpeg'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

