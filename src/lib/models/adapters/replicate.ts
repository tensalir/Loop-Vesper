import { BaseModelAdapter, ModelConfig, GenerationRequest, GenerationResponse } from '../base'
import { recordApiCall } from '@/lib/rate-limits/usage'
import { getScopeForModel } from '@/lib/rate-limits/config'
import { loadGuardVocabulary } from '@/lib/prompts/product-prompt-guard'
import {
  buildSeedanceInput,
  seedreamEnhancePrompt,
  SEEDANCE_2_5_MODEL_PATH,
  SEEDANCE_MAX_REFERENCE_AUDIOS,
  SEEDANCE_MAX_REFERENCE_IMAGES,
  SEEDANCE_MAX_REFERENCE_VIDEOS,
} from '../replicate-utils'

// Support both REPLICATE_API_TOKEN (official) and REPLICATE_API_KEY (legacy)
// Only check env vars on server side (they're not available in browser)
const REPLICATE_API_KEY = typeof window === 'undefined' 
  ? (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY)
  : null

if (typeof window === 'undefined' && !REPLICATE_API_KEY) {
  console.warn('REPLICATE_API_TOKEN is not set. Replicate models will not work. Get your key from: https://replicate.com/account/api-tokens')
}

/**
 * Nano Banana Pro (Backup) Model Configuration
 * Google's Nano Banana Pro via Replicate - use when Google's API has issues
 * Documentation: https://replicate.com/google/nano-banana-pro
 */
export const NANO_BANANA_BACKUP_CONFIG: ModelConfig = {
  id: 'replicate-nano-banana-pro',
  name: 'Nano Banana Pro (Backup)',
  provider: 'Google (Replicate)',
  type: 'image',
  description: 'Same as Nano Banana Pro but via Replicate - use when Google API has timeouts or quota issues',
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  defaultAspectRatio: '1:1',
  maxResolution: 4096,
  capabilities: {
    editing: true,
    'text-2-image': true,
    multiImageEditing: true,
    maxReferenceImages: 14, // Per Gemini API docs: up to 14 reference images
  },
  parameters: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: '1:1 (Square)', value: '1:1' },
        { label: '16:9 (Landscape)', value: '16:9' },
        { label: '9:16 (Portrait)', value: '9:16' },
        { label: '4:3 (Landscape)', value: '4:3' },
        { label: '3:4 (Portrait)', value: '3:4' },
        { label: '3:2 (Landscape)', value: '3:2' },
        { label: '2:3 (Portrait)', value: '2:3' },
        { label: '21:9 (Ultrawide)', value: '21:9' },
      ],
    },
    {
      name: 'resolution',
      type: 'select',
      label: 'Resolution',
      default: 1024,
      options: [
        { label: '1K', value: 1024 },
        { label: '2K', value: 2048 },
        { label: '4K', value: 4096 },
      ],
    },
    {
      name: 'numOutputs',
      type: 'select',
      label: 'Images',
      default: 1,
      options: [
        { label: '1 image', value: 1 },
      ],
    },
  ],
}

/**
 * Seedream 4.5 Model Configuration
 * Next-gen image generation model by ByteDance via Replicate
 * Documentation: https://replicate.com/bytedance/seedream-4.5
 */
export const SEEDREAM_4_CONFIG: ModelConfig = {
  id: 'replicate-seedream-4',
  name: 'Seedream 4.5',
  provider: 'ByteDance (Replicate)',
  type: 'image',
  description: 'Seedream 4.5 - Superior aesthetics, stronger spatial understanding, and richer world knowledge at up to 4K resolution',
  supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  defaultAspectRatio: '1:1',
  maxResolution: 4096,
  capabilities: {
    editing: true,
    'text-2-image': true,
    'image-2-image': true,
    multiImageEditing: true, // Seedream 4.5 supports 1-14 reference images
    maxReferenceImages: 14, // Per Seedream docs: up to 14 reference images
  },
  parameters: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: '1:1 (Square)', value: '1:1' },
        { label: '16:9 (Landscape)', value: '16:9' },
        { label: '9:16 (Portrait)', value: '9:16' },
        { label: '4:3 (Landscape)', value: '4:3' },
        { label: '3:4 (Portrait)', value: '3:4' },
      ],
    },
    {
      name: 'resolution',
      type: 'select',
      label: 'Resolution',
      default: 2048,
      options: [
        { label: '2K', value: 2048 },
        { label: '4K', value: 4096 },
      ],
    },
    {
      name: 'numOutputs',
      type: 'number',
      label: 'Number of outputs',
      min: 1,
      max: 4,
      default: 1,
      options: [
        { label: '1', value: 1 },
        { label: '4', value: 4 },
      ],
    },
  ],
}

