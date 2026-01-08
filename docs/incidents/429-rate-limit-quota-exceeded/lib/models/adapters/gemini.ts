import { BaseModelAdapter, GenerationRequest, GenerationResponse, ModelConfig } from '../base'

/**
 * Google Gemini/Vertex AI Adapter
 * Supports Gemini 3 Pro Image (Nano banana pro) and Veo 3.1
 * Uses Gen AI SDK with Vertex AI when credentials are available (better rate limits), falls back to Gemini API
 */

let genAiClient: any = null

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

// Try to initialize Gen AI SDK client with Vertex AI (server-side only)
if (typeof window === 'undefined') {
  try {
    const { GoogleGenAI } = require('@google/genai')
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID
    const location = process.env.GOOGLE_CLOUD_REGION || 'us-central1'
    
    // Check if we have credentials (either via file path or JSON string for Vercel)
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
    
    if (projectId && (credentialsPath || credentialsJson)) {
      // Handle credentials for Gen AI SDK
      // The SDK uses Application Default Credentials, which can be:
      // 1. A file path in GOOGLE_APPLICATION_CREDENTIALS env var
      // 2. Credentials set via google-auth-library
      
      if (credentialsPath) {
        // Use file path (local development)
        // Ensure the env var is set for the SDK to pick up
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath
        }
      } else if (credentialsJson) {
        // For Vercel/serverless: write credentials to a temp file
        // The Gen AI SDK needs GOOGLE_APPLICATION_CREDENTIALS to point to a file
        try {
          const tempDir = os.tmpdir()
          const tempFilePath = path.join(tempDir, `gcp-credentials-${Date.now()}.json`)
          fs.writeFileSync(tempFilePath, credentialsJson, 'utf8')
          process.env.GOOGLE_APPLICATION_CREDENTIALS = tempFilePath
          console.log(`[Gen AI SDK] Wrote credentials to temp file: ${tempFilePath}`)
        } catch (e) {
          console.warn('[Gen AI SDK] Failed to write credentials to temp file:', e)
        }
      }
      
      // Initialize Gen AI SDK with Vertex AI
      // The SDK will automatically use Application Default Credentials from GOOGLE_APPLICATION_CREDENTIALS
      // Note: Preview models (like gemini-3-pro-image-preview) may require location: 'global'
      // If you get 404 "model not found" errors with Vertex AI, try setting GOOGLE_CLOUD_REGION=global
      // The system will automatically fall back to Gemini API if Vertex AI fails
      genAiClient = new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location,
      })
      
      console.log(`[Gen AI SDK] Initialized with Vertex AI for project: ${projectId}, location: ${location}`)
    }
  } catch (error) {
    // Gen AI SDK not available or not configured - will fall back to Gemini API
    console.log('[Gen AI SDK] Not configured, will use Gemini API:', error)
  }
}

export class GeminiAdapter extends BaseModelAdapter {
  private apiKey: string
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta'
  private useGenAI: boolean

