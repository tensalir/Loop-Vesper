/**
 * Base Model Adapter Interface
 * All model providers should implement this interface
 */

export interface ModelParameter {
  name: string
  type: 'string' | 'number' | 'select' | 'boolean'
  label: string
  default?: any
  options?: Array<{ label: string; value: any }>
  min?: number
  max?: number
  step?: number
}

export interface ModelConfig {
  id: string
  name: string
  provider: string
  type: 'image' | 'video'
  description: string
  maxResolution?: number
  defaultAspectRatio?: string
  supportedAspectRatios?: string[]
  capabilities?: {
    editing?: boolean
    'text-2-image'?: boolean
    'image-2-image'?: boolean
    'text-2-video'?: boolean
    'image-2-video'?: boolean
    multiImageEditing?: boolean // Supports multiple reference images
    audioGeneration?: boolean // Supports generating audio with video
  }
  pricing?: {
    perImage?: number
    perSecond?: number
    currency: string
  }
  parameters?: ModelParameter[]
}

export interface GenerationRequest {
  prompt: string
  negativePrompt?: string
  aspectRatio?: string
  resolution?: number
  numOutputs?: number
  seed?: number
  referenceImage?: string // Single image (for backward compatibility)
  referenceImages?: string[] // Multiple images (for models that support it)
  beginFrame?: string // First frame for frame-specific video generation (base64 data URL)
  endFrame?: string // Last frame for frame-specific video generation (base64 data URL)
  [key: string]: any
}

export interface GenerationResponse {
  id: string
  status: 'processing' | 'completed' | 'failed'
  outputs?: Array<{
    url: string
    width: number
    height: number
    duration?: number
  }>
  error?: string
  metadata?: Record<string, any>
}

export abstract class BaseModelAdapter {
  protected config: ModelConfig

  constructor(config: ModelConfig) {
    this.config = config
  }

  /**
   * Get model configuration
   */
  getConfig(): ModelConfig {
    return this.config
  }

  /**
   * Generate content using this model
   */
  abstract generate(request: GenerationRequest): Promise<GenerationResponse>

  /**
   * Check generation status (for async models)
   */
  async checkStatus(generationId: string): Promise<GenerationResponse> {
    throw new Error('Status checking not implemented for this model')
  }

  /**
   * Validate generation request
   */
  protected validateRequest(request: GenerationRequest): void {
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new Error('Prompt is required')
    }

    // Note: request.resolution is a setting (1024, 2048, 4096 for 1K/2K/4K)
    // maxResolution is the maximum pixel dimension (e.g., 1536 for 21:9 aspect ratio)
    // We don't validate resolution setting here - actual dimensions are calculated per aspect ratio
    // The maxResolution check should be done on the calculated dimensions, not the resolution setting
  }
}

