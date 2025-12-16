import { BaseModelAdapter, GenerationRequest, GenerationResponse, ModelConfig } from '../base'

/**
 * Google Gemini/Vertex AI Adapter
 * Supports Gemini 3 Pro Image (Nano banana pro) and Veo 3.1
 * Uses Gen AI SDK with Vertex AI when credentials are available (better rate limits), falls back to Gemini API
 */

let vertexAiClient: any = null

// Configuration for rate limiting and retries
const IMAGE_GENERATION_DELAY_MS = Number(process.env.IMAGE_GENERATION_DELAY_MS || '2000')
const MAX_RETRY_ATTEMPTS = Number(process.env.MAX_RETRY_ATTEMPTS || '5')

// Helper to safely stringify error details for quota detection
const stringifySafe = (v: any): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return ''
  }
}

// Detect quota exhaustion errors (limit: 0, daily quota, etc.)
const isQuotaExhaustedError = (error: any): boolean => {
  const haystack = [
    error?.message,
    stringifySafe(error?.details),
    stringifySafe(error?.response?.data),
    stringifySafe(error?.error),
    stringifySafe(error?.error?.details),
  ]
    .filter(Boolean)
    .join(' | ')

  return (
    haystack.includes('limit: 0') ||
    haystack.includes('limit":0') ||
    haystack.toLowerCase().includes('daily quota') ||
    haystack.toLowerCase().includes('exceeded your current quota') ||
    haystack.toLowerCase().includes('quota exceeded')
  )
}

// Check if error is a 429 rate limit error
const isRateLimitError = (error: any): boolean => {
  const status = error?.status || error?.code || error?.error?.code
  return status === 429 || status === 'RESOURCE_EXHAUSTED'
}

const redactLargeStrings = (value: any, maxLen = 256) => {
  const seen = new WeakSet<object>()
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      return v.length > maxLen ? `<redacted:${v.length}>` : v
    }
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v)) return '<circular>'
    seen.add(v)
    if (Array.isArray(v)) return v.map(walk)
    const out: Record<string, any> = {}
    for (const [k, val] of Object.entries(v)) {
      // common base64 field name
      if (k === 'data' && typeof val === 'string' && val.length > maxLen) {
        out[k] = `<redacted:${val.length}>`
        continue
      }
      out[k] = walk(val)
    }
    return out
  }
  return walk(value)
}

// Try to initialize Vertex AI client (server-side only)
if (typeof window === 'undefined') {
  try {
    const { VertexAI } = require('@google-cloud/vertexai')
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID
    const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1'
    
    // Check if we have credentials (either via file path or JSON string for Vercel)
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    
    if (projectId && (credentialsPath || credentialsJson)) {
      let credentials: any = undefined
      
      if (credentialsPath) {
        // Use file path (local development) - SDK will automatically use GOOGLE_APPLICATION_CREDENTIALS
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath
        }
        // Don't parse file - SDK handles it automatically
      } else if (credentialsJson) {
        // For Vercel/serverless: parse JSON string and pass directly
        credentials = JSON.parse(credentialsJson)
      }
      
      // Initialize Vertex AI client
      vertexAiClient = new VertexAI({
        project: projectId,
        location,
        ...(credentials && { googleAuthOptions: { credentials } }),
      })
      
      console.log(`[Vertex AI] Initialized for project: ${projectId}, location: ${location}`)
    }
  } catch (error) {
    // Vertex AI not available or not configured - will fall back to Gemini API
    console.log('[Vertex AI] Not configured, will use Gemini API:', error)
  }
}

export class GeminiAdapter extends BaseModelAdapter {
  private apiKey: string
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  private useGenAI: boolean

