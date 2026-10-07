import { BaseModelAdapter, GenerationRequest, GenerationResponse, ModelConfig } from '../base'
import { GEMINI_IMAGE_PRICES_USD } from '../pricing'
import { recordApiCall } from '@/lib/rate-limits/usage'
import { getScopeForModel } from '@/lib/rate-limits/config'
import { checkGoogleRateLimit } from '@/lib/rate-limits/trackedFetch'

/**
 * Google Gemini/Vertex AI Adapter
 * Supports Gemini 3 Pro Image (Nano Banana Pro), Nano Banana 2.1 and Gemini Omni Flash (video)
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

// Check if error is a transient upstream error (502/503/504) that should be retried
const isTransientError = (error: any): boolean => {
  const status = error?.status || error?.code || error?.error?.code
  if ([502, 503, 504].includes(status)) return true

  const msg = (error?.message || '').toLowerCase()
  return (
    msg.includes('service unavailable') ||
    msg.includes('503') ||
    msg.includes('bad gateway') ||
    msg.includes('502') ||
    msg.includes('gateway timeout') ||
    msg.includes('504') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed')
  )
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

/**
 * Select the FINAL rendered image from a Gemini image-generation response.
 *
 * Gemini 3 image models are *thinking* image models. Nano Banana Pro
 * (gemini-3-pro-image) always thinks and cannot be disabled; Nano Banana 2.1
 * (gemini-nano-banana-2.1) thinks at `thinking_level` medium by default. While thinking,
 * the model emits up to two interim "thought images" — low-fidelity composition
 * drafts that look like a hazy/foggy version of the result — BEFORE the final,
 * fully-rendered image. Every draft and the final arrive as inlineData image
 * parts inside candidates[0].content.parts.
 *
 * Picking the FIRST image part (Array.find) returns a hazy draft. We follow
 * Google's documented extraction priority and return the final render:
 *   1. last image part with `thought !== true`     (highest reliability)
 *   2. last image part carrying a `thoughtSignature` (only the final image has one)
 *   3. last image part overall                       (safety net)
 *
 * Docs: https://ai.google.dev/gemini-api/docs/image-generation (Thinking process)
 */