/**
 * Reve Model Configuration
 * Image generation model from Reve via Replicate
 * Documentation: https://replicate.com/reve/create
 */
export const REVE_CONFIG: ModelConfig = {
  id: 'replicate-reve',
  name: 'Reve',
  provider: 'Reve (Replicate)',
  type: 'image',
  description: 'High-quality image generation with professional-level editing via natural language prompts',
  supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
  defaultAspectRatio: '1:1',
  maxResolution: 2048,
  capabilities: {
    'text-2-image': true,
  },
  parameters: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: '1:1 (Square)', value: '1:1' },
        { label: '16:9 (Landscape)', value: '16:9' },
        { label: '9:16 (Portrait)', value: '9:16' },
        { label: '4:3 (Landscape)', value: '4:3' },
        { label: '3:4 (Portrait)', value: '3:4' },
      ],
    },
    {
      name: 'numOutputs',
      type: 'number',
      label: 'Number of outputs',
      min: 1,
      max: 4,
      default: 1,
      options: [
        { label: '1', value: 1 },
        { label: '4', value: 4 },
      ],
    },
  ],
}

/**
 * Kling 2.6 Pro Model Configuration
 * Top-tier image-to-video with cinematic visuals, fluid motion, and native audio generation
 * Documentation: https://replicate.com/kwaivgi/kling-v2.6
 */
export const KLING_2_6_CONFIG: ModelConfig = {
  id: 'replicate-kling-2.6',
  name: 'Kling 2.6 Pro',
  provider: 'Kuaishou (Replicate)',
  type: 'video',
  description: 'Top-tier image-to-video with cinematic visuals, fluid motion, and native audio generation',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultAspectRatio: '16:9',
  maxResolution: 1080,
  capabilities: {
    'text-2-video': true,
    'image-2-video': true,
    // Note: frame-interpolation NOT supported via Replicate wrapper - use kling-official instead
    audioGeneration: true,
  },
  parameters: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: '16:9 (Landscape)', value: '16:9' },
        { label: '9:16 (Portrait)', value: '9:16' },
        { label: '1:1 (Square)', value: '1:1' },
      ],
    },
    {
      name: 'duration',
      type: 'select',
      label: 'Duration',
      options: [
        { label: '5 seconds', value: 5 },
        { label: '10 seconds', value: 10 },
      ],
    },
    {
      name: 'generateAudio',
      type: 'boolean',
      label: 'Generate Audio',
      default: true,
    },
    {
      name: 'numOutputs',
      type: 'number',
      label: 'Number of outputs',
      min: 1,
      max: 1,
      default: 1,
      options: [
        { label: '1', value: 1 },
      ],
    },
  ],
}

/**
 * Seedance 2.5 Model Configuration
 * ByteDance's flagship multimodal video model via Replicate
 * Documentation: https://replicate.com/bytedance/seedance-2.5
 *
 * Notable vs Kling 2.6: native 30-second generation in a single pass, native
 * synchronized audio, and first/last-frame keyframe control. Resolution tops
 * out at 720p — there is no 1080p tier.
 */