  constructor(config: ModelConfig) {
    super(config)
    this.apiKey = process.env.GEMINI_API_KEY || ''
    this.useGenAI = vertexAiClient !== null

    if (!this.useGenAI && !this.apiKey) {
      console.warn('Neither Vertex AI nor Gemini API key configured')
    } else if (this.useGenAI) {
      console.log('[GeminiAdapter] Using Vertex AI (better rate limits)')
    } else {
      console.log('[GeminiAdapter] Using Gemini API (AI Studio)')
    }
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
    console.log('Nano banana pro: Starting image generation')
    console.log('Nano banana pro: Prompt:', request.prompt)
    const referenceImages = request.referenceImages || (request.referenceImage ? [request.referenceImage] : [])
    console.log('Nano banana pro: Reference images count:', referenceImages.length)
    // Gemini 3 Pro Image (Nano banana pro) endpoint
    const endpoint = `${this.baseUrl}/models/gemini-3-pro-image-preview:generateContent`

    const numImages = request.numOutputs || 1
    
    // Generate images sequentially (one at a time) to avoid rate limits
    // This prevents parallel request storms that trigger 429 errors
    const outputs: any[] = []
    
    for (let i = 0; i < numImages; i++) {
      console.log(`Nano banana pro: Generating image ${i + 1}/${numImages}`)
      
      try {
        const output = await this.generateSingleImageWithRetry(endpoint, request, i + 1, numImages)
        outputs.push(output)
        
        // Add delay between sequential requests (except after the last one)
        if (i < numImages - 1) {
          await new Promise(resolve => setTimeout(resolve, IMAGE_GENERATION_DELAY_MS))
        }
      } catch (error: any) {
        console.error(`Nano banana pro: Image ${i + 1}/${numImages} failed:`, error.message)
        // Continue to next image even if one fails
        // We'll throw if all fail at the end
      }
    }

    if (outputs.length === 0) {
      throw new Error('All image generations failed')
    }

    return {
      id: `gen-${Date.now()}`,
      status: 'completed',
      outputs,
      metadata: {
        model: this.config.id,
        prompt: request.prompt,
      },
    }
  }

  // Generate single image with retry logic for 429 errors
  private async generateSingleImageWithRetry(
    endpoint: string,
    request: GenerationRequest,
    imageIndex: number,
    totalImages: number
  ): Promise<any> {
    let lastError: any = null
    
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.generateSingleImage(endpoint, request)
      } catch (error: any) {
        lastError = error
        
        // Check if it's a quota exhaustion error (limit: 0, daily quota)
        // Fail fast - don't retry on true quota exhaustion
        if (isQuotaExhaustedError(error)) {
          console.error(`Nano banana pro: Quota exhausted (limit: 0 or daily quota). Failing fast.`)
          throw new Error('Quota exhausted. Please check your API quota limits or try again later.')
        }
        
        // Only retry on 429 rate limit errors
        if (isRateLimitError(error) && attempt < MAX_RETRY_ATTEMPTS) {
          // Exponential backoff with jitter: 1-2s, 2-4s, 4-8s, 8-16s, 16-32s
          const baseDelay = Math.pow(2, attempt - 1) * 1000
          const jitter = Math.random() * baseDelay
          const delay = baseDelay + jitter
          
          console.log(
            `Nano banana pro: Image ${imageIndex}/${totalImages} - Rate limit (429) on attempt ${attempt}/${MAX_RETRY_ATTEMPTS}. Retrying in ${Math.round(delay)}ms...`
          )
          
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        
        // Not a retryable error or max retries reached
        throw error
      }
    }
    
