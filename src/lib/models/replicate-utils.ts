/**
 * Replicate API Utilities
 * 
 * Shared utilities for submitting predictions to Replicate with webhook support.
 * This enables async generation without polling timeouts.
 */

const REPLICATE_API_KEY = process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY
const REPLICATE_BASE_URL = 'https://api.replicate.com/v1'

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
        enhance_prompt: true,
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
}

/**
 * Check if a model supports webhook-based generation
 */
export function supportsWebhook(modelId: string): boolean {
  return modelId in REPLICATE_MODEL_CONFIGS
}