const selectFinalImagePart = (parts: any[] | undefined | null): any | null => {
  if (!Array.isArray(parts)) return null

  const imageParts = parts.filter(
    (part: any) =>
      part?.inlineData?.mimeType?.startsWith('image/') && part?.inlineData?.data
  )
  if (imageParts.length === 0) return null

  if (imageParts.length > 1) {
    console.log(
      `[Gemini] Response contains ${imageParts.length} image parts (interim "thought" drafts + final render). Selecting the final render to avoid the hazy-draft bug.`
    )
  }

  // 1. Final render is the last image not flagged as a thinking draft.
  const nonThought = imageParts.filter((part: any) => part?.thought !== true)
  if (nonThought.length > 0) return nonThought[nonThought.length - 1]

  // 2. Only the final image carries a thought signature.
  const signed = imageParts.filter(
    (part: any) => part?.thoughtSignature || part?.thought_signature
  )
  if (signed.length > 0) return signed[signed.length - 1]

  // 3. Safety net: the last image in the array is the final one.
  return imageParts[imageParts.length - 1]
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
        // Never log the value: it is meant to be a path, and when someone puts the service account's
        // JSON in it instead, logging it prints the private key into the function logs.
        const looksInline = credentialsPath.trim().startsWith('{')
        console.log(`[Vertex AI] Using credentials from GOOGLE_APPLICATION_CREDENTIALS (${looksInline ? 'inline JSON, not a path: move it to GOOGLE_APPLICATION_CREDENTIALS_JSON' : `a file path, ${credentialsPath.length} chars`})`)
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
        // The us-central1-only note was about gemini-3-pro-image-preview (shut down 2026-06-25).
        // Whether Vertex serves the GA ids (gemini-3-pro-image, gemini-nano-banana-2.1) in this
        // region is not confirmed; a 404 falls back to the Gemini API below.
        console.log(`[Vertex AI]   Note: GA image ids on Vertex are unconfirmed; a 404 falls back to the Gemini API`)
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

  /** Resolve the Gemini API model name from the internal config id */
  private get apiModelName(): string {
    return GEMINI_API_MODEL_MAP[this.config.id] || 'gemini-3-pro-image'
  }

  private get modelLabel(): string {
    return this.config.name
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
    const label = this.modelLabel
    console.log(`${label}: Starting image generation`)
    console.log(`${label}: Prompt:`, request.prompt)
    const referenceImages = request.referenceImages || (request.referenceImage ? [request.referenceImage] : [])
    console.log(`${label}: Reference images count:`, referenceImages.length)
    
    // Toggle between Replicate and Gemini API for Nano Banana
    // Set to false to use Google's Gemini API directly (PREFERRED - faster and cheaper)
    // Set to true to bypass Google APIs and use Replicate as fallback
    const USE_REPLICATE_DIRECTLY = false
    
    if (USE_REPLICATE_DIRECTLY && REPLICATE_API_KEY) {
      console.log(`${label}: Using Replicate directly (Vertex AI/Gemini API temporarily disabled)`)
      const numImages = request.numOutputs || 1
      const outputs: any[] = []
      let lastReplicateError: string | null = null
      
      for (let i = 0; i < numImages; i++) {
        console.log(`${label}: Generating image ${i + 1}/${numImages} via Replicate`)
        try {
          const output = await this.generateImageReplicate(request)
          outputs.push(output)
          
          // Add delay between sequential requests
          if (i < numImages - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000))
          }
        } catch (error: any) {
          lastReplicateError = error.message || 'Unknown error'
          console.error(`${label}: Replicate image ${i + 1}/${numImages} failed:`, lastReplicateError)
        }
      }
      
      if (outputs.length === 0) {
        throw new Error(lastReplicateError || 'All image generations failed via Replicate')
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
    
    const endpoint = `${this.baseUrl}/models/${this.apiModelName}:generateContent`

    const numImages = request.numOutputs || 1
    
    // Generate images sequentially (one at a time) to avoid rate limits
    // This prevents parallel request storms that trigger 429 errors
    const outputs: any[] = []
    let lastError: string | null = null
    
    for (let i = 0; i < numImages; i++) {
      console.log(`${label}: Generating image ${i + 1}/${numImages}`)
      
      try {
        const output = await this.generateSingleImageWithRetry(endpoint, request, i + 1, numImages)
        outputs.push(output)
        
        // Add delay between sequential requests (except after the last one)
        if (i < numImages - 1) {
          await new Promise(resolve => setTimeout(resolve, IMAGE_GENERATION_DELAY_MS))
        }
      } catch (error: any) {
        lastError = error.message || 'Unknown error'
        console.error(`${label}: Image ${i + 1}/${numImages} failed:`, lastError)
        // Continue to next image even if one fails
        // We'll throw with the actual error if all fail at the end
      }
    }

    if (outputs.length === 0) {
      // Propagate the actual error instead of a generic message
      throw new Error(lastError || 'All image generations failed')
    }

    // Aggregate metrics from Replicate fallback (if used)
    // Calculate total predict time from outputs that came from Replicate
    const totalPredictTime = outputs.reduce((sum, output) => {
      const predictTime = output._metrics?.predictTime
      return sum + (predictTime || 0)
    }, 0)
    
    // Check if any output came from Replicate
    const usedReplicate = outputs.some(output => output._metrics?.provider === 'replicate')
    
    // Clean up internal _metrics / _routeMeta fields from outputs
    const cleanOutputs = outputs.map(({ _metrics, _routeMeta, ...output }) => output)

    const routeMeta = outputs.find((output) => output._routeMeta)?._routeMeta

    return {
      id: `gen-${Date.now()}`,
      status: 'completed',
      outputs: cleanOutputs,
      metadata: {
        model: this.config.id,
        prompt: request.prompt,
        backend: routeMeta?.backend ?? (this.useGenAI ? 'vertex' : 'gemini-api'),
        isFallback: routeMeta?.isFallback ?? false,
        routeReason: routeMeta?.routeReason ?? null,
        effectiveModelId: this.config.id,
      },
      // Include metrics for accurate cost calculation when Replicate fallback was used
      ...(usedReplicate && totalPredictTime > 0 && {
        metrics: {
          predictTime: totalPredictTime,
        },
      }),
    }
  }

  private async generateSingleImageWithRetry(
    endpoint: string,
    request: GenerationRequest,
    imageIndex: number,
    totalImages: number
  ): Promise<any> {
    const label = this.modelLabel
    let lastError: any = null
    const allowFallback = request.allowFallback !== false
    
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.generateSingleImage(endpoint, request)
      } catch (error: any) {
        lastError = error
        
        if (isQuotaExhaustedError(error)) {
          console.error(`${label}: Quota exhausted (limit: 0 or daily quota).`)
          
          if (!allowFallback) {
            throw new Error(
              'Primary Google provider quota exhausted. Retry later or pass allowFallback: true to permit Replicate routing.'
            )
          }

          if (REPLICATE_API_KEY) {
            console.log(`${label}: Attempting Replicate fallback (google/nano-banana-pro)...`)
            try {
              return await this.generateImageReplicate(request, 'quota_exhausted')
            } catch (replicateError: any) {
            console.error(`${label}: Replicate fallback also failed:`, replicateError.message)
                throw new Error('All APIs exhausted (Vertex AI, Gemini API, Replicate). Please try again later.')
              }
            }
            
            throw new Error('Quota exhausted. Please check your API quota limits or try again later.')
          }
          
          const retryable = isRateLimitError(error) || isTransientError(error)
          if (retryable && attempt < MAX_RETRY_ATTEMPTS) {
            const errorType = isRateLimitError(error) ? '429 rate limit' : `${error?.status || '5xx'} transient`
            const baseDelay = isTransientError(error) && !isRateLimitError(error)
              ? Math.min((attempt + 1) * 2000, 16000)
              : Math.pow(2, attempt - 1) * 1000
            const jitter = Math.random() * baseDelay * 0.5
            const delay = baseDelay + jitter
            
            console.log(
              `${label}: Image ${imageIndex}/${totalImages} - ${errorType} on attempt ${attempt}/${MAX_RETRY_ATTEMPTS}. Retrying in ${Math.round(delay)}ms...`
            )
          
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        
        if (isTransientError(error) && REPLICATE_API_KEY) {
          if (!allowFallback) {
            throw error
          }
          console.log(`${label}: Google API persistently unavailable after ${attempt} attempts. Falling back to Replicate...`)
          try {
            return await this.generateImageReplicate(request, 'transient_upstream')
          } catch (replicateError: any) {
            console.error(`${label}: Replicate fallback also failed:`, replicateError.message)
            throw new Error(
              'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.'
            )
          }
        }
        
        // Not a retryable error or max retries reached with no fallback
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

    // Nano Banana 2.1 drops Nano Banana 2's extreme ratios (1:4, 4:1, 1:8, 8:1).
    if (request.aspectRatio && this.config.supportedAspectRatios && !this.config.supportedAspectRatios.includes(request.aspectRatio)) {
      throw new Error(`${this.modelLabel} does not support aspect ratio ${request.aspectRatio}. Use one of: ${this.config.supportedAspectRatios.join(', ')}.`)
    }

    if (request.aspectRatio || request.resolution) {
      // No mapped model has a 0.5K tier since Nano Banana 2 → 2.1 (2026-10-07): 512 asks for 1K.
      const resolutionToSize = (res: number): string => {
        if (res === 4096) return '4K'
        if (res === 2048) return '2K'
        return '1K'
      }
      payload.generationConfig.imageConfig = {
        ...(request.aspectRatio && { aspectRatio: request.aspectRatio }),
        ...(request.resolution && { imageSize: resolutionToSize(request.resolution) }),
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
    const label = this.modelLabel
    const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1'
    console.log(`${label}: Using Vertex AI (region: ${location})`)
    
    try {
      await recordApiCall('gemini', getScopeForModel(this.config.id), 1)
    } catch (trackErr) {
      console.warn('[GeminiAdapter] Failed to track Vertex AI API call:', trackErr)
    }
    
    if (!vertexAiClient) {
      throw new Error('Vertex AI client not initialized')
    }
    
    try {
      const model = vertexAiClient.preview.getGenerativeModel({
        model: this.apiModelName,
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
      
      // Gemini 3 image models stream interim "thought" drafts before the final
      // render. Select the final image, not the first (hazy) draft.
      const imagePart = selectFinalImagePart(content.parts)

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
      
      if (error?.code === 404 || error?.status === 404 || errorMessage.includes('404') || errorMessage.includes('was not found')) {
        console.error(`[Vertex AI] ⚠️  Model not found (404) - ${this.apiModelName} may not be available via Vertex AI SDK yet`)
        console.error('[Vertex AI]   Falling back to Gemini API...')
        if (this.apiKey) {
          const endpoint = `${this.baseUrl}/models/${this.apiModelName}:generateContent`
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
      
      // On transient errors (502/503/504), propagate up to the retry loop
      // so it can retry with backoff and eventually fall back to Replicate.
      // Don't waste time trying the Gemini API REST fallback — when Google's
      // infrastructure is overloaded, both Vertex AI and AI Studio are affected.
      if (isTransientError(error)) {
        const transientErr: any = new Error(error.message || 'Service temporarily unavailable')
        transientErr.status = error?.status || 503
        transientErr.code = error?.code
        throw transientErr
      }
      
      if (this.apiKey) {
        console.log('Falling back to Gemini API due to Vertex AI error')
        const endpoint = `${this.baseUrl}/models/${this.apiModelName}:generateContent`
        try {
          return await this.generateImageGeminiAPI(endpoint, payload)
        } catch (fallbackError: any) {
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
    const label = this.modelLabel
    console.log(`${label}: Using Gemini API (AI Studio)`)
    
    try {
      await recordApiCall('gemini', getScopeForModel(this.config.id), 1)
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

    console.log(`${label}: Response status:`, response.status)

    if (!response.ok) {
      const error = await response.json()
      console.error('Gemini API error:', error)
      console.error('Request payload (redacted):', JSON.stringify(redactLargeStrings(payload), null, 2))
      
      checkGoogleRateLimit(error, 'gemini', getScopeForModel(this.config.id))
      
      // Create error object that includes details for quota detection
      const apiError: any = new Error(error.error?.message || 'Image generation failed')
      apiError.status = response.status
      apiError.code = error.error?.code
      apiError.error = error.error
      apiError.details = error.error?.details
      
      throw apiError
    }
    
    console.log(`${label}: Response OK, parsing data`)

    const data = await response.json()

    // Check for content safety blocks BEFORE looking for image data
    // Google can return 200 OK but with blocked content (no image)
    const contentBlock = parseGeminiContentBlock(data)
    if (contentBlock) {
      console.error(`${label}: Content blocked by safety filter:`, contentBlock)
      console.error(`${label}: Full response:`, JSON.stringify(redactLargeStrings(data), null, 2))
      throw new Error(contentBlock)
    }

    // Extract image from response.
    // Gemini 3 image models stream interim "thought" drafts before the final
    // render. Select the final image, not the first (hazy) draft.
    const imagePart = selectFinalImagePart(data.candidates?.[0]?.content?.parts)

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
  private async generateImageReplicate(
    request: GenerationRequest,
    routeReason = 'replicate_fallback'
  ): Promise<any> {
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
            _metrics: {
              predictTime: predictTime,
              provider: 'replicate',
            },
            _routeMeta: {
              backend: 'replicate',
              isFallback: true,
              routeReason,
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
    console.log(`[Omni Flash] Starting video generation for prompt: ${request.prompt.substring(0, 50)}...`)

    const duration = request.duration || 8
    const resolution = request.resolution || 720
    const aspectRatio = request.aspectRatio || '16:9'

    // Calculate dimensions based on aspect ratio and resolution
    // Omni Flash supports 360p, 720p, 1080p and 4K (2160), in 16:9 or 9:16
    const getDimensions = (aspectRatio: string, resolution: number) => {
      const [widthRatio, heightRatio] = aspectRatio.split(':').map(Number)
      if (aspectRatio === '16:9') {
        if (resolution === 2160) return { width: 3840, height: 2160 }
        if (resolution === 1080) return { width: 1920, height: 1080 }
        if (resolution === 360) return { width: 640, height: 360 }
        return { width: 1280, height: 720 }
      }
      if (aspectRatio === '9:16') {
        if (resolution === 2160) return { width: 2160, height: 3840 }
        if (resolution === 1080) return { width: 1080, height: 1920 }
        if (resolution === 360) return { width: 360, height: 640 }
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
    // TODO(omni-vertex): Gemini Omni Flash is documented on the Gemini API's Interactions
    // endpoint only; whether Vertex AI serves gemini-omni-1.1-flash is not confirmed
    // (2026-10-07). Video always went through the Gemini API key path, and still does.
    console.log(`[Omni Flash] Vertex AI configured, but Omni Flash is Gemini API (Interactions) only`)

    if (!this.apiKey) {
      throw new Error('Gemini Omni Flash needs GEMINI_API_KEY: it is not available through Vertex AI here.')
    }

    return await this.generateVideoGeminiAPI(request, options)
  }

  /**
   * Gemini Omni Flash (gemini-omni-1.1-flash) through the Interactions API, ported from Veo 3.1's
   * predictLongRunning (veo-3.1-generate-preview shuts down 2026-10-22).
   *
   * - Images then text: two images are the first and last frame; one is the start frame.
   * - There is no duration parameter (Veo's durationSeconds no longer exists): the length is
   *   said in the prompt, and Omni makes about 3 to 10 seconds.
   * - No negative prompt, seed, audio toggle or multiple videos per request. Veo's path sent
   *   none of them, so nothing is folded in.
   * - The video comes back inline as base64 when under 4 MB; 1080p and 4K ask for a Files URI
   *   instead, polled until ACTIVE and fetched later with the API key (provider-fetch.ts).
   *
   * UNVERIFIED by a live call: the request and response shapes follow Google's Omni page
   * (read 2026-10-07), including output_video and delivery: 'uri'.
   */
  private async generateVideoGeminiAPI(
    request: GenerationRequest,
    options: { width: number; height: number; duration: number; resolution: number; aspectRatio: string }
  ): Promise<GenerationResponse> {
    console.log(`[Omni Flash] Using Gemini API Interactions`)

    // Track API call for rate limiting
    try {
      await recordApiCall('gemini', 'gemini-veo-3.1', 1)
    } catch (trackErr) {
      console.warn('[GeminiAdapter] Failed to track Omni Flash API call:', trackErr)
    }

    const modelId = 'gemini-omni-1.1-flash'
    const endpoint = `${this.baseUrl}/interactions`

    const { width, height, duration } = options

    // Helper to parse image from base64 data URL or HTTP URL
    const parseImageInput = async (
      dataUrl: string | undefined,
      httpUrl: string | undefined,
      label: string
    ): Promise<{ bytes: Buffer; contentType: string } | null> => {
      // Handle base64 data URL directly
      if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
        console.log(`[Omni Flash] Using ${label} from base64 data URL`)
        // Use indexOf/slice instead of regex to avoid stack overflow on large strings
        const commaIndex = dataUrl.indexOf(',')
        if (commaIndex === -1) {
          console.warn(`[Omni Flash] Invalid base64 format for ${label}, ignoring`)
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
        console.log(`[Omni Flash] Downloading ${label} from URL: ${httpUrl.slice(0, 50)}...`)
        try {
          const imageResponse = await fetch(httpUrl)
          if (!imageResponse.ok) {
            throw new Error(`Failed to fetch ${label}: ${imageResponse.statusText}`)
          }
          const imageBuffer = await imageResponse.arrayBuffer()
          const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
          return { bytes: Buffer.from(imageBuffer), contentType }
        } catch (error: any) {
          console.error(`[Omni Flash] Failed to download ${label}:`, error)
          return null
        }
      }

      return null
    }

    // Start frame (reference image) - can be base64 (referenceImage) or URL (referenceImageUrl)
    const startFrame = await parseImageInput(
      request.referenceImage,
      (request as any).referenceImageUrl,
      'start frame'
    )

    if (!startFrame) {
      console.log(`[Omni Flash] No start frame provided, generating text-to-video`)
    }

    // End frame: with a start frame, two images then text is first/last frame interpolation
    const endFrame = await parseImageInput(
      (request.parameters as any)?.endFrameImage,
      (request.parameters as any)?.endFrameImageUrl,
      'end frame'
    )
    if (endFrame && !startFrame) {
      // One image alone would read as a start frame or a subject reference, not an end frame.
      console.warn('[Omni Flash] End frame given without a start frame, ignoring it')
    }

    // No duration parameter on Omni: say the length in the prompt.
    const prompt = `${request.prompt.trim()}\n\nLength: about ${duration} seconds.`

    const images = startFrame ? [startFrame, ...(endFrame ? [endFrame] : [])] : []
    const input: any = images.length === 0
      ? prompt
      : [
          ...images.map((img) => ({ type: 'image', data: img.bytes.toString('base64'), mime_type: img.contentType })),
          { type: 'text', text: prompt },
        ]

    const resolutionLabel =
      options.resolution === 2160 ? '4k' : options.resolution === 1080 ? '1080p' : options.resolution === 360 ? '360p' : '720p'
    // Inline output is capped at 4 MB; 1080p and 4K ask for a file instead.
    const deliverByUri = options.resolution >= 1080

    const payload: any = {
      model: modelId,
      input,
      response_format: {
        type: 'video',
        aspect_ratio: options.aspectRatio,
        resolution: resolutionLabel,
        ...(deliverByUri ? { delivery: 'uri' } : {}),
      },
    }

    try {
      console.log(`[Omni Flash] Calling Interactions with ~${duration}s video, ${resolutionLabel}, ${options.aspectRatio}`, {
        mode: startFrame && endFrame ? 'frame-interpolation' : startFrame ? 'image-to-video' : 'text-to-video',
      })
      console.log(`[Omni Flash] Payload (redacted):`, JSON.stringify(redactLargeStrings(payload), null, 2))

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        checkGoogleRateLimit(errorData, 'gemini', 'gemini-veo-3.1')
        throw new Error(errorData.error?.message || `Video generation request failed (${response.status})`)
      }

      const interaction = await response.json()
      const interactionId = interaction.id ?? interaction.name ?? null
      const video = interaction.output_video ?? interaction.outputVideo

      let url: string | null = null
      if (video?.data) {
        url = `data:${video.mime_type || video.mimeType || 'video/mp4'};base64,${video.data}`
      } else if (video?.uri) {
        url = await this.waitForGeminiFile(video.uri)
      }

      if (!url) {
        console.error('[Omni Flash] Response has no video:', JSON.stringify(redactLargeStrings(interaction), null, 2))
        throw new Error('No video in response. The generation may have been blocked by Google content safety, or returned no output. Try again or rephrase.')
      }

      console.log('[Omni Flash] Video ready', {
        interactionId,
        delivery: video?.data ? 'inline' : 'uri',
        startFrameAttached: Boolean(startFrame),
        endFrameAttached: Boolean(startFrame && endFrame),
      })

      // A data URL is stored by the processor; a Files URI is downloaded by it with the API key.
      return {
        id: `gen-${Date.now()}`,
        status: 'completed',
        outputs: [
          {
            url,
            width,
            height,
            duration,
          },
        ],
        metadata: {
          model: this.config.id,
          prompt: request.prompt,
          apiModel: modelId,
          interactionId,
        },
      }
    } catch (error: any) {
      console.error('[Omni Flash] Generation error:', error)
      throw new Error(error.message || 'Video generation failed')
    }
  }

  /** Poll a Gemini Files URI until the file is ACTIVE (max 5 minutes), and return its download URL. */
  private async waitForGeminiFile(uri: string): Promise<string> {
    const match = uri.match(/files\/[^/:?]+/)
    if (!match) return uri
    const fileName = match[0]
    const maxAttempts = 30 // 5 minutes at 10s intervals
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(`${this.baseUrl}/${fileName}`, { headers: { 'x-goog-api-key': this.apiKey } })
      if (!res.ok) throw new Error(`Failed to check video file status (${res.status})`)
      const file = await res.json()
      if (file.state === 'ACTIVE') {
        return file.downloadUri || `${this.baseUrl}/${fileName}:download?alt=media`
      }
      if (file.state === 'FAILED') throw new Error('Video file processing failed on Google\'s side. Try again.')
      await new Promise(resolve => setTimeout(resolve, 10000))
    }
    throw new Error('Video generation timeout - please try again or contact support')
  }
}

/**
 * Maps internal model IDs to the Gemini API model name used in endpoints.
 * Nano Banana Pro → gemini-3-pro-image (GA; the -preview id shut down 2026-06-25)
 * 'gemini-nano-banana-2' → gemini-nano-banana-2.1 (since 2026-10-07; the internal id is a
 *   stored key on generations and settings, so it keeps its name)
 */
const GEMINI_API_MODEL_MAP: Record<string, string> = {
  'gemini-nano-banana-pro': 'gemini-3-pro-image',
  'gemini-nano-banana-2': 'gemini-nano-banana-2.1',
}

// Model configurations based on official Gemini API docs
// https://ai.google.dev/gemini-api/docs/image-generation
export const NANO_BANANA_CONFIG: ModelConfig = {
  id: 'gemini-nano-banana-pro',
  name: 'Nano Banana Pro',
  provider: 'Google',
  type: 'image',
  description: 'Gemini 3 Pro Image - Advanced image generation with superior quality',
  maxResolution: 4096,
  defaultAspectRatio: '1:1',
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  capabilities: {
    editing: true,
    'text-2-image': true,
    multiImageEditing: true,
    maxReferenceImages: 14,
  },
  // Google's price, see src/lib/models/pricing.ts (was $0.01, about 13x low).
  pricing: {
    perImage: GEMINI_IMAGE_PRICES_USD['gemini-nano-banana-pro'][1024],
    perImageByResolution: GEMINI_IMAGE_PRICES_USD['gemini-nano-banana-pro'],
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

export const NANO_BANANA_2_CONFIG: ModelConfig = {
  id: 'gemini-nano-banana-2',
  name: 'Nano Banana 2.1',
  provider: 'Google',
  type: 'image',
  description: 'Nano Banana 2.1 - Fast, high-efficiency image generation, Google\'s successor to Nano Banana 2',
  maxResolution: 4096,
  defaultAspectRatio: '1:1',
  // 2.1 lists no 1:4, 4:1, 1:8 or 8:1 (Nano Banana 2 had them).
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  capabilities: {
    editing: true,
    'text-2-image': true,
    multiImageEditing: true,
    maxReferenceImages: 14,
  },
  // Google's price for 2.1, see src/lib/models/pricing.ts.
  pricing: {
    perImage: GEMINI_IMAGE_PRICES_USD['gemini-nano-banana-2'][1024],
    perImageByResolution: GEMINI_IMAGE_PRICES_USD['gemini-nano-banana-2'],
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

// Gemini Omni Flash (gemini-omni-1.1-flash) since 2026-10-07, replacing Veo 3.1 preview
// (shut down 2026-10-22). The id and the export keep Veo's name: 'gemini-veo-3.1' is a stored
// key on generations, settings and rate-limit rows.
// https://ai.google.dev/gemini-api/docs/omni
export const VEO_3_1_CONFIG: ModelConfig = {
  id: 'gemini-veo-3.1',
  name: 'Gemini Omni Flash',
  provider: 'Google',
  type: 'video',
  description: 'Gemini Omni Flash - video from text, a start frame, or first and last frames',
  defaultAspectRatio: '16:9',
  // Omni Flash supports 16:9 and 9:16 only
  supportedAspectRatios: ['16:9', '9:16'],
  maxResolution: 2160, // 4K support
  capabilities: {
    'text-2-video': true,
    'image-2-video': true,
    'frame-interpolation': true, // Supports first + last frame interpolation
  },
  // About $0.10 a second at 720p (Google's pricing page, read 2026-10-07)
  pricing: {
    perSecond: 0.1,
    currency: 'USD',
  },
  parameters: [
    {
      name: 'resolution',
      type: 'select',
      label: 'Resolution',
      default: 720,
      options: [
        { label: '360p', value: 360 },
        { label: '720p', value: 720 },
        { label: '1080p', value: 1080 },
        { label: '4K', value: 2160 },
      ],
    },
    {
      // Not an API parameter on Omni: said in the prompt (about 3 to 10 seconds)
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

