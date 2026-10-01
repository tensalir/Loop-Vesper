/**
 * Replicate API Utilities
 * 
 * Shared utilities for submitting predictions to Replicate with webhook support.
 * This enables async generation without polling timeouts.
 */

import { productPromptPassthrough, type GuardVocabulary } from '@/lib/prompts/product-prompt-guard'

const REPLICATE_API_KEY = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
const REPLICATE_BASE_URL = 'https://api.replicate.com/v1'

/**
 * Seedream's own prompt rewrite (`enhance_prompt`). Off for a prompt filled by code from a Loop
 * product skeleton or the CMF template, which no model rewrites (the kit lesson
 * `no-model-rewrite`); on for every other prompt, as before. Until 2026-10-01 it was on for every
 * prompt, so Seedream rewrote the skeletons Vesper's own rewrite leaves alone. The vocabulary is
 * the guard's (`loadGuardVocabulary`); without one, the guard's own copies.
 */
export function seedreamEnhancePrompt(prompt: string, vocabulary?: GuardVocabulary): boolean {
  return productPromptPassthrough(prompt, { vocabulary })?.reason !== 'skeleton'
}

export interface ReplicatePredictionInput {
  modelPath: string
  input: Record<string, any>
  webhookUrl?: string
  webhookEventsFilter?: ('start' | 'output' | 'logs' | 'completed')[]
}

export interface ReplicatePredictionResponse {
  predictionId: string
  status: string
  createdAt: string
}

/**
 * Get the latest version hash for a Replicate model
 */
