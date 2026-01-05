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

export async function persistReferenceImage(
  base64DataUrl: string,
  userId: string,
  referenceImageId?: string,
  uploader?: Uploader
): Promise<ReferenceImagePointer> {
  const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!matches) {
    throw new Error('Invalid reference image format. Expected data URL.')
  }

  const [, mimeType, base64Payload] = matches
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

