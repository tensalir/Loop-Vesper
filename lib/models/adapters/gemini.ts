import { BaseModelAdapter, GenerationRequest, GenerationResponse, ModelConfig } from '../base'

/**
 * Google Gemini API Adapter
 * Supports Gemini 3 Pro Image (Nano banana pro) and Veo 3.1
 */

export class GeminiAdapter extends BaseModelAdapter {
  private apiKey: string
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  constructor(config: ModelConfig) {
    super(config)
    this.apiKey = process.env.GEMINI_API_KEY || ''

    if (!this.apiKey) {
      console.warn('Gemini API key not configured')
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
    console.log('Nano banana pro: Has reference image:', !!request.referenceImage)
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
    
    // Add reference image if provided (for image editing)
    if (request.referenceImage) {
      // Extract base64 data and mime type from data URL
      const dataUrlMatch = request.referenceImage.match(/^data:([^;]+);base64,(.+)$/)
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

    // Add aspect ratio configuration if provided
    if (request.aspectRatio) {
      payload.generationConfig.imageConfig = {
        aspectRatio: request.aspectRatio,
      }
    }

    console.log('Nano banana pro: Sending request to Gemini API')
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
      console.error('Request payload:', JSON.stringify(payload, null, 2))
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

    const dimensions = aspectRatioDimensions[request.aspectRatio || '1:1'] || { width: 1024, height: 1024 }

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
    
    // Using Veo 3.1 official API endpoint
    const modelId = 'veo-3.1-generate-preview'
    const endpoint = `${this.baseUrl}/models/${modelId}:predictLongRunning`
    
    // Build request payload according to Veo 3.1 API
    // Veo 3.1 supports image-to-video: https://ai.google.dev/gemini-api/docs/video
    // Images must be uploaded via Google Files API first
    const instance: any = {
      prompt: request.prompt,
    }

    // Check for reference image - can be base64 (referenceImage) or URL (referenceImageUrl)
    let imageBytes: Buffer | null = null
    let contentType: string = 'image/jpeg'
    let uploadedReferenceMeta: { name: string; contentType: string; byteLength: number } | null = null
    
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
    }

    // Upload image to Google Files API if we have image data
    if (imageBytes) {
      try {
        console.log(`[Veo 3.1] Uploading reference image to Google Files API (${contentType}, ${imageBytes.length} bytes)`)
        
        // Generate a boundary for multipart data
        const boundary = `----boundary${Date.now()}`
        const fileExtension = contentType.includes('png') ? 'png' : 'jpg'
        const filename = `reference.${fileExtension}`
        
        // Build multipart/form-data body manually for Node.js compatibility
        const parts: Buffer[] = []
        
        // Add boundary and headers for the file part
        parts.push(Buffer.from(`--${boundary}\r\n`))
        parts.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`))
        parts.push(Buffer.from(`Content-Type: ${contentType}\r\n\r\n`))
        
        // Add the file content
        parts.push(imageBytes)
        
        // Add closing boundary
        parts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
        
        // Combine all parts
        const multipartBody = Buffer.concat(parts)
        
        // Upload to Google Files API - note the /upload/ path prefix for file uploads
        const uploadUrl = this.baseUrl.replace('/v1beta', '/upload/v1beta') + '/files'
        console.log(`[Veo 3.1] Uploading to: ${uploadUrl}`)
        
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'x-goog-api-key': this.apiKey,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: multipartBody,
        })
        
        console.log(`[Veo 3.1] Files API response status: ${uploadResponse.status} ${uploadResponse.statusText}`)
        
        // Get response text first to debug
        const responseText = await uploadResponse.text()
        console.log(`[Veo 3.1] Files API raw response:`, responseText)
        
        if (!uploadResponse.ok) {
          console.error(`[Veo 3.1] Files API upload failed (${uploadResponse.status}):`, responseText)
          throw new Error(`Files API upload failed: ${uploadResponse.status} ${responseText}`)
        }
        
        // Parse JSON response
        let fileData
        try {
          fileData = JSON.parse(responseText)
        } catch (e) {
          console.error(`[Veo 3.1] Failed to parse Files API response as JSON:`, responseText)
          throw new Error(`Invalid JSON response from Files API: ${responseText}`)
        }
        
        console.log(`[Veo 3.1] Files API upload response:`, JSON.stringify(fileData, null, 2))
        
        // Extract file resource name - format should be "files/abc123"
        // According to Gemini API docs, the response has a `file` object with a `name` field
        const fileResourceName = fileData.file?.name || fileData.name
        const fileUri = fileData.file?.uri
        
        if (!fileResourceName) {
          console.error(`[Veo 3.1] Unexpected Files API response structure:`, fileData)
          throw new Error(`No file name returned from Files API. Response: ${JSON.stringify(fileData)}`)
        }
        
        uploadedReferenceMeta = {
          name: fileResourceName,
          contentType,
          byteLength: imageBytes.length,
        }
        console.log(`[Veo 3.1] Reference image uploaded`, uploadedReferenceMeta)
        
        // Try different formats - VEO 3.1 API format is unclear from docs
        // Option 1: Use full resource name "files/abc123"
        // Option 2: Use just file ID "abc123"  
        // Option 3: Use full URI
        // Let's try the full resource name first (most common in Gemini API)
        instance.image = fileResourceName
        console.log(`[Veo 3.1] Using file resource name for image: ${fileResourceName}`)
        if (fileUri) {
          console.log(`[Veo 3.1] File URI also available: ${fileUri}`)
        }
      } catch (error: any) {
        console.error('[Veo 3.1] Error uploading reference image:', error)
        console.error('[Veo 3.1] Error details:', {
          message: error.message,
          stack: error.stack,
        })
        throw new Error(error.message || 'Failed to upload reference image to Google Files API')
      }
    } else {
      console.log(`[Veo 3.1] No reference image provided, generating text-to-video`)
    }
    
    if (imageBytes && !instance.image) {
      throw new Error('[Veo 3.1] Reference image upload failed - no file resource returned')
    }
    
    // Build clean instance object - only include prompt and image if provided
    // According to docs: https://ai.google.dev/gemini-api/docs/video
    const cleanInstance: any = {
      prompt: instance.prompt,
    }
    
    // Only add image field if we actually have an uploaded image
    if (instance.image) {
      cleanInstance.image = instance.image
    }
    
    const payload = {
      instances: [cleanInstance],
    }
    
    console.log(`[Veo 3.1] Calling API with ${duration}s video, ${width}x${height}, ${aspectRatio}`)
    console.log(`[Veo 3.1] Payload:`, JSON.stringify(payload, null, 2))
    
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
        referenceImageAttached: Boolean(instance.image),
        referenceMetadata: uploadedReferenceMeta,
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
            referenceImageAttached: Boolean(instance.image),
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
export const VEO_3_1_CONFIG: ModelConfig = {
  id: 'gemini-veo-3.1',
  name: 'Veo 3.1',
  provider: 'Google',
  type: 'video',
  description: 'State-of-the-art video generation with native audio support',
  defaultAspectRatio: '16:9',
  supportedAspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  maxResolution: 1080,
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

