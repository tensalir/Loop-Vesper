import { BaseModelAdapter, GenerationRequest, GenerationResponse, ModelConfig } from '../base'
import { recordApiCall } from '@/lib/rate-limits/usage'
import { checkGoogleRateLimit } from '@/lib/rate-limits/trackedFetch'

/**
 * Google Gemini/Vertex AI Adapter
 * Supports Gemini 3 Pro Image (Nano banana pro) and Veo 3.1
 * 
 * Fallback chain for image generation:
 * 1. Vertex AI SDK (best rate limits, requires service account)
 * 2. Gemini API REST (AI Studio, limited free quota)
 * 3. Replicate API (google/nano-banana-pro, paid per-use)
 */

let vertexAiClient: any = null

// Replicate API key for fallback
const REPLICATE_API_KEY = typeof window === 'undefined'
  ? (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY)
  : null

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

/**
 * Parse Gemini API response for safety blocks, content filters, and other rejection reasons.
 * Google's API can return 200 OK but with no image data when content is blocked.
 * 
 * Response structure:
 * - candidates[0].finishReason: "SAFETY", "RECITATION", "OTHER", etc.
 * - candidates[0].safetyRatings: [{ category, probability, blocked }]
 * - promptFeedback.blockReason: "SAFETY", "OTHER"
 * - promptFeedback.safetyRatings: [{ category, probability, blocked }]
 */