export async function getModelVersion(modelPath: string): Promise<string> {
  if (!REPLICATE_API_KEY) {
    throw new Error('REPLICATE_API_TOKEN is not configured')
  }

  const response = await fetch(`${REPLICATE_BASE_URL}/models/${modelPath}`, {
    headers: {
      'Authorization': `Token ${REPLICATE_API_KEY}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch model info for ${modelPath}: ${errorText}`)
  }

  const modelData = await response.json()
  const versionHash = modelData.latest_version?.id

  if (!versionHash) {
    throw new Error(`Could not determine latest version for ${modelPath}`)
  }

  return versionHash
}

/**
 * Submit a prediction to Replicate with optional webhook
 * 
 * When a webhook URL is provided, Replicate will POST to it when the prediction completes.
 * This eliminates the need for polling and avoids serverless timeout issues.
 */
export async function submitReplicatePrediction(
  options: ReplicatePredictionInput
): Promise<ReplicatePredictionResponse> {
  if (!REPLICATE_API_KEY) {
    throw new Error('REPLICATE_API_TOKEN is not configured')
  }

  const { modelPath, input, webhookUrl, webhookEventsFilter } = options

  console.log(`[Replicate] Submitting prediction for ${modelPath}`)

  // Get latest model version
  const versionHash = await getModelVersion(modelPath)
  console.log(`[Replicate] Using version: ${versionHash}`)

  // Build prediction request
  const predictionRequest: Record<string, any> = {
    version: versionHash,
    input,
  }

  // Add webhook configuration if provided
  if (webhookUrl) {
    predictionRequest.webhook = webhookUrl
    predictionRequest.webhook_events_filter = webhookEventsFilter || ['completed']
    console.log(`[Replicate] Webhook configured: ${webhookUrl}`)
  }

  // Submit prediction
  const response = await fetch(`${REPLICATE_BASE_URL}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(predictionRequest),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      errorData.detail || errorData.error || `Replicate API error: ${response.status}`
    )
  }

  const data = await response.json()
  
  console.log(`[Replicate] Prediction submitted: ${data.id}, status: ${data.status}`)

  return {
    predictionId: data.id,
    status: data.status,
    createdAt: data.created_at,
  }
}

/**
 * Check the status of a prediction (for debugging/fallback)
 */
export async function getPredictionStatus(predictionId: string): Promise<{
  status: string
  output?: any
  error?: string
}> {
  if (!REPLICATE_API_KEY) {
    throw new Error('REPLICATE_API_TOKEN is not configured')
  }

  const response = await fetch(`${REPLICATE_BASE_URL}/predictions/${predictionId}`, {
    headers: {
      'Authorization': `Token ${REPLICATE_API_KEY}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get prediction status: ${response.status}`)
  }

  const data = await response.json()

  return {
    status: data.status,
    output: data.output,
    error: data.error,
  }
}

/**
 * Cancel a prediction
 */
export async function cancelPrediction(predictionId: string): Promise<void> {
  if (!REPLICATE_API_KEY) {
    throw new Error('REPLICATE_API_TOKEN is not configured')
  }

  const response = await fetch(`${REPLICATE_BASE_URL}/predictions/${predictionId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_API_KEY}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to cancel prediction: ${errorText}`)
  }

  console.log(`[Replicate] Prediction ${predictionId} cancelled`)
}

/** Replicate model path for Seedance 2.5. */
export const SEEDANCE_2_5_MODEL_PATH = 'bytedance/seedance-2.5'

/** Duration bounds accepted by Seedance 2.5 (`-1` = let the model choose). */
export const SEEDANCE_MIN_DURATION = 4
export const SEEDANCE_MAX_DURATION = 30
export const SEEDANCE_AUTO_DURATION = -1

/**
 * Normalize this app's numeric resolution setting to a Seedance tier.
 * Seedance 2.5 only offers 480p and 720p, so anything higher clamps down.
 */
export function normalizeSeedanceResolution(resolution: unknown): '480p' | '720p' {
  if (resolution === '480p' || resolution === '720p') return resolution
  const numeric = typeof resolution === 'number' ? resolution : Number(resolution)
  if (Number.isFinite(numeric) && numeric > 0 && numeric <= 480) return '480p'
  return '720p'
}

/** Clamp a requested duration into Seedance's accepted range. */
export function normalizeSeedanceDuration(duration: unknown): number {
  const numeric = typeof duration === 'number' ? duration : Number(duration)
  if (!Number.isFinite(numeric)) return 5
  if (numeric === SEEDANCE_AUTO_DURATION) return SEEDANCE_AUTO_DURATION
  return Math.min(SEEDANCE_MAX_DURATION, Math.max(SEEDANCE_MIN_DURATION, Math.round(numeric)))
}

/** Reference-set caps accepted by Seedance 2.5 in a single generation. */
export const SEEDANCE_MAX_REFERENCE_IMAGES = 30
export const SEEDANCE_MAX_REFERENCE_VIDEOS = 10
export const SEEDANCE_MAX_REFERENCE_AUDIOS = 10

/** Combined duration ceiling (seconds) across reference videos, and across audios. */
export const SEEDANCE_MAX_REFERENCE_MEDIA_SECONDS = 30

function toUrlList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    .slice(0, cap)
}

/**
 * Build the Replicate input payload for Seedance 2.5.
 *
 * Shared by the synchronous adapter and the webhook submission path so the
 * two cannot drift on Seedance's input constraints, which are unusually
 * strict and are all enforced here:
 *
 *  - `last_frame_image` requires `image`, and that first/last-frame mode
 *    only accepts `aspect_ratio: 'adaptive'` (the model derives the ratio
 *    from the supplied frames).
 *  - `reference_images` / `reference_videos` / `reference_audios` cannot be
 *    combined with `image` / `last_frame_image`. When a reference set is
 *    present it wins and the frames are dropped, so the payload is always
 *    valid regardless of what the caller passed.
 *  - `reference_audios` require at least one reference image or video.
 *  - Caps: 30 images, 10 videos, 10 audios.
 *  - `duration` is 4-30s, or -1 to let the model pick.
 *
 * Note the deliberate split in naming. `referenceImage` / `referenceImageUrl` /
 * `referenceImages` keep this app's long-standing "start frame" meaning (Kling
 * reads them the same way). Seedance's multimodal reference sets arrive under
 * the distinct `referenceImageUrls` / `referenceVideoUrls` / `referenceAudioUrls`
 * keys so the two concepts can never collide.
 */
export function buildSeedanceInput(params: Record<string, any>): Record<string, any> {
  const startImage =
    (Array.isArray(params.referenceImages) && params.referenceImages.length > 0
      ? params.referenceImages[0]
      : null) ||
    params.referenceImage ||
    params.referenceImageUrl ||
    null

  const endImage = params.endFrameImageUrl || null

  const referenceImages = toUrlList(params.referenceImageUrls, SEEDANCE_MAX_REFERENCE_IMAGES)
  const referenceVideos = toUrlList(params.referenceVideoUrls, SEEDANCE_MAX_REFERENCE_VIDEOS)
  // Audio is only meaningful alongside a visual reference; the API rejects it otherwise.
  const requestedAudios = toUrlList(params.referenceAudioUrls, SEEDANCE_MAX_REFERENCE_AUDIOS)
  const hasVisualReference = referenceImages.length > 0 || referenceVideos.length > 0
  const referenceAudios = hasVisualReference ? requestedAudios : []

  const usesReferenceSets = referenceImages.length > 0 || referenceVideos.length > 0

  const input: Record<string, any> = {
    prompt: params.prompt || '',
    duration: normalizeSeedanceDuration(params.duration),
    resolution: normalizeSeedanceResolution(params.resolution),
    generate_audio: params.generateAudio !== false, // Default true
    output_format: 'mp4',
  }

  if (usesReferenceSets) {
    // Reference-set mode. Frames are mutually exclusive with these, so they go.
    if (referenceImages.length > 0) input.reference_images = referenceImages
    if (referenceVideos.length > 0) input.reference_videos = referenceVideos
    if (referenceAudios.length > 0) input.reference_audios = referenceAudios
    input.aspect_ratio = params.aspectRatio || '16:9'
  } else {
    if (startImage) {
      input.image = startImage
    }

    if (startImage && endImage) {
      // First/last-frame mode: Seedance rejects a fixed ratio here.
      input.last_frame_image = endImage
      input.aspect_ratio = 'adaptive'
    } else {
      input.aspect_ratio = params.aspectRatio || '16:9'
    }
  }

  if (typeof params.seed === 'number') {
    input.seed = params.seed
  }

  return input
}

/**
 * True when the payload carries reference videos, which moves Seedance onto
 * Replicate's `video_in` billing tier (roughly 4x the per-second rate).
 */
export function seedanceUsesVideoInput(params: Record<string, any> | null | undefined): boolean {
  if (!params) return false
  return toUrlList(params.referenceVideoUrls, SEEDANCE_MAX_REFERENCE_VIDEOS).length > 0
}

/**
 * Model configurations for webhook-based submission
 */
export const REPLICATE_MODEL_CONFIGS: Record<string, {
  modelPath: string
  buildInput: (params: any) => Record<string, any>
}> = {
  'replicate-seedream-4': {
    modelPath: 'bytedance/seedream-4.5',
    buildInput: (params) => {
      const input: Record<string, any> = {
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio || '1:1',
        size: params.resolution === 4096 ? '4K' : '2K',
        sequential_image_generation: (params.numOutputs || 1) > 1 ? 'auto' : 'disabled',
        max_images: params.numOutputs || 1,
        enhance_prompt: seedreamEnhancePrompt(params.prompt, params.guardVocabulary),
      }

      // Add reference images if provided
      const referenceImages = params.referenceImages || 
        (params.referenceImage ? [params.referenceImage] : [])
      
      if (referenceImages.length > 0) {
        input.image_input = referenceImages
      }

      return input
    },
  },
  'gemini-nano-banana-pro': {
    modelPath: 'google/nano-banana-pro',
    buildInput: (params) => {
      const input: Record<string, any> = {
        prompt: params.prompt,
        aspect_ratio: params.aspectRatio || '1:1',
        output_format: 'png',
        safety_tolerance: 2,
      }

      // Resolution mapping
      if (params.resolution) {
        const resolution = params.resolution === 4096 ? '4K' : 
          params.resolution === 2048 ? '2K' : '1K'
        input.resolution = resolution
      }

      // Add reference images if provided
      const referenceImages = params.referenceImages || 
        (params.referenceImage ? [params.referenceImage] : [])
      
      if (referenceImages.length > 0) {
        input.image_input = referenceImages
      }

      return input
    },
  },
  // VIDEO MODELS - use webhooks to avoid Vercel timeout issues
  'replicate-kling-2.6': {
    modelPath: 'kwaivgi/kling-v2.6',
    buildInput: (params) => {
      const input: Record<string, any> = {
        prompt: params.prompt,
        duration: params.duration || 5,
        aspect_ratio: params.aspectRatio || '16:9',
        generate_audio: params.generateAudio !== false, // Default true
      }

      // Add negative prompt if provided
      if (params.negativePrompt) {
        input.negative_prompt = params.negativePrompt
      }

      // Add start image for image-to-video
      const referenceImages = params.referenceImages || 
        (params.referenceImage ? [params.referenceImage] : [])
      
      if (referenceImages.length > 0) {
        input.start_image = referenceImages[0]
      } else if (params.referenceImageUrl) {
        input.start_image = params.referenceImageUrl
      }

      // Add end image for frame-to-frame interpolation
      if (params.endFrameImageUrl) {
        input.end_image = params.endFrameImageUrl
      }

      return input
    },
  },
  'replicate-seedance-2.5': {
    modelPath: SEEDANCE_2_5_MODEL_PATH,
    buildInput: buildSeedanceInput,
  },
}

/**
 * Check if a model supports webhook-based generation
 */
export function supportsWebhook(modelId: string): boolean {
  return modelId in REPLICATE_MODEL_CONFIGS
}