  constructor(config: ModelConfig) {
    super(config)
    this.apiKey = process.env.GEMINI_API_KEY || ''
    this.useGenAI = genAiClient !== null

    if (!this.useGenAI && !this.apiKey) {
      console.warn('Neither Gen AI SDK (Vertex AI) nor Gemini API key configured')
    } else if (this.useGenAI) {
      console.log('[GeminiAdapter] Using Gen AI SDK with Vertex AI (better rate limits)')
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
    
    // Generate multiple images by making multiple requests
    const promises = Array.from({ length: numImages }, () =>
      this.generateSingleImage(endpoint, request)
    )

    const results = await Promise.allSettled(promises)
    
    const outputs = results
      .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
      .map(result => result.value)

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
          role: 'user', // Required by Vertex AI API
          parts,
        },
      ],
      generationConfig: {
        responseModalities: ['image'],
        temperature: 1.0,
      },
    }

    // Add aspect ratio configuration if provided
    if (request.aspectRatio) {
      payload.generationConfig.imageConfig = {
        aspectRatio: request.aspectRatio,
      }
    }

    // Use Gen AI SDK (Vertex AI) if available, otherwise fall back to Gemini API
    if (this.useGenAI && genAiClient) {
      return await this.generateImageGenAI(request, payload)
    } else {
      return await this.generateImageGeminiAPI(endpoint, payload)
    }
  }

  private async generateImageGenAI(request: GenerationRequest, payload: any): Promise<any> {
    console.log('Nano banana pro: Using Gen AI SDK with Vertex AI')
    
    if (!genAiClient) {
      throw new Error('Gen AI client not initialized')
    }
    
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/models/adapters/gemini.ts:generateImageGenAI',message:'genai client surface',data:{clientKeys:Object.keys(genAiClient||{}).slice(0,30),modelsType:typeof genAiClient?.models,modelsKeys:genAiClient?.models?Object.keys(genAiClient.models).slice(0,30):[],hasModelsGetGenerativeModel:typeof genAiClient?.models?.getGenerativeModel==='function',hasModelsGenerateContent:typeof genAiClient?.models?.generateContent==='function',hasModelsGenerateContentStream:typeof genAiClient?.models?.generateContentStream==='function',hasClientGetGenerativeModel:typeof genAiClient?.getGenerativeModel==='function'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      let model: any
      let result: any
      let selectedMethod:
        | 'models.generateContent'
        | 'models.getGenerativeModel'
        | 'client.getGenerativeModel'
        | 'none' = 'none'

      // Prefer @google/genai modern API: models.generateContent({ model, contents, config })
      if (genAiClient.models && typeof genAiClient.models.generateContent === 'function') {
        selectedMethod = 'models.generateContent'

        const gc = payload.generationConfig || {}
        const config: any = {
          ...(typeof gc.temperature === 'number' ? { temperature: gc.temperature } : {}),
          ...(gc.imageConfig ? { imageConfig: gc.imageConfig } : {}),
        }

        // Normalize responseModalities to uppercase (SDK examples use "IMAGE"/"TEXT")
        if (Array.isArray(gc.responseModalities)) {
          config.responseModalities = gc.responseModalities.map((m: any) =>
            typeof m === 'string' ? m.toUpperCase() : m
          )
        }

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H4',location:'lib/models/adapters/gemini.ts:generateImageGenAI',message:'using models.generateContent',data:{hasConfig:Boolean(Object.keys(config||{}).length),configKeys:Object.keys(config||{}),responseModalities:config.responseModalities},timestamp:Date.now()})}).catch(()=>{});
        // #endregion

        result = await genAiClient.models.generateContent({
          model: 'gemini-3-pro-image-preview',
          contents: payload.contents,
          config,
        })
      } else {
        // Legacy pattern: models.getGenerativeModel() -> model.generateContent()

        // Check if it's genAiClient.models.getGenerativeModel (older pattern)
        if (genAiClient.models && typeof genAiClient.models.getGenerativeModel === 'function') {
          selectedMethod = 'models.getGenerativeModel'
          model = genAiClient.models.getGenerativeModel({
            model: 'gemini-3-pro-image-preview',
          })
        }
        // Fallback: try direct getGenerativeModel (for backward compatibility)
        else if (typeof genAiClient.getGenerativeModel === 'function') {
          selectedMethod = 'client.getGenerativeModel'
          model = genAiClient.getGenerativeModel({
            model: 'gemini-3-pro-image-preview',
          })
        }
        // If neither works, log available methods and throw
        else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/models/adapters/gemini.ts:generateImageGenAI',message:'genai model getter missing',data:{selectedMethod,clientKeys:Object.keys(genAiClient||{}).slice(0,30),modelsKeys:genAiClient?.models?Object.keys(genAiClient.models).slice(0,30):[]},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          console.error('[Gen AI SDK] Available methods:', Object.keys(genAiClient))
          console.error('[Gen AI SDK] Available model methods:', genAiClient?.models ? Object.keys(genAiClient.models) : [])
          throw new Error('Gen AI SDK getGenerativeModel method not found. Client structure: ' + JSON.stringify(Object.keys(genAiClient)))
        }
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H3',location:'lib/models/adapters/gemini.ts:generateImageGenAI',message:'genai method selected',data:{selectedMethod},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (!result) {
        result = await model.generateContent({
          contents: payload.contents,
          generationConfig: payload.generationConfig,
        })
      }

      // Extract image from response
      // @google/genai SDK response structure can vary:
      // - result.response.candidates (if wrapped)
      // - result.candidates (if direct)
      // - result.text (for text responses)
      let response: any = result
      
      // Check if response is wrapped
      if (result.response) {
        response = result.response
      }
      
      // Handle different response structures
      const candidates = response.candidates || (response.candidate ? [response.candidate] : [])
      if (candidates.length === 0) {
        console.error('Gen AI SDK response missing candidates:', JSON.stringify(result, null, 2))
        throw new Error('No candidates in response')
      }
      
      const content = candidates[0]?.content
      if (!content || !content.parts) {
        console.error('Gen AI SDK response missing content parts:', JSON.stringify(result, null, 2))
        throw new Error('No content parts in response')
      }
      
      const imagePart = content.parts.find(
        (part: any) => part.inlineData?.mimeType?.startsWith('image/')
      )

      if (!imagePart?.inlineData?.data) {
        console.error('Gen AI SDK response missing image data:', JSON.stringify(result, null, 2))
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
      console.error('Gen AI SDK error:', error)
      // Fallback to Gemini API if Gen AI SDK fails
      if (this.apiKey) {
        console.log('Falling back to Gemini API due to Gen AI SDK error')
        const endpoint = `${this.baseUrl}/models/gemini-3-pro-image-preview:generateContent`
        return await this.generateImageGeminiAPI(endpoint, payload)
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
      throw new Error(error.error?.message || 'Image generation failed')
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
    
    // Use Gen AI SDK if available (Vertex AI), otherwise fall back to Gemini API REST
    if (this.useGenAI && genAiClient) {
      return await this.generateVideoGenAI(request, { width, height, duration, resolution, aspectRatio })
    } else {
      return await this.generateVideoGeminiAPI(request, { width, height, duration, resolution, aspectRatio })
    }
  }
  
  private async generateVideoGenAI(
    request: GenerationRequest,
    options: { width: number; height: number; duration: number; resolution: number; aspectRatio: string }
  ): Promise<GenerationResponse> {
    console.log(`[Veo 3.1] Gen AI SDK with Vertex AI available, but video generation methods not yet in SDK`)
    console.log(`[Veo 3.1] Falling back to Gemini API REST (works great, maintains functionality)`)
    
    if (!genAiClient) {
      throw new Error('Gen AI client not initialized')
    }
    
    // Note: The Gen AI SDK JavaScript version may not have video generation methods yet
    // When the SDK adds video support, this method will be updated to use SDK methods
    // For now, we maintain the working Gemini API REST implementation
    // This ensures videos continue to work while we wait for SDK video support
    
    try {
      // TODO: When Gen AI SDK adds video generation support, implement here:
      // const model = genAiClient.getGenerativeModel({ model: 'veo-3.1-generate-preview' })
      // const operation = await model.generateVideos({ ... })
      // Then poll and return result
      
      // For now, use the proven Gemini API REST implementation
      return await this.generateVideoGeminiAPI(request, options)
      
    } catch (error: any) {
      console.error('[Veo 3.1] Gen AI SDK error:', error)
      // Fallback to Gemini API REST if Gen AI SDK fails
      if (this.apiKey) {
        console.log('Falling back to Gemini API REST due to Gen AI SDK error')
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
        { label: '2 images', value: 2 },
        { label: '4 images', value: 4 },
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