export const SEEDANCE_2_5_CONFIG: ModelConfig = {
  id: 'replicate-seedance-2.5',
  name: 'Seedance 2.5',
  provider: 'ByteDance (Replicate)',
  type: 'video',
  description: 'Flagship multimodal video model with native synchronized audio, up to 30 seconds in one pass, and start/end frame control',
  supportedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  defaultAspectRatio: '16:9',
  maxResolution: 720,
  capabilities: {
    'text-2-video': true,
    'image-2-video': true,
    'frame-interpolation': true, // Native first + last frame support
    audioGeneration: true,
    // Multimodal reference sets - 50 files total, and mutually exclusive
    // with the first/last frame inputs.
    multiImageEditing: true,
    maxReferenceImages: SEEDANCE_MAX_REFERENCE_IMAGES,
    maxReferenceVideos: SEEDANCE_MAX_REFERENCE_VIDEOS,
    maxReferenceAudios: SEEDANCE_MAX_REFERENCE_AUDIOS,
    referenceSetsExcludeFrames: true,
  },
  parameters: [
    {
      name: 'aspectRatio',
      type: 'select',
      label: 'Aspect Ratio',
      options: [
        { label: '16:9 (Landscape)', value: '16:9' },
        { label: '9:16 (Portrait)', value: '9:16' },
        { label: '1:1 (Square)', value: '1:1' },
        { label: '4:3 (Landscape)', value: '4:3' },
        { label: '3:4 (Portrait)', value: '3:4' },
        { label: '21:9 (Ultrawide)', value: '21:9' },
      ],
    },
    {
      name: 'resolution',
      type: 'select',
      label: 'Resolution',
      default: 720,
      options: [
        { label: '480p', value: 480 },
        { label: '720p', value: 720 },
      ],
    },
    {
      name: 'duration',
      type: 'select',
      label: 'Duration',
      default: 5,
      options: [
        { label: '5 seconds', value: 5 },
        { label: '10 seconds', value: 10 },
        { label: '15 seconds', value: 15 },
        { label: '20 seconds', value: 20 },
        { label: '30 seconds', value: 30 },
      ],
    },
    {
      name: 'generateAudio',
      type: 'boolean',
      label: 'Generate Audio',
      default: true,
    },
    {
      name: 'numOutputs',
      type: 'number',
      label: 'Number of outputs',
      min: 1,
      max: 1,
      default: 1,
      options: [
        { label: '1', value: 1 },
      ],
    },
  ],
}

/**
 * Replicate API Adapter
 * Handles image generation via Replicate.com
 * Documentation: https://replicate.com/docs
 */
export class ReplicateAdapter extends BaseModelAdapter {
  private apiKey: string
  private baseUrl = 'https://api.replicate.com/v1'

  constructor(config: ModelConfig) {
    super(config)
    this.apiKey = REPLICATE_API_KEY || ''
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    this.validateRequest(request)

    try {
      if (this.config.type === 'image') {
        return await this.generateImage(request)
      } else {
        return await this.generateVideo(request)
      }
    } catch (error: any) {
      return {
        id: `error-${Date.now()}`,
        status: 'failed',
        error: error.message || 'Generation failed',
      }
    }
  }

  private async generateImage(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('REPLICATE_API_TOKEN is not configured. Please add your Replicate API token to .env.local and restart the dev server. Get your token from: https://replicate.com/account/api-tokens')
    }

    const {
      prompt,
      parameters = {},
      referenceImage,
    } = request

    // Map aspect ratios to Replicate format
    const aspectRatioMap: Record<string, string> = {
      '1:1': '1:1',
      '16:9': '16:9',
      '9:16': '9:16',
      '4:3': '4:3',
      '3:4': '3:4',
    }

    // Get parameters with safe fallbacks
    const aspectRatio = parameters?.aspectRatio || request.aspectRatio || '1:1'
    const numOutputs = parameters?.numOutputs || request.numOutputs || 1