const parseGeminiContentBlock = (data: any): string | null => {
  // Check prompt-level blocking first (entire prompt was rejected)
  const promptFeedback = data?.promptFeedback
  if (promptFeedback?.blockReason) {
    const blockedCategories = (promptFeedback.safetyRatings || [])
      .filter((r: any) => r.blocked || r.probability === 'HIGH')
      .map((r: any) => r.category?.replace('HARM_CATEGORY_', '').toLowerCase().replace(/_/g, ' '))
      .filter(Boolean)
    
    const categoryInfo = blockedCategories.length > 0
      ? ` (categories: ${blockedCategories.join(', ')})`
      : ''
    
    return `Prompt blocked by Google content safety filter${categoryInfo}. Try rephrasing your prompt to avoid restricted content.`
  }

  // Check candidate-level finish reason
  const candidate = data?.candidates?.[0]
  if (candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'MAX_TOKENS') {
    const finishReason = candidate.finishReason
    
    if (finishReason === 'SAFETY') {
      const blockedCategories = (candidate.safetyRatings || [])
        .filter((r: any) => r.blocked || r.probability === 'HIGH')
        .map((r: any) => r.category?.replace('HARM_CATEGORY_', '').toLowerCase().replace(/_/g, ' '))
        .filter(Boolean)
      
      const categoryInfo = blockedCategories.length > 0
        ? ` (categories: ${blockedCategories.join(', ')})`
        : ''
      
      return `Image generation blocked by Google content safety filter${categoryInfo}. Try rephrasing your prompt to avoid restricted content.`
    }
    
    if (finishReason === 'RECITATION') {
      return 'Image generation blocked: response too similar to copyrighted material. Try a more original prompt.'
    }
    
    if (finishReason === 'BLOCKLIST') {
      return 'Prompt contains terms on the blocklist. Please rephrase and try again.'
    }
    
    if (finishReason === 'PROHIBITED_CONTENT') {
      return 'Prompt was flagged as containing prohibited content. Please rephrase and try again.'
    }
    
    if (finishReason === 'SPII') {
      return 'Prompt may contain sensitive personally identifiable information. Please rephrase and try again.'
    }
    
    if (finishReason === 'IMAGE_SAFETY') {
      return 'Generated image was blocked by safety filters. Try a different prompt or subject.'
    }
    
    // Generic non-STOP finish reason
    return `Image generation ended unexpectedly (reason: ${finishReason}). Try rephrasing your prompt.`
  }

  // Check if candidates array is empty (another form of blocking)
  if (data?.candidates && data.candidates.length === 0) {
    return 'No image candidates returned. The prompt may have been filtered by Google content safety. Try rephrasing.'
  }

  return null // No content block detected
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
    
    console.log('[Vertex AI] Initialization check:')
    console.log(`[Vertex AI]   - Project ID: ${projectId ? '✓ Set' : '✗ Missing'}`)
    console.log(`[Vertex AI]   - Region: ${location}`)
    
    // Check if we have credentials (either via file path or JSON string for Vercel)
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    
    console.log(`[Vertex AI]   - Credentials path: ${credentialsPath ? '✓ Set' : '✗ Not set'}`)
    console.log(`[Vertex AI]   - Credentials JSON: ${credentialsJson ? `✓ Set (${credentialsJson.length} chars)` : '✗ Not set'}`)
    
    if (projectId && (credentialsPath || credentialsJson)) {
      let credentials: any = undefined
      
      if (credentialsPath) {
        // Use file path (local development) - SDK will automatically use GOOGLE_APPLICATION_CREDENTIALS
        console.log(`[Vertex AI] Using credentials file path: ${credentialsPath}`)
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath
        }
        // Don't parse file - SDK handles it automatically
      } else if (credentialsJson) {
        // For Vercel/serverless: parse JSON string and pass directly
        console.log('[Vertex AI] Parsing credentials JSON...')
        try {
          // Check if JSON has any obvious issues
          if (credentialsJson.trim().startsWith('@')) {
            console.warn('[Vertex AI] WARNING: Credentials JSON appears to start with "@" - this might be a file path prefix that should be removed')
          }
          
          credentials = JSON.parse(credentialsJson)
          
          // Validate credentials structure
          if (!credentials.type || credentials.type !== 'service_account') {
            console.error('[Vertex AI] ERROR: Credentials JSON missing or incorrect type field')
            console.error(`[Vertex AI]   Expected: "service_account", Got: "${credentials.type || 'undefined'}"`)
          } else {
            console.log('[Vertex AI] ✓ Credentials JSON parsed successfully')
          }
          
          if (!credentials.client_email) {
            console.error('[Vertex AI] ERROR: Credentials JSON missing client_email field')
          } else {
            console.log(`[Vertex AI]   Service account: ${credentials.client_email}`)
          }
          
          if (!credentials.private_key) {
            console.error('[Vertex AI] ERROR: Credentials JSON missing private_key field')
          } else {
            console.log(`[Vertex AI]   Private key: present (length: ${credentials.private_key.length})`)
          }
          
          if (credentials.project_id && credentials.project_id !== projectId) {
            console.warn(`[Vertex AI] WARNING: Credentials project_id (${credentials.project_id}) doesn't match GOOGLE_CLOUD_PROJECT_ID (${projectId})`)
          }
          
        } catch (parseError: any) {
          console.error('[Vertex AI] ERROR: Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON')
          console.error(`[Vertex AI]   Error: ${parseError.message}`)
          console.error(`[Vertex AI]   First 200 chars of JSON: ${credentialsJson.substring(0, 200)}`)
          if (credentialsJson.length > 200) {
            console.error(`[Vertex AI]   ... (truncated, total length: ${credentialsJson.length})`)
          }
          throw parseError
        }
      }
      
      // Initialize Vertex AI client
      console.log('[Vertex AI] Initializing Vertex AI client...')
      try {
        vertexAiClient = new VertexAI({
          project: projectId,
          location,
          ...(credentials && { googleAuthOptions: { credentials } }),
        })
        
        console.log(`[Vertex AI] ✓ Successfully initialized for project: ${projectId}, location: ${location}`)
        console.log(`[Vertex AI]   Note: gemini-3-pro-image-preview is currently only available in us-central1`)
        if (credentials) {
          console.log(`[Vertex AI]   Using service account: ${credentials.client_email || 'unknown'}`)
        }
      } catch (initError: any) {
        console.error('[Vertex AI] ERROR: Failed to initialize Vertex AI client')
        console.error(`[Vertex AI]   Error: ${initError.message}`)
        console.error(`[Vertex AI]   Stack: ${initError.stack}`)
        throw initError
      }
    } else {
      console.log('[Vertex AI] Not configured - missing required environment variables')
      if (!projectId) {
        console.log('[Vertex AI]   ✗ GOOGLE_CLOUD_PROJECT_ID is not set')
      }
      if (!credentialsPath && !credentialsJson) {
        console.log('[Vertex AI]   ✗ Neither GOOGLE_APPLICATION_CREDENTIALS nor GOOGLE_APPLICATION_CREDENTIALS_JSON is set')
      }
    }
  } catch (error: any) {
    // Vertex AI not available or not configured - will fall back to Gemini API
    console.error('[Vertex AI] Initialization failed, will use Gemini API fallback')
    console.error(`[Vertex AI]   Error: ${error.message}`)
    console.error(`[Vertex AI]   Stack: ${error.stack}`)
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
    
    // Toggle between Replicate and Gemini API for Nano Banana
    // Set to false to use Google's Gemini API directly (PREFERRED - faster and cheaper)
    // Set to true to bypass Google APIs and use Replicate as fallback
    const USE_REPLICATE_DIRECTLY = false
    
    if (USE_REPLICATE_DIRECTLY && REPLICATE_API_KEY) {
      console.log('Nano banana pro: Using Replicate directly (Vertex AI/Gemini API temporarily disabled)')
      const numImages = request.numOutputs || 1
      const outputs: any[] = []
      
      for (let i = 0; i < numImages; i++) {
        console.log(`Nano banana pro: Generating image ${i + 1}/${numImages} via Replicate`)
        try {
          const output = await this.generateImageReplicate(request)
          outputs.push(output)
          
          // Add delay between sequential requests
          if (i < numImages - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        } catch (error: any) {
          console.error(`Nano banana pro: Replicate image ${i + 1}/${numImages} failed:`, error.message)
        }
      }
      
      if (outputs.length === 0) {
        throw new Error('All image generations failed via Replicate')
      }
      
      return {
        id: `gen-${Date.now()}`,
        status: 'completed',
        outputs,
        metadata: {
          model: this.config.id,
          prompt: request.prompt,
          backend: 'replicate',
        },
      }
    }
    
    // Gemini 3 Pro Image (Nano banana pro) endpoint
    // Uses Vertex AI if configured, otherwise falls back to Gemini API directly
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

    // Aggregate metrics from Replicate fallback (if used)
    // Calculate total predict time from outputs that came from Replicate
    const totalPredictTime = outputs.reduce((sum, output) => {
      const predictTime = output._metrics?.predictTime
      return sum + (predictTime || 0)
    }, 0)
    
    // Check if any output came from Replicate
    const usedReplicate = outputs.some(output => output._metrics?.provider === 'replicate')
    
    // Clean up internal _metrics field from outputs
    const cleanOutputs = outputs.map(({ _metrics, ...output }) => output)

    return {
      id: `gen-${Date.now()}`,
      status: 'completed',
      outputs: cleanOutputs,
      metadata: {
        model: this.config.id,
        prompt: request.prompt,
      },
      // Include metrics for accurate cost calculation when Replicate fallback was used
      ...(usedReplicate && totalPredictTime > 0 && {
        metrics: {
          predictTime: totalPredictTime,
        },
      }),
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
        // Try Replicate fallback instead of failing
        if (isQuotaExhaustedError(error)) {
          console.error(`Nano banana pro: Quota exhausted (limit: 0 or daily quota).`)
          
          // Try Replicate fallback if available
          if (REPLICATE_API_KEY) {
            console.log(`Nano banana pro: Attempting Replicate fallback (google/nano-banana-pro)...`)
            try {
              return await this.generateImageReplicate(request)
            } catch (replicateError: any) {
              console.error(`Nano banana pro: Replicate fallback also failed:`, replicateError.message)
              throw new Error('All APIs exhausted (Vertex AI, Gemini API, Replicate). Please try again later.')
            }
          }
          
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
    const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1'
    console.log(`Nano banana pro: Using Vertex AI (region: ${location})`)
    
    // Track API call for rate limiting (Vertex AI counts as Gemini for rate limits)
    try {
      await recordApiCall('gemini', 'gemini-nano-banana-pro', 1)
    } catch (trackErr) {
      console.warn('[GeminiAdapter] Failed to track Vertex AI API call:', trackErr)
    }
    
    if (!vertexAiClient) {
      throw new Error('Vertex AI client not initialized')
    }
    
    try {
      // Use preview.getGenerativeModel() for preview models like gemini-3-pro-image-preview
      // Note: Some preview models may not be available via Vertex AI SDK yet
      // If this fails with 404, the model might only be available via Gemini API
      const model = vertexAiClient.preview.getGenerativeModel({
        model: 'gemini-3-pro-image-preview',
      })

      console.log('[Vertex AI] Model initialized, calling generateContent...')
      const result = await model.generateContent({
        contents: payload.contents,
        generationConfig: payload.generationConfig,
      })
      console.log('[Vertex AI] generateContent call successful')

      // Extract image from response
      const response = result.response
      
      // Check for content safety blocks BEFORE looking for image data
      // Vertex AI uses the same response structure as Gemini API
      const vertexContentBlock = parseGeminiContentBlock(response)
      if (vertexContentBlock) {
        console.error('[Vertex AI] Content blocked by safety filter:', vertexContentBlock)
        throw new Error(vertexContentBlock)
      }
      
      const candidates = response.candidates || []
      
      if (candidates.length === 0) {
        console.error('Vertex AI response missing candidates:', JSON.stringify(redactLargeStrings(result), null, 2))
        throw new Error('No image candidates returned from Vertex AI. The prompt may have been filtered by content safety. Try rephrasing.')
      }
      
      const content = candidates[0]?.content
      if (!content || !content.parts) {
        console.error('Vertex AI response missing content parts:', JSON.stringify(redactLargeStrings(result), null, 2))
        throw new Error('No content parts in Vertex AI response. Try a different prompt.')
      }
      
      const imagePart = content.parts.find(
        (part: any) => part.inlineData?.mimeType?.startsWith('image/')
      )

      if (!imagePart?.inlineData?.data) {
        console.error('Vertex AI response missing image data:', JSON.stringify(redactLargeStrings(result), null, 2))
        throw new Error('No image data in Vertex AI response. The API returned a successful status but no image. This may be a transient issue — please try again.')
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
      console.error('[Vertex AI] Generation error occurred')
      console.error(`[Vertex AI]   Error type: ${error?.constructor?.name || typeof error}`)
      console.error(`[Vertex AI]   Error message: ${error?.message || String(error)}`)
      
      // Extract error message and string for error handling
      const errorMessage = error?.message || String(error)
      const errorString = String(error)
      
      // Check for 404 - model not found (might not be available via Vertex AI SDK)
      if (error?.code === 404 || error?.status === 404 || errorMessage.includes('404') || errorMessage.includes('was not found')) {
        console.error('[Vertex AI] ⚠️  Model not found (404) - gemini-3-pro-image-preview may not be available via Vertex AI SDK yet')
        console.error('[Vertex AI]   This preview model might only be accessible via Gemini API (AI Studio)')
        console.error('[Vertex AI]   Falling back to Gemini API...')
        // Don't throw - let it fall through to Gemini API fallback
        if (this.apiKey) {
          const endpoint = `${this.baseUrl}/models/gemini-3-pro-image-preview:generateContent`
          return await this.generateImageGeminiAPI(endpoint, payload)
        }
        throw new Error('Model not available via Vertex AI. Please use Gemini API (AI Studio) instead.')
      }
      
      // Check if error is an HTML response (authentication/configuration issue)
      
      if (errorMessage.includes('<!DOCTYPE') || errorMessage.includes('Unexpected token') || errorString.includes('<!DOCTYPE')) {
        console.error('[Vertex AI] ⚠️  Received HTML response instead of JSON - authentication/configuration issue detected')
        console.error('[Vertex AI]   This usually means:')
        console.error('[Vertex AI]     1. Authentication failed (invalid credentials)')
        console.error('[Vertex AI]     2. Service account lacks required permissions')
        console.error('[Vertex AI]     3. Vertex AI API not enabled for the project')
        console.error('[Vertex AI]     4. Incorrect region (though us-central1 should be correct)')
        console.error('[Vertex AI]   Troubleshooting steps:')
        console.error('[Vertex AI]     - Verify GOOGLE_APPLICATION_CREDENTIALS_JSON in Vercel contains valid JSON (no file paths)')
        console.error('[Vertex AI]     - Check service account has "Vertex AI User" role')
        console.error('[Vertex AI]     - Ensure Vertex AI API is enabled: https://console.cloud.google.com/apis/library/aiplatform.googleapis.com')
        console.error('[Vertex AI]     - Verify project ID matches: gen-lang-client-0963396085')
        
        // Try to extract more details from the error
        if (error?.response || error?.body) {
          const responseBody = error?.response?.body || error?.body
          if (responseBody && typeof responseBody === 'string' && responseBody.includes('<!DOCTYPE')) {
            const htmlPreview = responseBody.substring(0, 500)
            console.error(`[Vertex AI]   HTML response preview: ${htmlPreview}...`)
          }
        }
        
        throw new Error('Vertex AI authentication failed. Please check your credentials configuration in Vercel environment variables and verify the service account has Vertex AI User role.')
      }
      
      // Log other error details
      if (error?.code) {
        console.error(`[Vertex AI]   Error code: ${error.code}`)
      }
      if (error?.status) {
        console.error(`[Vertex AI]   HTTP status: ${error.status}`)
      }
      if (error?.details) {
        console.error(`[Vertex AI]   Error details:`, JSON.stringify(error.details, null, 2))
      }
      if (error?.stack) {
        console.error(`[Vertex AI]   Stack trace:`, error.stack)
      }
      
      // On quota exhaustion, try Replicate as final fallback
      if (isQuotaExhaustedError(error)) {
        console.log('[Vertex AI] Quota exhausted, trying Replicate fallback...')
        if (REPLICATE_API_KEY) {
          try {
            return await this.generateImageReplicate(request)
          } catch (replicateError: any) {
            console.error('[Vertex AI] Replicate fallback also failed:', replicateError.message)
            throw new Error('All APIs exhausted (Vertex AI, Gemini API, Replicate). Please try again later.')
          }
        }
        throw new Error('Quota exhausted. Please check your API quota limits or try again later.')
      }
      
      // Only fallback to Gemini API if it's not a quota issue and we have an API key
      if (this.apiKey && !isQuotaExhaustedError(error)) {
        console.log('Falling back to Gemini API due to Vertex AI error')
        const endpoint = `${this.baseUrl}/models/gemini-3-pro-image-preview:generateContent`
        try {
          return await this.generateImageGeminiAPI(endpoint, payload)
        } catch (fallbackError: any) {
          // If Gemini API also has quota issues, try Replicate as final fallback
          if (isQuotaExhaustedError(fallbackError)) {
            console.log('[Gemini API] Quota exhausted, trying Replicate fallback...')
            if (REPLICATE_API_KEY) {
              try {
                return await this.generateImageReplicate(request)
              } catch (replicateError: any) {
                console.error('[Gemini API] Replicate fallback also failed:', replicateError.message)
                throw new Error('All APIs exhausted (Vertex AI, Gemini API, Replicate). Please try again later.')
              }
            }
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
    
    // Track API call for rate limiting
    try {
      await recordApiCall('gemini', 'gemini-nano-banana-pro', 1)
    } catch (trackErr) {
      console.warn('[GeminiAdapter] Failed to track API call:', trackErr)
    }
    
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
      
      // Check for rate limit and record it
      checkGoogleRateLimit(error, 'gemini', 'gemini-nano-banana-pro')
      
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

    // Check for content safety blocks BEFORE looking for image data
    // Google can return 200 OK but with blocked content (no image)
    const contentBlock = parseGeminiContentBlock(data)
    if (contentBlock) {
      console.error('Nano banana pro: Content blocked by safety filter:', contentBlock)
      console.error('Nano banana pro: Full response:', JSON.stringify(redactLargeStrings(data), null, 2))
      throw new Error(contentBlock)
    }

    // Extract image from response
    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (part: any) => part.inlineData?.mimeType?.startsWith('image/')
    )

    if (!imagePart?.inlineData?.data) {
      console.error('Gemini response missing image data:', JSON.stringify(redactLargeStrings(data), null, 2))
      throw new Error('No image data in Gemini response. The API returned a successful status but no image. This may be a transient issue — please try again.')
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

  /**
   * Third fallback: Replicate API (google/nano-banana-pro)
   * Used when both Vertex AI and Gemini API fail with quota/availability issues
   * Docs: https://replicate.com/google/nano-banana-pro
   */
  private async generateImageReplicate(request: GenerationRequest): Promise<any> {
    if (!REPLICATE_API_KEY) {
      throw new Error('Replicate API key not configured. Cannot use Replicate fallback.')
    }

    console.log('[Nano Banana Pro] Using Replicate fallback (google/nano-banana-pro)')
    
    // Track API call for rate limiting
    try {
      await recordApiCall('replicate', 'replicate-nano-banana', 1)
    } catch (trackErr) {
      console.warn('[GeminiAdapter] Failed to track Replicate API call:', trackErr)
    }

    const baseUrl = 'https://api.replicate.com/v1'

    // Map aspect ratio to Replicate format
    const aspectRatio = request.aspectRatio || '1:1'

    // Build input for Replicate - Nano Banana Pro API
    // Docs: https://replicate.com/google/nano-banana-pro
    // MINIMAL INPUT TEST - only prompt to rule out parameter issues
    const input: any = {
      prompt: request.prompt,
    }
    
    console.log(`[Nano Banana Pro] Submitting MINIMAL input:`, JSON.stringify(input))

    // Add optional parameters only if they differ from defaults
    if (aspectRatio && aspectRatio !== '1:1') {
      input.aspect_ratio = aspectRatio
    }

    // Add reference images if provided
    // Nano Banana Pro uses 'image_input' parameter (array, up to 14 images) - same as Seedream 4.5
    // NOTE: Previously used 'image_urls' which was WRONG and caused reference images to be ignored!
    const referenceImages = request.referenceImages || (request.referenceImage ? [request.referenceImage] : [])
    if (referenceImages.length > 0) {
      input.image_input = referenceImages
      console.log(`[Replicate Fallback] ✅ Using ${referenceImages.length} reference image(s) via image_input`)
      console.log(`[Replicate Fallback] First image type: ${referenceImages[0]?.startsWith('data:') ? 'data URL' : referenceImages[0]?.startsWith('http') ? 'public URL' : 'unknown'}`)
    } else {
      console.log(`[Replicate Fallback] ⚠️ No reference images provided - text-to-image only`)
    }

    // Resolution mapping - Nano Banana Pro uses "1K", "2K", "4K" strings
    // According to Gemini API docs: https://ai.google.dev/gemini-api/docs/image-generation
    // Nano Banana Pro supports 1K (1024px), 2K (2048px), and 4K (4096px) resolutions
    if (request.resolution) {
      const resolution = request.resolution === 4096 ? '4K' : request.resolution === 2048 ? '2K' : '1K'
      input.resolution = resolution
      console.log(`[Replicate Fallback] Using resolution: ${resolution}`)
    } else {
      console.log(`[Replicate Fallback] No resolution specified, using model default (1K)`)
    }

    try {
      // First, fetch the latest version for the model
      const modelResponse = await fetch(`${baseUrl}/models/google/nano-banana-pro`, {
        headers: {
          'Authorization': `Token ${REPLICATE_API_KEY}`,
        },
      })

      if (!modelResponse.ok) {
        const errorText = await modelResponse.text()
        throw new Error(`Failed to fetch Replicate model info: ${errorText}`)
      }

      const modelData = await modelResponse.json()
      const versionHash = modelData.latest_version?.id

      if (!versionHash) {
        throw new Error('Could not determine latest version for google/nano-banana-pro')
      }

      console.log(`[Replicate Fallback] Using version: ${versionHash}`)

      // Submit prediction with retry logic for transient server errors (502, 503, 504)
      let data: any
      let lastError: any = null
      const maxSubmitAttempts = 3
      
      for (let submitAttempt = 1; submitAttempt <= maxSubmitAttempts; submitAttempt++) {
        try {
          const response = await fetch(`${baseUrl}/predictions`, {
            method: 'POST',
            headers: {
              'Authorization': `Token ${REPLICATE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              version: versionHash,
              input,
            }),
          })

          if (!response.ok) {
            // Check for retryable server errors
            if ([502, 503, 504].includes(response.status) && submitAttempt < maxSubmitAttempts) {
              const delay = Math.pow(2, submitAttempt) * 1000 // 2s, 4s
              console.log(`[Replicate Fallback] Server error ${response.status}, retrying in ${delay}ms (attempt ${submitAttempt}/${maxSubmitAttempts})`)
              await new Promise(resolve => setTimeout(resolve, delay))
              continue
            }
            
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.detail || errorData.error || `Replicate API error: ${response.status}`)
          }

          data = await response.json()
          break // Success, exit retry loop
        } catch (submitError: any) {
          lastError = submitError
          
          // Only retry on network errors or server errors
          if (submitAttempt < maxSubmitAttempts && (submitError.message?.includes('502') || submitError.message?.includes('503') || submitError.message?.includes('504') || submitError.code === 'ECONNRESET')) {
            const delay = Math.pow(2, submitAttempt) * 1000
            console.log(`[Replicate Fallback] ${submitError.message}, retrying in ${delay}ms (attempt ${submitAttempt}/${maxSubmitAttempts})`)
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }
          throw submitError
        }
      }
      
      if (!data) {
        throw lastError || new Error('Failed to submit prediction after retries')
      }
      const predictionId = data.id

      console.log(`[Replicate Fallback] Prediction started: ${predictionId}`)
      console.log(`[Replicate Fallback] Full prediction response:`, JSON.stringify(data, null, 2))

      // Poll for results (max 10 minutes - same as Seedream adapter)
      let attempts = 0
      const maxAttempts = 120

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

        // Poll with retry for transient errors
        let statusData: any
        let pollRetries = 2
        for (let pollAttempt = 0; pollAttempt <= pollRetries; pollAttempt++) {
          try {
            const statusResponse = await fetch(`${baseUrl}/predictions/${predictionId}`, {
              headers: {
                'Authorization': `Token ${REPLICATE_API_KEY}`,
              },
            })

            if (!statusResponse.ok) {
              // Retry on 502/503/504
              if ([502, 503, 504].includes(statusResponse.status) && pollAttempt < pollRetries) {
                console.log(`[Replicate Fallback] Poll returned ${statusResponse.status}, retrying...`)
                await new Promise(resolve => setTimeout(resolve, 2000))
                continue
              }
              throw new Error(`Failed to check prediction status: ${statusResponse.status}`)
            }

            statusData = await statusResponse.json()
            break
          } catch (pollError: any) {
            // Retry on JSON parse errors (malformed responses)
            if (pollAttempt < pollRetries && (pollError.message?.includes('JSON') || pollError.message?.includes('Unexpected'))) {
              console.log(`[Replicate Fallback] Poll parse error, retrying: ${pollError.message}`)
              await new Promise(resolve => setTimeout(resolve, 2000))
              continue
            }
            throw pollError
          }
        }
        
        if (!statusData) {
          attempts++
          continue
        }
        console.log(`[Replicate Fallback] Status: ${statusData.status} (attempt ${attempts + 1})`)

        if (statusData.status === 'succeeded') {
          let outputUrl: string | null = null

          if (Array.isArray(statusData.output) && statusData.output.length > 0) {
            outputUrl = statusData.output[0]
          } else if (typeof statusData.output === 'string') {
            outputUrl = statusData.output
          }

          if (!outputUrl) {
            throw new Error('No image URL in Replicate response')
          }

          // Capture actual predict_time for accurate cost calculation
          const predictTime = statusData.metrics?.predict_time
          if (predictTime) {
            console.log(`[Replicate Fallback] ✅ Image generated in ${predictTime.toFixed(2)}s`)
          } else {
            console.log(`[Replicate Fallback] ✅ Image generated successfully`)
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

          const dimensions = aspectRatioDimensions[aspectRatio] || { width: 1024, height: 1024 }

          return {
            url: outputUrl,
            width: dimensions.width,
            height: dimensions.height,
            // Include metrics for cost calculation (will be aggregated in main generate)
            _metrics: {
              predictTime: predictTime,
              provider: 'replicate',
            },
          }
        } else if (statusData.status === 'failed' || statusData.status === 'canceled') {
          throw new Error(`Replicate generation failed: ${statusData.error || 'Unknown error'}`)
        }

        attempts++
      }

      throw new Error('Replicate generation timeout')
    } catch (error: any) {
      console.error('[Replicate Fallback] Error:', error.message)
      throw error
    }
  }

  private async generateVideo(request: GenerationRequest): Promise<GenerationResponse> {
    console.log(`[Veo 3.1] Starting video generation for prompt: ${request.prompt.substring(0, 50)}...`)
    
    const duration = request.duration || 8
    const resolution = request.resolution || 720
    const aspectRatio = request.aspectRatio || '16:9'
    
    // Calculate dimensions based on aspect ratio and resolution
    // Veo 3.1 supports 720p, 1080p, and 4K (2160)
    const getDimensions = (aspectRatio: string, resolution: number) => {
      const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
      if (aspectRatio === '16:9') {
        if (resolution === 2160) return { width: 3840, height: 2160 }
        if (resolution === 1080) return { width: 1920, height: 1080 }
        return { width: 1280, height: 720 }
      }
      if (aspectRatio === '9:16') {
        if (resolution === 2160) return { width: 2160, height: 3840 }
        if (resolution === 1080) return { width: 1080, height: 1920 }
        return { width: 720, height: 1280 }
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
    
    // Track API call for rate limiting
    try {
      await recordApiCall('gemini', 'gemini-veo-3.1', 1)
    } catch (trackErr) {
      console.warn('[GeminiAdapter] Failed to track Veo API call:', trackErr)
    }
    
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

    // Helper to parse image from base64 data URL or HTTP URL
    const parseImageInput = async (
      dataUrl: string | undefined,
      httpUrl: string | undefined,
      label: string
    ): Promise<{ bytes: Buffer; contentType: string } | null> => {
      // Handle base64 data URL directly
      if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        console.log(`[Veo 3.1] Using ${label} from base64 data URL`)
        // Use indexOf/slice instead of regex to avoid stack overflow on large strings
        const commaIndex = dataUrl.indexOf(',')
        if (commaIndex === -1) {
          console.warn(`[Veo 3.1] Invalid base64 format for ${label}, ignoring`)
          return null
        }
        const metaSection = dataUrl.slice(5, commaIndex) // Skip "data:"
        const base64Data = dataUrl.slice(commaIndex + 1)
        const mimeMatch = metaSection.match(/^([^;]+)/)
        const contentType = mimeMatch ? mimeMatch[1] : 'image/jpeg'
        return { bytes: Buffer.from(base64Data, 'base64'), contentType }
      }
      
      // Handle URL - download first
      if (httpUrl && typeof httpUrl === 'string' && httpUrl.startsWith('http')) {
        console.log(`[Veo 3.1] Downloading ${label} from URL: ${httpUrl.slice(0, 50)}...`)
        try {
          const imageResponse = await fetch(httpUrl)
          if (!imageResponse.ok) {
            throw new Error(`Failed to fetch ${label}: ${imageResponse.statusText}`)
          }
          const imageBuffer = await imageResponse.arrayBuffer()
          const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
          return { bytes: Buffer.from(imageBuffer), contentType }
        } catch (error: any) {
          console.error(`[Veo 3.1] Failed to download ${label}:`, error)
          return null
        }
      }
      
      return null
    }

    // Check for start frame (reference image) - can be base64 (referenceImage) or URL (referenceImageUrl)
    // Veo 3.1 requires inline base64 data, not fileUri
    const startFrame = await parseImageInput(
      request.referenceImage,
      (request as any).referenceImageUrl,
      'start frame'
    )
    
    if (!startFrame) {
      console.log(`[Veo 3.1] No start frame provided, generating text-to-video`)
    }
    
    // Check for end frame (for frame interpolation)
    // Veo 3.1 uses 'lastFrame' parameter for the ending frame
    const endFrame = await parseImageInput(
      (request.parameters as any)?.endFrameImage,
      (request.parameters as any)?.endFrameImageUrl,
      'end frame (lastFrame)'
    )
    
    // Helper to build image object in the correct schema format
    // Veo predictLongRunning uses bytesBase64Encoded, NOT inlineData
    type ImageSchema = 'bytesBase64Encoded' | 'inlineData'
    const buildImageObject = (base64Data: string, mimeType: string, schema: ImageSchema) => {
      if (schema === 'bytesBase64Encoded') {
        return { bytesBase64Encoded: base64Data, mimeType }
      } else {
        return { inlineData: { mimeType, data: base64Data } }
      }
    }
    
    // Helper to build the full payload with a given image schema
    const buildPayload = (schema: ImageSchema) => {
      // Build instance object according to Veo 3.1 API docs
      // https://ai.google.dev/gemini-api/docs/video
      const cleanInstance: any = {
        prompt: instance.prompt,
      }
      
      // For image-to-video, use 'image' parameter directly (not referenceImages)
      // referenceImages is for style/content guidance with up to 3 images
      if (startFrame) {
        const base64Image = startFrame.bytes.toString('base64')
        // Image-to-video uses direct 'image' field in instance
        cleanInstance.image = buildImageObject(base64Image, startFrame.contentType, schema)
        console.log(`[Veo 3.1] Added starting frame image (${base64Image.length} chars, ${startFrame.contentType}, schema: ${schema})`)
      }
      
      // Build payload with separate 'parameters' object (per REST API docs)
      const payload: any = {
        instances: [cleanInstance],
        parameters: {
          aspectRatio: options.aspectRatio,
          // Resolution must be "720p", "1080p", or "4k" (string)
          // Per Veo 3.1 docs: 1080p/4k require 8 seconds duration
          resolution: options.resolution === 2160 ? '4k' : options.resolution === 1080 ? '1080p' : '720p',
          // Duration in seconds as number (not string!)
          durationSeconds: duration,
        },
      }
      
      // Add end frame (lastFrame) for frame interpolation if provided
      // Per docs: "The ending frame is passed as a generation constraint in the config"
      // https://ai.google.dev/gemini-api/docs/video#using-first-and-last-video-frames
      if (endFrame) {
        const base64EndImage = endFrame.bytes.toString('base64')
        payload.parameters.lastFrame = buildImageObject(base64EndImage, endFrame.contentType, schema)
        console.log(`[Veo 3.1] Added ending frame (lastFrame) for interpolation (${base64EndImage.length} chars, ${endFrame.contentType}, schema: ${schema})`)
      }
      
      return payload
    }
    
    // Helper to make the API request
    const makeRequest = async (payload: any): Promise<Response> => {
      console.log(`[Veo 3.1] Calling API with ${duration}s video, ${options.resolution}p, ${options.aspectRatio}`)
      console.log(`[Veo 3.1] Payload (redacted):`, JSON.stringify(redactLargeStrings(payload), null, 2))
      
      return fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    }
    
    // Check if error is a schema-related error that warrants a retry with alternative schema
    const isSchemaError = (errorMessage: string): ImageSchema | null => {
      const msg = errorMessage.toLowerCase()
      if (msg.includes('inlinedata') && (msg.includes("isn't supported") || msg.includes('not supported') || msg.includes('unknown field'))) {
        // Error mentions inlineData not supported -> try bytesBase64Encoded
        return 'bytesBase64Encoded'
      }
      if (msg.includes('bytesbase64encoded') && (msg.includes("isn't supported") || msg.includes('not supported') || msg.includes('unknown field'))) {
        // Error mentions bytesBase64Encoded not supported -> try inlineData
        return 'inlineData'
      }
      return null
    }
    
    try {
      // Primary attempt: use bytesBase64Encoded schema (per Veo predictLongRunning API docs)
      let currentSchema: ImageSchema = 'bytesBase64Encoded'
      let payload = buildPayload(currentSchema)
      let response = await makeRequest(payload)

      // If the request failed, check if it's a schema error and retry with alternative
      if (!response.ok) {
        const errorData = await response.json()
        const errorMessage = errorData.error?.message || 'Video generation request failed'
        
        const alternativeSchema = isSchemaError(errorMessage)
        if (alternativeSchema && alternativeSchema !== currentSchema) {
          console.log(`[Veo 3.1] Schema error detected, retrying with ${alternativeSchema} format...`)
          currentSchema = alternativeSchema
          payload = buildPayload(currentSchema)
          response = await makeRequest(payload)
          
          if (!response.ok) {
            const retryErrorData = await response.json()
            throw new Error(retryErrorData.error?.message || 'Video generation request failed after schema retry')
          }
        } else {
          throw new Error(errorMessage)
        }
      }

      const operation = await response.json()
      const operationName = operation.name
      
      console.log('[Veo 3.1] Generation started', {
        operation: operationName,
        startFrameAttached: Boolean(startFrame),
        endFrameAttached: Boolean(endFrame),
        mode: startFrame && endFrame ? 'frame-interpolation' : startFrame ? 'image-to-video' : 'text-to-video',
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
            startFrameAttached: Boolean(startFrame),
            endFrameAttached: Boolean(endFrame),
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
  name: 'Nano Banana Pro',
  provider: 'Google',
  type: 'image',
  description: 'Gemini 3 Pro Image - Advanced image generation with superior quality',
  maxResolution: 4096, // Max dimension for 4K resolution (actual dimensions vary by aspect ratio)
  defaultAspectRatio: '1:1',
  // All 10 supported aspect ratios from official Gemini API documentation
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  capabilities: {
    editing: true,
    'text-2-image': true,
    multiImageEditing: true, // Gemini 3 Pro Image supports multiple reference images
    maxReferenceImages: 14, // Per Gemini API docs: up to 14 reference images
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
  description: 'State-of-the-art video generation with native audio and natively generated sound',
  defaultAspectRatio: '16:9',
  // Veo 3.1 officially supports: 16:9 and 9:16 only (per docs)
  supportedAspectRatios: ['16:9', '9:16'],
  maxResolution: 2160, // 4K support
  capabilities: {
    'text-2-video': true,
    'image-2-video': true,
    'frame-interpolation': true, // Supports first + last frame interpolation
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
        { label: '4K', value: 2160 },
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

