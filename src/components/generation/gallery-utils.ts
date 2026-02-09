import type { GenerationWithOutputs } from '@/types/generation'

/**
 * Shared utility functions for the GenerationGallery component.
 * Extracted to reduce the main component file size.
 */

// Safe date formatter
export const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'Unknown date'
  try {
    return new Date(date).toLocaleDateString()
  } catch {
    return 'Invalid date'
  }
}

// Format model name with provider info from routing decision
export const formatModelWithProvider = (
  generation: GenerationWithOutputs
): { name: string; provider: string | null; isFallback: boolean } => {
  const params = generation.parameters
  const modelId = generation.modelId || 'unknown'

  // Check for provider route info (set by the routing system)
  const providerRoute = params?.providerRoute
  const costMetrics = params?.costMetrics

  // Determine provider from routing info or cost metrics
  let provider: string | null = null
  let isFallback = false

  if (providerRoute) {
    provider =
      providerRoute.provider === 'google'
        ? 'Google'
        : providerRoute.provider === 'replicate'
          ? 'Replicate'
          : null
    isFallback = providerRoute.isFallback === true
  } else if (costMetrics?.wasFallback) {
    provider = 'Replicate'
    isFallback = true
  } else if (costMetrics?.predictTime && modelId.startsWith('gemini-')) {
    provider = 'Replicate'
    isFallback = true
  } else if (modelId.startsWith('gemini-')) {
    provider = 'Google'
  } else if (modelId.startsWith('replicate-')) {
    provider = 'Replicate'
  }

  // Format the model name nicely
  let name = modelId.replace('gemini-', '').replace('replicate-', '').replace(/-/g, ' ')
  name = name
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return { name, provider, isFallback }
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')

export const getPublicStorageUrl = (bucket: string, path: string): string | null => {
  if (!SUPABASE_URL) return null
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

export const normalizeReferenceImageUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  if (value.startsWith('http') || value.startsWith('data:')) return value
  return null
}

// Helper to extract reference image URLs from generation parameters
export const getReferenceImageUrls = (generation: GenerationWithOutputs): string[] => {
  const params = generation.parameters
  const urls: string[] = []

  // Prefer referenceImages array (multiple images)
  if (Array.isArray(params.referenceImages) && params.referenceImages.length > 0) {
    for (const candidate of params.referenceImages) {
      const normalized = normalizeReferenceImageUrl(candidate)
      if (normalized) urls.push(normalized)
    }
  }

  // Fallback: referenceImageUrl directly (single image)
  if (urls.length === 0 && params.referenceImageUrl) {
    const normalized = normalizeReferenceImageUrl(params.referenceImageUrl)
    if (normalized) urls.push(normalized)
  }

  // Fallback: build from referenceImageId + Supabase storage path
  if (urls.length === 0 && params.referenceImageId && typeof params.referenceImageId === 'string') {
    const bucket = 'generated-images'
    const mime = (params as Record<string, unknown>).referenceImageMime
    const ext = typeof mime === 'string' && mime.includes('png') ? 'png' : 'jpg'
    const path = `references/${generation.userId}/${params.referenceImageId}.${ext}`
    const constructed = getPublicStorageUrl(bucket, path)
    if (constructed) urls.push(constructed)
  }

  return urls
}