    try {
      // Determine which Replicate model to use based on config
      let modelPath: string
      if (this.config.id === 'replicate-seedream-4') {
        modelPath = 'bytedance/seedream-4.5' // Upgraded to Seedream 4.5
      } else if (this.config.id === 'replicate-reve') {
        modelPath = 'reve/create'
      } else if (this.config.id === 'replicate-nano-banana-pro') {
        modelPath = 'google/nano-banana-pro'
      } else {
        throw new Error(`Unknown Replicate model: ${this.config.id}`)
      }

      // Prepare model-specific input
      const input: any = {
        prompt,
        aspect_ratio: aspectRatioMap[aspectRatio] || aspectRatio,
      }

      // Seedream 4.5 specific parameters
      if (this.config.id === 'replicate-seedream-4') {
        // Map resolution from request to Seedream 4.5 format: '2K' (2048px) or '4K' (4096px)
        // Default to 2K if not specified
        const resolution = parameters?.resolution || request.resolution
        const size = resolution === 4096 ? '4K' : '2K'
        input.size = size
        console.log(`[Seedream-4.5] Using resolution: ${size} (from ${resolution || 'default'})`)
        input.sequential_image_generation = numOutputs > 1 ? 'auto' : 'disabled'
        input.max_images = numOutputs
        // Seedream's own rewrite, except for a code-filled Loop product prompt (replicate-utils).
        input.enhance_prompt = seedreamEnhancePrompt(prompt, await loadGuardVocabulary())
        if (!input.enhance_prompt) console.log('[Seedream-4.5] Code-filled product prompt: enhance_prompt off')

        // Debug: Log all possible reference image sources
        console.log('[Seedream-4.5] Debug - Reference image sources:')
        console.log(`  - request.referenceImages: ${request.referenceImages ? `array with ${request.referenceImages.length} items` : 'undefined'}`)
        console.log(`  - request.referenceImage: ${referenceImage ? `string (${referenceImage.substring(0, 30)}...)` : 'undefined'}`)
        console.log(`  - request.referenceImageUrl: ${request.referenceImageUrl || 'undefined'}`)

        // Build reference images array from all possible sources
        let referenceImages: string[] = []
        
        // 1. Check for referenceImages array (multiple images)
        if (request.referenceImages && Array.isArray(request.referenceImages) && request.referenceImages.length > 0) {
          referenceImages = request.referenceImages
          console.log(`[Seedream-4.5] Using referenceImages array: ${referenceImages.length} image(s)`)
        }
        // 2. Check for single referenceImage (data URL)
        else if (referenceImage && typeof referenceImage === 'string' && referenceImage.length > 0) {
          referenceImages = [referenceImage]
          console.log(`[Seedream-4.5] Using single referenceImage`)
        }
        // 3. Check for referenceImageUrl (public URL)
        else if (request.referenceImageUrl && typeof request.referenceImageUrl === 'string') {
          referenceImages = [request.referenceImageUrl]
          console.log(`[Seedream-4.5] Using referenceImageUrl: ${request.referenceImageUrl.substring(0, 50)}...`)
        }

        if (referenceImages.length > 0) {
          // Seedream 4.5 accepts 1-14 images via image_input array
          input.image_input = referenceImages
          console.log(`[Seedream-4.5] ✅ Passing ${referenceImages.length} reference image(s) to API`)
          console.log(`[Seedream-4.5] First image type: ${referenceImages[0]?.startsWith('data:') ? 'data URL' : referenceImages[0]?.startsWith('http') ? 'public URL' : 'unknown'}`)
          console.log(`[Seedream-4.5] First image length: ${referenceImages[0]?.length || 0} chars`)
        } else {
          console.log('[Seedream-4.5] ⚠️ No reference image provided - generating text-to-image only')
        }
      }

      // Nano Banana Pro (Backup) specific parameters
      if (this.config.id === 'replicate-nano-banana-pro') {
        // Resolution mapping - Nano Banana Pro uses "1K", "2K", "4K" strings
        const resolution = parameters?.resolution || request.resolution
        const resolutionStr = resolution === 4096 ? '4K' : resolution === 2048 ? '2K' : '1K'
        input.resolution = resolutionStr
        console.log(`[Nano-Banana-Backup] Using resolution: ${resolutionStr}`)

        // Build reference images array from all possible sources
        let referenceImages: string[] = []
        
        if (request.referenceImages && Array.isArray(request.referenceImages) && request.referenceImages.length > 0) {
          referenceImages = request.referenceImages
          console.log(`[Nano-Banana-Backup] Using referenceImages array: ${referenceImages.length} image(s)`)
        } else if (referenceImage && typeof referenceImage === 'string' && referenceImage.length > 0) {
          referenceImages = [referenceImage]
          console.log(`[Nano-Banana-Backup] Using single referenceImage`)
        } else if (request.referenceImageUrl && typeof request.referenceImageUrl === 'string') {
          referenceImages = [request.referenceImageUrl]
          console.log(`[Nano-Banana-Backup] Using referenceImageUrl`)
        }

        if (referenceImages.length > 0) {
          input.image_input = referenceImages
          console.log(`[Nano-Banana-Backup] ✅ Passing ${referenceImages.length} reference image(s) to API`)
        } else {
          console.log('[Nano-Banana-Backup] ⚠️ No reference image provided - text-to-image only')
        }
      }

      // Reve model doesn't support image input or multiple outputs

      console.log('Submitting to Replicate:', input)

      // First, fetch the latest version for the model
      const modelResponse = await fetch(`${this.baseUrl}/models/${modelPath}`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      })

      if (!modelResponse.ok) {
        const errorText = await modelResponse.text()
        console.error('Failed to fetch model info:', errorText)
        throw new Error(`Failed to fetch model info: ${errorText}`)
      }