    // Should not reach here, but satisfy TypeScript
    throw lastError || new Error('Generation failed after retries')
  }

  private async generateSingleImage(endpoint: string, request: GenerationRequest): Promise<any> {
    const parts: any[] = []
    
    // Add text prompt
    parts.push({
      text: request.prompt,
    })
    
    // Handle multiple reference images (preferred) or single image (backward compatibility)
    const referenceImages = request.referenceImages || (request.referenceImage ? [request.referenceImage] : [])
    
    // Add all reference images to parts array
    for (const imageData of referenceImages) {
      // Extract base64 data and mime type from data URL
      const dataUrlMatch = imageData.match(/^data:([^;]+);base64,(.+)$/)
      if (dataUrlMatch) {
        const [, mimeType, base64Data] = dataUrlMatch
        parts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        })
      } else {
        console.error('Invalid reference image format. Expected data URL format: data:image/png;base64,...')
        throw new Error('Invalid reference image format. Please upload the image again.')
      }
    }
    
    const payload: any = {
      contents: [
        {
          parts,
        },
      ],
      generationConfig: {
        responseModalities: ['image'],
        temperature: 1.0,
      },
    }

    // Add aspect ratio and resolution configuration if provided
    if (request.aspectRatio || request.resolution) {
      payload.generationConfig.imageConfig = {
        ...(request.aspectRatio && { aspectRatio: request.aspectRatio }),
        // Convert resolution number to imageSize string (1K, 2K, 4K) for Gemini 3 Pro Image
        // Resolution values: 1024 -> "1K", 2048 -> "2K", 4096 -> "4K"
        ...(request.resolution && {
          imageSize: request.resolution === 4096 ? '4K' : request.resolution === 2048 ? '2K' : '1K'
        }),
      }
    }

    // Use Vertex AI if available, otherwise fall back to Gemini API
    if (this.useGenAI && vertexAiClient) {
      return await this.generateImageVertexAI(request, payload)
    } else {
      return await this.generateImageGeminiAPI(endpoint, payload)
    }
  }

  private async generateImageVertexAI(request: GenerationRequest, payload: any): Promise<any> {
    console.log('Nano banana pro: Using Vertex AI')
    
    if (!vertexAiClient) {
      throw new Error('Vertex AI client not initialized')
    }
    
    try {
      // Use preview.getGenerativeModel() for preview models like gemini-3-pro-image-preview
      const model = vertexAiClient.preview.getGenerativeModel({
        model: 'gemini-3-pro-image-preview',
      })

      const result = await model.generateContent({
        contents: payload.contents,
        generationConfig: payload.generationConfig,
      })

      // Extract image from response
      const response = result.response
      const candidates = response.candidates || []
      
      if (candidates.length === 0) {
        console.error('Vertex AI response missing candidates:', JSON.stringify(result, null, 2))
        throw new Error('No candidates in response')
      }
      
      const content = candidates[0]?.content
      if (!content || !content.parts) {
        console.error('Vertex AI response missing content parts:', JSON.stringify(result, null, 2))
        throw new Error('No content parts in response')
      }
      
      const imagePart = content.parts.find(
        (part: any) => part.inlineData?.mimeType?.startsWith('image/')
      )

      if (!imagePart?.inlineData?.data) {
        console.error('Vertex AI response missing image data:', JSON.stringify(result, null, 2))
        throw new Error('No image data in response')
      }

      // Determine dimensions based on aspect ratio
      const aspectRatioDimensions: Record<string, { width: number; height: number }> = {
        '1:1': { width: 1024, height: 1024 },
        '2:3': { width: 832, height: 1248 },
        '3:2': { width: 1248, height: 832 },
        '3:4': { width: 864, height: 1184 },
        '4:3': { width: 1184, height: 864 },
        '4:5': { width: 896, height: 1152 },
        '5:4': { width: 1152, height: 896 },
        '9:16': { width: 768, height: 1344 },
        '16:9': { width: 1344, height: 768 },
        '21:9': { width: 1536, height: 672 },
      }

      const dimensions = aspectRatioDimensions[payload.generationConfig.imageConfig?.aspectRatio || '1:1'] || { width: 1024, height: 1024 }

      return {
        url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
        width: dimensions.width,
        height: dimensions.height,
      }
    } catch (error: any) {
      console.error('Vertex AI error:', error)
      
      // Fail fast on quota exhaustion - don't fallback to another API with zero quota
      if (isQuotaExhaustedError(error)) {
        throw new Error('Quota exhausted. Please check your API quota limits or try again later.')
      }
      
      // Only fallback to Gemini API if it's not a quota issue and we have an API key
      if (this.apiKey && !isQuotaExhaustedError(error)) {
        console.log('Falling back to Gemini API due to Vertex AI error')
        const endpoint = `${this.baseUrl}/models/gemini-3-pro-image-preview:generateContent`
        try {
          return await this.generateImageGeminiAPI(endpoint, payload)
        } catch (fallbackError: any) {
          // If fallback also has quota issues, fail fast
          if (isQuotaExhaustedError(fallbackError)) {
            throw new Error('Quota exhausted on both Vertex AI and Gemini API. Please check your quota limits.')
          }
          throw fallbackError
        }
      }
      throw error
    }
  }

  private async generateImageGeminiAPI(endpoint: string, payload: any): Promise<any> {
    console.log('Nano banana pro: Using Gemini API (AI Studio)')
    
    const response = await fetch(`${endpoint}?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    console.log('Nano banana pro: Response status:', response.status)

    if (!response.ok) {
      const error = await response.json()
      console.error('Gemini API error:', error)
      console.error('Request payload (redacted):', JSON.stringify(redactLargeStrings(payload), null, 2))
      
      // Create error object that includes details for quota detection
      const apiError: any = new Error(error.error?.message || 'Image generation failed')
      apiError.status = response.status
      apiError.code = error.error?.code
      apiError.error = error.error
      apiError.details = error.error?.details
      
      throw apiError
    }
    
    console.log('Nano banana pro: Response OK, parsing data')

    const data = await response.json()

    // Extract image from response
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (part: any) => part.inlineData?.mimeType?.startsWith('image/')
    )

    if (!imagePart?.inlineData?.data) {
      console.error('Gemini response missing image data:', JSON.stringify(data, null, 2))
      throw new Error('No image data in response')
    }

    // Determine dimensions based on aspect ratio (from official Gemini docs)
    const aspectRatioDimensions: Record<string, { width: number; height: number }> = {
      '1:1': { width: 1024, height: 1024 },
      '2:3': { width: 832, height: 1248 },
      '3:2': { width: 1248, height: 832 },
      '3:4': { width: 864, height: 1184 },
      '4:3': { width: 1184, height: 864 },
      '4:5': { width: 896, height: 1152 },
      '5:4': { width: 1152, height: 896 },
      '9:16': { width: 768, height: 1344 },
      '16:9': { width: 1344, height: 768 },
      '21:9': { width: 1536, height: 672 },
    }

    const dimensions = aspectRatioDimensions[payload.generationConfig.imageConfig?.aspectRatio || '1:1'] || { width: 1024, height: 1024 }

    return {
      url: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      width: dimensions.width,
      height: dimensions.height,
    }
  }

  private async generateVideo(request: GenerationRequest): Promise<GenerationResponse> {
    console.log(`[Veo 3.1] Starting video generation for prompt: ${request.prompt.substring(0, 50)}...`)
    
    const duration = request.duration || 8
    const resolution = request.resolution || 720
    const aspectRatio = request.aspectRatio || '16:9'
    
    // Calculate dimensions based on aspect ratio and resolution
    const getDimensions = (aspectRatio: string, resolution: number) => {
      const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
      if (aspectRatio === '16:9') {
        return resolution === 1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 }
      }
      if (aspectRatio === '9:16') {
        return resolution === 1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 }
      }
      if (aspectRatio === '1:1') {
        return { width: resolution, height: resolution }
      }
      // For other ratios, calculate proportionally
      const ratio = widthRatio / heightRatio
      if (ratio > 1) {
        return { width: resolution, height: Math.round(resolution / ratio) }
      } else {
        return { width: Math.round(resolution * ratio), height: resolution }
      }
    }
    
    const { width, height } = getDimensions(aspectRatio, resolution)
    
    // Use Vertex AI if available, otherwise fall back to Gemini API REST
    if (this.useGenAI && vertexAiClient) {
      return await this.generateVideoVertexAI(request, { width, height, duration, resolution, aspectRatio })
    } else {
      return await this.generateVideoGeminiAPI(request, { width, height, duration, resolution, aspectRatio })
    }
  }
  
  private async generateVideoVertexAI(
    request: GenerationRequest,
    options: { width: number; height: number; duration: number; resolution: number; aspectRatio: string }
  ): Promise<GenerationResponse> {
    console.log(`[Veo 3.1] Vertex AI available, but video generation methods not yet in SDK`)
    console.log(`[Veo 3.1] Falling back to Gemini API REST (works great, maintains functionality)`)
    
    if (!vertexAiClient) {
      throw new Error('Vertex AI client not initialized')
    }
    
    // Note: The Vertex AI SDK JavaScript version may not have video generation methods yet
    // When the SDK adds video support, this method will be updated to use SDK methods
    // For now, we maintain the working Gemini API REST implementation
    // This ensures videos continue to work while we wait for SDK video support
    
    try {
      // TODO: When Vertex AI SDK adds video generation support, implement here:
      // const model = vertexAiClient.preview.getGenerativeModel({ model: 'veo-3.1-generate-preview' })
      // const operation = await model.generateVideos({ ... })
      // Then poll and return result
      
      // For now, use the proven Gemini API REST implementation
      return await this.generateVideoGeminiAPI(request, options)
      
    } catch (error: any) {
      console.error('[Veo 3.1] Vertex AI error:', error)
      // Fallback to Gemini API REST if Vertex AI fails
      if (this.apiKey) {
        console.log('Falling back to Gemini API REST due to Vertex AI error')
        return await this.generateVideoGeminiAPI(request, options)
      }
      throw error
    }
  }
  
  private async generateVideoGeminiAPI(
    request: GenerationRequest,
    options: { width: number; height: number; duration: number; resolution: number; aspectRatio: string }
  ): Promise<GenerationResponse> {
    console.log(`[Veo 3.1] Using Gemini API REST (fallback)`)
    
    // Using Veo 3.1 official API endpoint
    const modelId = 'veo-3.1-generate-preview'
    const endpoint = `${this.baseUrl}/models/${modelId}:predictLongRunning`
    
    const { width, height, duration } = options
    
    // Build request payload according to Veo 3.1 API
    // Veo 3.1 supports image-to-video: https://ai.google.dev/gemini-api/docs/video
    // Images must be uploaded via Google Files API first
    const instance: any = {
      prompt: request.prompt,
    }

    // Check for reference image - can be base64 (referenceImage) or URL (referenceImageUrl)
    // Veo 3.1 requires inline base64 data, not fileUri
    let imageBytes: Buffer | null = null
    let contentType: string = 'image/jpeg'
    
    if (request.referenceImage && typeof request.referenceImage === 'string' && request.referenceImage.startsWith('data:')) {
      // Handle base64 data URL directly
      console.log(`[Veo 3.1] Using reference image from base64 data URL`)
      const dataUrlMatch = request.referenceImage.match(/^data:([^;]+);base64,(.+)$/)
      if (dataUrlMatch) {
        const [, mimeType, base64Data] = dataUrlMatch
        contentType = mimeType || 'image/jpeg'
        imageBytes = Buffer.from(base64Data, 'base64')
      } else {
        console.warn(`[Veo 3.1] Invalid base64 format, ignoring reference image`)
      }
    } else if ((request as any).referenceImageUrl) {
      // Handle URL - download first
      console.log(`[Veo 3.1] Downloading reference image from URL: ${(request as any).referenceImageUrl}`)
      try {
        const imageResponse = await fetch((request as any).referenceImageUrl)
        if (!imageResponse.ok) {
          throw new Error(`Failed to fetch reference image: ${imageResponse.statusText}`)
        }
        
        const imageBuffer = await imageResponse.arrayBuffer()
        imageBytes = Buffer.from(imageBuffer)
        contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
      } catch (error: any) {
        console.error(`[Veo 3.1] Failed to download reference image:`, error)
        imageBytes = null
      }
    } else {
      console.log(`[Veo 3.1] No reference image provided, generating text-to-video`)
    }
    
    // Build clean instance object - only include prompt and image if provided
    // According to Veo 3.1 API docs, reference images should use inline base64 data, not fileUri
    // Format: referenceImages array with inline base64 encoded images
    const cleanInstance: any = {
      prompt: instance.prompt,
    }
    
    // Only add reference images if we have image data
    // Veo 3.1 requires inline base64 data, not fileUri (fileUri is not supported)
    if (imageBytes) {
      // Convert image bytes to base64
      const base64Image = imageBytes.toString('base64')
      
      // Veo 3.1 expects referenceImages array with inline base64 data
      cleanInstance.referenceImages = [
        {
          image: {
            bytesBase64Encoded: base64Image,
            mimeType: contentType,
          },
          referenceType: 'asset',
        },
      ]
      console.log(`[Veo 3.1] Added reference image with inline base64 data (${base64Image.length} chars, ${contentType})`)
    }
    
    const payload = {
      instances: [cleanInstance],
    }
    
    console.log(`[Veo 3.1] Calling API with ${duration}s video, ${width}x${height}, ${options.aspectRatio}`)
    console.log(`[Veo 3.1] Payload (redacted):`, JSON.stringify(redactLargeStrings(payload), null, 2))
    
    try {
      // Initiate video generation
      // According to docs, API key should be in header, not query string
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error?.message || 'Video generation request failed')
      }

      const operation = await response.json()
      const operationName = operation.name
      
      console.log('[Veo 3.1] Generation started', {
        operation: operationName,
        referenceImageAttached: Boolean(cleanInstance.referenceImages && cleanInstance.referenceImages.length > 0),
        referenceImageFormat: cleanInstance.referenceImages?.[0] ? 'inline-base64' : 'none',
      })
      
      // Poll operation until complete (max 5 minutes)
      const maxAttempts = 30 // 5 minutes at 10s intervals
      let attempts = 0
      let operationComplete = false
      
      while (!operationComplete && attempts < maxAttempts) {
        attempts++
        await new Promise(resolve => setTimeout(resolve, 10000)) // Wait 10s
        
        const statusResponse = await fetch(`${this.baseUrl}/${operationName}`, {
          headers: {
            'x-goog-api-key': this.apiKey,
          },
        })
        if (!statusResponse.ok) {
          throw new Error('Failed to check operation status')
        }
        
        const status = await statusResponse.json()
        operationComplete = status.done
        
        if (operationComplete) {
          const generatedVideo = status.response?.generateVideoResponse?.generatedSamples?.[0]
          if (!generatedVideo) {
            throw new Error('No video in response')
          }
          
          const videoUri = generatedVideo.video.uri
          console.log('[Veo 3.1] Video ready', {
            videoUri,
            operation: operationName,
            referenceImageAttached: Boolean(cleanInstance.referenceImages && cleanInstance.referenceImages.length > 0),
          })
          
          // Return the video URI - it will be downloaded by the background processor
          return {
            id: `gen-${Date.now()}`,
            status: 'completed',
            outputs: [
              {
                url: videoUri,
                width,
                height,
                duration,
              },
            ],
            metadata: {
              model: this.config.id,
              prompt: request.prompt,
              operationName,
            },
          }
        }
      }
      
      if (!operationComplete) {
        throw new Error('Video generation timeout - please try again or contact support')
      }
      
      // This shouldn't be reached, but satisfy TypeScript
      throw new Error('Unexpected end of generation loop')
      
    } catch (error: any) {
      console.error('[Veo 3.1] Generation error:', error)
      throw new Error(error.message || 'Video generation failed')
    }
  }
}

// Model configurations based on official Gemini API docs
// https://ai.google.dev/gemini-api/docs/image-generation
export const NANO_BANANA_CONFIG: ModelConfig = {
  id: 'gemini-nano-banana-pro',
  name: 'Nano banana pro',
  provider: 'Google',
  type: 'image',
  description: 'Gemini 3 Pro Image - Advanced image generation with superior quality',
  maxResolution: 1536, // Max dimension from 21:9 (1536x672)
  defaultAspectRatio: '1:1',
  // All 10 supported aspect ratios from official Gemini API documentation
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  capabilities: {
    editing: true,
    'text-2-image': true,
    multiImageEditing: true, // Gemini 3 Pro Image supports multiple reference images
  },
  pricing: {
    perImage: 0.01,
    currency: 'USD',
  },
  parameters: [
    {
      name: 'numOutputs',
      type: 'select',
      label: 'Images',
      default: 1,
      options: [
        { label: '1 image', value: 1 },
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
  ],
}

// Veo 3.1 configuration based on official API docs
// https://ai.google.dev/gemini-api/docs/video
// https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-first-and-last-frames
export const VEO_3_1_CONFIG: ModelConfig = {
  id: 'gemini-veo-3.1',
  name: 'Veo 3.1',
  provider: 'Google',
  type: 'video',
  description: 'State-of-the-art video generation with native audio support, frame-specific generation, and video extension',
  defaultAspectRatio: '16:9',
  // Veo 3.1 officially supports: 16:9, 9:16, and 1:1
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  maxResolution: 1080,
  capabilities: {
    'text-2-video': true,
    'image-2-video': true,
  },
  pricing: {
    perSecond: 0.05,
    currency: 'USD',
  },
  parameters: [
    {
      name: 'resolution',
      type: 'select',
      label: 'Resolution',
      default: 720,
      options: [
        { label: '720p', value: 720 },
        { label: '1080p', value: 1080 },
      ],
    },
    {
      name: 'duration',
      type: 'select',
      label: 'Duration',
      default: 8,
      options: [
        { label: '4 seconds', value: 4 },
        { label: '6 seconds', value: 6 },
        { label: '8 seconds', value: 8 },
      ],
    },
    {
      name: 'numOutputs',
      type: 'select',
      label: 'Videos',
      default: 1,
      options: [
        { label: '1', value: 1 },
      ],
    },
  ],
}

