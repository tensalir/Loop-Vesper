export interface Generation {
  id: string
  sessionId: string
  userId: string
  modelId: string
  prompt: string
  negativePrompt?: string
  parameters: Record<string, any>
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