      const modelData = await modelResponse.json()
      const versionHash = modelData.latest_version?.id

      if (!versionHash) {
        throw new Error('Could not determine latest version for the model')
      }

      console.log('Using version:', versionHash)

      // Track API call for rate limiting (right before the actual generation request)
      try {
        const scope = this.config.id === 'replicate-seedream-4' ? 'global' : 'replicate-nano-banana'
        await recordApiCall('replicate', scope, 1)
      } catch (trackErr) {
        console.warn('[ReplicateAdapter] Failed to track API call:', trackErr)
      }

      // Submit prediction to Replicate
      const response = await fetch(`${this.baseUrl}/predictions`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: versionHash,
          input,
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Replicate API request failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.detail || errorData.error || JSON.stringify(errorData)
        } catch {
          const errorText = await response.text()
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`
        }
        console.error('Replicate API error:', errorMessage)
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const predictionId = data.id

      console.log('Replicate prediction started:', predictionId)

      // Poll for results
      let attempts = 0
      const maxAttempts = 120 // 10 minutes max (Replicate can take longer)
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

        const statusResponse = await fetch(`${this.baseUrl}/predictions/${predictionId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
          },
        })

        if (!statusResponse.ok) {
          let errorMessage = `Failed to check prediction status (${statusResponse.status})`
          try {
            const errorData = await statusResponse.json()
            errorMessage = errorData.detail || errorData.error || errorMessage
          } catch {
            // If response is not JSON, use status text
            errorMessage = `${statusResponse.status}: ${statusResponse.statusText}`
          }
          throw new Error(errorMessage)
        }

        const statusData = await statusResponse.json()
        console.log(`Replicate status: ${statusData.status} (attempt ${attempts + 1})`)

        if (statusData.status === 'succeeded') {
          // Parse output URLs - handle different output formats
          let outputUrls: string[] = []
          
          if (statusData.output) {
            if (Array.isArray(statusData.output)) {
              // Multiple outputs (array of URLs)
              outputUrls = statusData.output
            } else if (typeof statusData.output === 'string') {
              // Single output (single URL)
              outputUrls = [statusData.output]
            } else if (Array.isArray(statusData.output.urls)) {
              // Some models return { urls: [...] } format
              outputUrls = statusData.output.urls
            } else {
              // Try to extract URLs from object output
              console.error('Unexpected output format:', statusData.output)
              outputUrls = []
            }
          }
          
          if (!outputUrls.length) {
            throw new Error('No images generated - unexpected output format')
          }

          // Capture metrics for accurate cost calculation
          const predictTime = statusData.metrics?.predict_time
          if (predictTime) {
            console.log(`[Replicate] Prediction completed in ${predictTime.toFixed(2)}s`)
          }

          return {
            id: `replicate-${Date.now()}`,
            status: 'completed',
            outputs: outputUrls.map((url: string) => ({
              url,
              width: 2048, // Default for 2K
              height: 2048,
            })),
            metadata: {
              seed: statusData.metrics?.seed,
              model: request.modelId,
            },
            // Return actual metrics for cost calculation
            metrics: {
              predictTime: predictTime,
            },
          }
        } else if (statusData.status === 'failed' || statusData.status === 'canceled') {
          throw new Error(`Generation failed: ${statusData.error || 'Unknown error'}`)
        }

        attempts++
      }

      throw new Error('Generation timeout - request took too long')
    } catch (error: any) {
      console.error('Replicate generation error:', error)
      throw new Error(error.message || 'Failed to generate with Replicate')
    }
  }

  private async generateVideo(request: GenerationRequest): Promise<GenerationResponse> {
    if (!this.apiKey) {
      throw new Error('REPLICATE_API_TOKEN is not configured. Please add your Replicate API token to .env.local and restart the dev server. Get your token from: https://replicate.com/account/api-tokens')
    }

    const {
      prompt,
      parameters = {},
      referenceImage,
      referenceImageUrl,
    } = request

    try {
      const isSeedance = this.config.id === 'replicate-seedance-2.5'

      // Determine which Replicate video model to use
      let modelPath: string
      if (this.config.id === 'replicate-kling-2.6') {
        modelPath = 'kwaivgi/kling-v2.6'
      } else if (isSeedance) {
        modelPath = SEEDANCE_2_5_MODEL_PATH
      } else {
        throw new Error(`Unknown Replicate video model: ${this.config.id}`)
      }

      const logTag = isSeedance ? 'Seedance-2.5' : 'Kling-2.6'

      // Get parameters with safe fallbacks
      const aspectRatio = parameters?.aspectRatio || request.aspectRatio || '16:9'
      const generateAudio = parameters?.generateAudio !== false // Default true
      const negativePrompt = parameters?.negativePrompt

      // Resolve the start frame from every source the app may populate.
      let startImage: string | null = null
      if (referenceImage && typeof referenceImage === 'string' && referenceImage.length > 0) {
        startImage = referenceImage
        console.log(`[${logTag}] Using referenceImage for start frame`)
      } else if (referenceImageUrl && typeof referenceImageUrl === 'string') {
        startImage = referenceImageUrl
        console.log(`[${logTag}] Using referenceImageUrl for start frame:`, referenceImageUrl.substring(0, 50))
      } else if (request.referenceImages && Array.isArray(request.referenceImages) && request.referenceImages.length > 0) {
        startImage = request.referenceImages[0]
        console.log(`[${logTag}] Using first referenceImages entry for start frame`)
      }

      const endFrameImageUrl =
        typeof parameters?.endFrameImageUrl === 'string' ? parameters.endFrameImageUrl : null

      let input: any

      if (isSeedance) {
        // Seedance has strict cross-field constraints — build via the shared
        // helper so the sync and webhook paths stay identical.
        input = buildSeedanceInput({
          prompt,
          aspectRatio,
          duration: parameters?.duration ?? request.duration,
          resolution: parameters?.resolution ?? request.resolution,
          generateAudio,
          referenceImage: startImage,
          endFrameImageUrl,
          seed: request.seed,
          referenceImageUrls: parameters?.referenceImageUrls,
          referenceVideoUrls: parameters?.referenceVideoUrls,
          referenceAudioUrls: parameters?.referenceAudioUrls,
        })

        const refCounts = {
          images: input.reference_images?.length ?? 0,
          videos: input.reference_videos?.length ?? 0,
          audios: input.reference_audios?.length ?? 0,
        }
        const usesReferenceSets = refCounts.images > 0 || refCounts.videos > 0
        const mode = usesReferenceSets
          ? `Reference-set mode (${refCounts.images} image, ${refCounts.videos} video, ${refCounts.audios} audio)`
          : startImage
            ? endFrameImageUrl
              ? 'First/last-frame mode'
              : 'Image-to-video mode'
            : 'Text-to-video mode'

        console.log(
          `[${logTag}] ${mode} @ ${input.resolution}, ${input.duration}s, ratio ${input.aspect_ratio}`
        )
        if (usesReferenceSets && (startImage || endFrameImageUrl)) {
          console.log(`[${logTag}] ⚠️ Start/end frames dropped - Seedance cannot combine them with reference sets`)
        }
        if (refCounts.videos > 0) {
          console.log(`[${logTag}] 💰 Reference videos present - billing on the 4x video_in tier`)
        }
        if (negativePrompt) {
          console.log(`[${logTag}] ⚠️ Negative prompt ignored - Seedance 2.5 has no negative_prompt input`)
        }
      } else {
        // Prepare model-specific input for Kling 2.6
        input = {
          prompt,
          duration: parameters?.duration || 5,
          aspect_ratio: aspectRatio,
          generate_audio: generateAudio,
        }

        // Add negative prompt if provided
        if (negativePrompt) {
          input.negative_prompt = negativePrompt
        }

        if (startImage) {
          input.start_image = startImage
          // When start_image is provided, aspect_ratio is ignored by Kling
          console.log('[Kling-2.6] ✅ Image-to-video mode with start_image')
        } else {
          console.log('[Kling-2.6] Text-to-video mode (no start_image)')
        }

        // Check for end frame image (for frame-to-frame interpolation)
        if (endFrameImageUrl) {
          input.end_image = endFrameImageUrl
          console.log('[Kling-2.6] ✅ Frame-to-frame interpolation with end_image')
        }
      }

      // The duration actually submitted (Seedance clamps to its 4-30s range)
      const duration = input.duration

      console.log(`Submitting ${this.config.name} video generation:`, {
        ...input,
        image: input.image ? '[IMAGE]' : undefined,
        last_frame_image: input.last_frame_image ? '[IMAGE]' : undefined,
        start_image: input.start_image ? '[IMAGE]' : undefined,
        end_image: input.end_image ? '[IMAGE]' : undefined,
      })

      // First, fetch the latest version for the model
      const modelResponse = await fetch(`${this.baseUrl}/models/${modelPath}`, {
        headers: {
          'Authorization': `Token ${this.apiKey}`,
        },
      })

      if (!modelResponse.ok) {
        const errorText = await modelResponse.text()
        console.error('Failed to fetch model info:', errorText)
        throw new Error(`Failed to fetch model info: ${errorText}`)
      }

      const modelData = await modelResponse.json()
      const versionHash = modelData.latest_version?.id

      if (!versionHash) {
        throw new Error('Could not determine latest version for the model')
      }

      console.log('Using version:', versionHash)

      // Track API call for rate limiting (right before the actual generation request)
      try {
        await recordApiCall('replicate', getScopeForModel(this.config.id), 1)
      } catch (trackErr) {
        console.warn(`[ReplicateAdapter] Failed to track ${logTag} API call:`, trackErr)
      }

      // Submit prediction to Replicate
      const response = await fetch(`${this.baseUrl}/predictions`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: versionHash,
          input,
        }),
      })

      if (!response.ok) {
        let errorMessage = 'Replicate API request failed'
        try {
          const errorData = await response.json()
          errorMessage = errorData.detail || errorData.error || JSON.stringify(errorData)
        } catch {
          const errorText = await response.text()
          errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`
        }
        console.error('Replicate API error:', errorMessage)
        throw new Error(errorMessage)
      }

      const data = await response.json()
      const predictionId = data.id

      console.log(`${logTag} prediction started:`, predictionId)

      // Poll for results - video generation takes longer
      let attempts = 0
      const maxAttempts = 180 // 15 minutes max (video generation takes longer)
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

        const statusResponse = await fetch(`${this.baseUrl}/predictions/${predictionId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
          },
        })

        if (!statusResponse.ok) {
          let errorMessage = `Failed to check prediction status (${statusResponse.status})`
          try {
            const errorData = await statusResponse.json()
            errorMessage = errorData.detail || errorData.error || errorMessage
          } catch {
            errorMessage = `${statusResponse.status}: ${statusResponse.statusText}`
          }
          throw new Error(errorMessage)
        }

        const statusData = await statusResponse.json()
        console.log(`${logTag} status: ${statusData.status} (attempt ${attempts + 1})`)

        if (statusData.status === 'succeeded') {
          // Parse output URL - Kling returns a single video URL
          let outputUrl: string | null = null
          
          if (statusData.output) {
            if (typeof statusData.output === 'string') {
              outputUrl = statusData.output
            } else if (statusData.output.url) {
              outputUrl = statusData.output.url
            } else if (Array.isArray(statusData.output) && statusData.output.length > 0) {
              outputUrl = statusData.output[0]
            }
          }
          
          if (!outputUrl) {
            throw new Error('No video generated - unexpected output format')
          }

          // Capture metrics for accurate cost calculation
          const predictTime = statusData.metrics?.predict_time
          if (predictTime) {
            console.log(`[${logTag}] Video generated in ${predictTime.toFixed(2)}s`)
          }

          // Nominal dimensions for the gallery. Seedance caps at 720p and can
          // return an adaptive ratio, so scale the short edge to its tier.
          const shortEdge = isSeedance && input.resolution === '480p' ? 480 : 720
          const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4'
          const longEdge = Math.round(shortEdge * (16 / 9))

          return {
            id: `replicate-video-${Date.now()}`,
            status: 'completed',
            outputs: [{
              url: outputUrl,
              width: isPortrait ? shortEdge : longEdge,
              height: isPortrait ? longEdge : shortEdge,
              duration: duration,
            }],
            metadata: {
              model: request.modelId,
              duration,
              hasAudio: generateAudio,
            },
            // Return actual metrics for cost calculation
            metrics: {
              predictTime: predictTime,
            },
          }
        } else if (statusData.status === 'failed' || statusData.status === 'canceled') {
          throw new Error(`Video generation failed: ${statusData.error || 'Unknown error'}`)
        }

        attempts++
      }

      throw new Error('Video generation timeout - request took too long')
    } catch (error: any) {
      console.error(`${this.config.name} video generation error:`, error)
      throw new Error(error.message || `Failed to generate video with ${this.config.name}`)
    }
  }
}

