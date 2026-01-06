import { BaseModelAdapter, ModelConfig, GenerationRequest, GenerationResponse } from '../base'

// Support both REPLICATE_API_TOKEN (official) and REPLICATE_API_KEY (legacy)
// Only check env vars on server side (they're not available in browser)
const REPLICATE_API_KEY = typeof window === 'undefined' 
  ? (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY)
  : null

if (typeof window === 'undefined' && !REPLICATE_API_KEY) {
  console.warn('REPLICATE_API_TOKEN is not set. Replicate models will not work. Get your key from: https://replicate.com/account/api-tokens')
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
        const size = '2K' // Seedream 4.5 supports: 2K (2048px), 4K (4096px), or custom
        input.size = size
        input.sequential_image_generation = numOutputs > 1 ? 'auto' : 'disabled'
        input.max_images = numOutputs
        input.enhance_prompt = true // Enable prompt enhancement for better results

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
      // Determine which Replicate video model to use
      let modelPath: string
      if (this.config.id === 'replicate-kling-2.6') {
        modelPath = 'kwaivgi/kling-v2.6'
      } else {
        throw new Error(`Unknown Replicate video model: ${this.config.id}`)
      }

      // Get parameters with safe fallbacks
      const aspectRatio = parameters?.aspectRatio || request.aspectRatio || '16:9'
      const duration = parameters?.duration || 5
      const generateAudio = parameters?.generateAudio !== false // Default true
      const negativePrompt = parameters?.negativePrompt

      // Prepare model-specific input for Kling 2.6
      const input: any = {
        prompt,
        duration,
        aspect_ratio: aspectRatio,
        generate_audio: generateAudio,
      }

      // Add negative prompt if provided
      if (negativePrompt) {
        input.negative_prompt = negativePrompt
      }

      // Add start image for image-to-video (Kling's main strength)
      let startImage: string | null = null
      
      // Check for reference image from various sources
      if (referenceImage && typeof referenceImage === 'string' && referenceImage.length > 0) {
        startImage = referenceImage
        console.log('[Kling-2.6] Using referenceImage for start_image')
      } else if (referenceImageUrl && typeof referenceImageUrl === 'string') {
        startImage = referenceImageUrl
        console.log('[Kling-2.6] Using referenceImageUrl for start_image:', referenceImageUrl.substring(0, 50))
      } else if (request.referenceImages && Array.isArray(request.referenceImages) && request.referenceImages.length > 0) {
        startImage = request.referenceImages[0]
        console.log('[Kling-2.6] Using first referenceImages entry for start_image')
      }

      if (startImage) {
        input.start_image = startImage
        // When start_image is provided, aspect_ratio is ignored by Kling
        console.log('[Kling-2.6] ✅ Image-to-video mode with start_image')
      } else {
        console.log('[Kling-2.6] Text-to-video mode (no start_image)')
      }

      console.log('Submitting Kling 2.6 video generation:', { ...input, start_image: startImage ? '[IMAGE]' : undefined })

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

      console.log('Kling 2.6 prediction started:', predictionId)

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
        console.log(`Kling 2.6 status: ${statusData.status} (attempt ${attempts + 1})`)

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

          return {
            id: `replicate-kling-${Date.now()}`,
            status: 'completed',
            outputs: [{
              url: outputUrl,
              width: aspectRatio === '9:16' ? 720 : 1280,
              height: aspectRatio === '9:16' ? 1280 : 720,
              duration: duration,
            }],
            metadata: {
              model: request.modelId,
              duration,
              hasAudio: generateAudio,
            },
          }
        } else if (statusData.status === 'failed' || statusData.status === 'canceled') {
          throw new Error(`Video generation failed: ${statusData.error || 'Unknown error'}`)
        }

        attempts++
      }

      throw new Error('Video generation timeout - request took too long')
    } catch (error: any) {
      console.error('Kling 2.6 video generation error:', error)
      throw new Error(error.message || 'Failed to generate video with Kling 2.6')
    }
  }
}

