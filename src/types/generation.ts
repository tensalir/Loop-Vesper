/**
 * Typed generation parameters stored in the JSON `parameters` column.
 * Uses an index signature for forward compatibility with new model-specific params.
 */
export interface GenerationParameters {
  // Reference images
  referenceImageUrl?: string
  referenceImages?: string[]
  referenceImageId?: string
  endFrameImageUrl?: string
  endFrameImageId?: string
  // Provider routing
  providerRoute?: {
    provider: string
    isFallback: boolean
    [key: string]: unknown
  }
  // Cost tracking
  costMetrics?: {
    wasFallback?: boolean
    predictTime?: number
    [key: string]: unknown
  }
  // Debug/internal
  debugLogs?: Array<{ at: string; step: string; [key: string]: unknown }>
  lastStep?: string
  __clientId?: string
  error?: string
  // Video
  sourceOutputId?: string
  aspectRatio?: string
  resolution?: number
  numOutputs?: number
  duration?: number
  // Model-specific params (forward compatible)
  [key: string]: unknown
}

export interface Generation {
  id: string
  sessionId: string
  userId: string
  modelId: string
  prompt: string
  negativePrompt?: string
  parameters: GenerationParameters
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  createdAt: Date
  /** Client-side stable ID for React keys during optimistic updates */
  clientId?: string
}

export interface Output {
  id: string
  generationId: string
  fileUrl: string
  fileType: 'image' | 'video'
  width?: number
  height?: number
  duration?: number
  isStarred: boolean
  createdAt: Date
}

export interface GenerationUser {
  id: string
  displayName: string
  username?: string | null
}

export interface GenerationWithOutputs extends Generation {
  outputs: Output[]
  user?: GenerationUser
  /** Indicates if the current user owns this generation (for delete permissions) */
  isOwner?: boolean
}

