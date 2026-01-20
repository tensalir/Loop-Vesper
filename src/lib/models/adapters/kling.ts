import { BaseModelAdapter, ModelConfig, GenerationRequest, GenerationResponse } from '../base'
import { recordApiCall } from '@/lib/rate-limits/usage'
import * as jwt from 'jsonwebtoken'

// Kling API credentials from environment
const KLING_ACCESS_KEY = typeof window === 'undefined' ? process.env.KLING_ACCESS_KEY : null
const KLING_SECRET_KEY = typeof window === 'undefined' ? process.env.KLING_SECRET_KEY : null

if (typeof window === 'undefined' && (!KLING_ACCESS_KEY || !KLING_SECRET_KEY)) {
  console.warn('KLING_ACCESS_KEY and KLING_SECRET_KEY are not set. Official Kling API will not work.')
}

/**
 * Generate JWT token for Kling API authentication
 * The token is valid for 30 minutes
 */
function generateKlingJWT(
  secretOverride?: jwt.Secret,
  debugMeta?: { usingDecodedSecret?: boolean }
): string {
  if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
    throw new Error('Kling API credentials not configured')
  }

  const signingSecret = secretOverride ?? KLING_SECRET_KEY
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: KLING_ACCESS_KEY,
    exp: now + 1800, // 30 minutes
    nbf: now - 5, // 5 seconds grace period
  }

  const token = jwt.sign(payload, signingSecret, {
    algorithm: 'HS256',
    header: {
      alg: 'HS256',
      typ: 'JWT',
    },
  })

  const decoded = jwt.decode(token, { complete: true }) as
    | { header?: Record<string, any>; payload?: Record<string, any> }
    | null

  return token
}

/**
 * Kling 2.6 Model Configuration (Official API)
 * Latest Kling with native audio generation and frame interpolation
 * Documentation: https://app.klingai.com/global/dev/document-api
 */
export const KLING_OFFICIAL_CONFIG: ModelConfig = {
  id: 'kling-official',
  name: 'Kling 2.6',
  provider: 'Kuaishou (Official)',
  type: 'video',
  description: 'Official Kling 2.6 API with native audio generation and start/end frame interpolation',
  supportedAspectRatios: ['16:9', '9:16', '1:1'],
  defaultAspectRatio: '16:9',
  maxResolution: 1080,
  capabilities: {
    'text-2-video': true,
    'image-2-video': true,
    'frame-interpolation': true, // Native support for start + end frame
    audioGeneration: true, // Kling 2.6 has native audio generation
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
      name: 'mode',
      type: 'select',
      label: 'Quality Mode',
      default: 'pro',
      options: [
        { label: 'Standard', value: 'std' },
        { label: 'Professional', value: 'pro' },
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
      options: [{ label: '1', value: 1 }],
    },
  ],
}

/**
 * Official Kling API Adapter
 * Handles video generation via the official Kuaishou Kling API
 * Supports native frame-to-frame interpolation with start and end images
 */
export class KlingOfficialAdapter extends BaseModelAdapter {
  private baseUrl = 'https://api.klingai.com/v1'

  constructor(config: ModelConfig) {
    super(config)
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    this.validateRequest(request)

    try {
      return await this.generateVideo(request)
    } catch (error: any) {
      return {
        id: `error-${Date.now()}`,
        status: 'failed',
        error: error.message || 'Generation failed',
      }
    }
  }

  private async generateVideo(request: GenerationRequest): Promise<GenerationResponse> {
    if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
      throw new Error(
        'KLING_ACCESS_KEY and KLING_SECRET_KEY are not configured. ' +
        'Please add your Kling API credentials to .env.local. ' +
        'Get your keys from: https://app.klingai.com/global/dev/document-api'
      )
    }

    const {
      prompt,
      parameters = {},
      referenceImage,
      referenceImageUrl,
    } = request

    // Get parameters with safe fallbacks
    const aspectRatio = parameters?.aspectRatio || request.aspectRatio || '16:9'
    const duration = parameters?.duration || 5
    const mode = parameters?.mode || 'pro'
    const generateAudio = parameters?.generateAudio !== false // Default true for Kling 2.6
    const negativePrompt = parameters?.negativePrompt
    const cfgScale = parameters?.cfgScale || 0.5

    // Build the request body for image2video
    const input: Record<string, any> = {
      // NOTE: Official docs use hyphenated version names (e.g. "kling-v2-6"), not dotted (e.g. "kling-v2.6").
      // Source: https://app.klingai.com/global/dev/document-api/apiReference/model/imageToVideo
      model_name: 'kling-v2-6', // Kling 2.6
      mode,
      prompt,
      cfg_scale: cfgScale,
      aspect_ratio: aspectRatio,
      duration: String(duration), // API expects string
    }

    // Add negative prompt if provided
    if (negativePrompt) {
      input.negative_prompt = negativePrompt
    }

    // Kling 2.6 native audio generation: `sound` enum on/off (only v2.6+ supports this)
    // Docs label appears as "sound" with enum "on/off".
    input.sound = generateAudio ? 'on' : 'off'

    const normalizeKlingImageInput = (value: string): string => {
      // Kling docs accept either:
      // - raw base64 string (no data: prefix)
      // - image URL (http/https)
      // They do NOT reliably accept full data URLs (data:image/...;base64,...).
      if (value.startsWith('data:')) {
        const commaIndex = value.indexOf(',')
        return commaIndex === -1 ? value : value.slice(commaIndex + 1)
      }
      return value
    }

    // Get start frame image (reference image)
    // Prefer URL if available; fallback to raw base64 (no data URL prefix).
    let startImage: string | null = null
    if (referenceImageUrl && typeof referenceImageUrl === 'string' && referenceImageUrl.startsWith('http')) {
      startImage = referenceImageUrl
      console.log('[Kling-Official] Using referenceImageUrl for start frame:', referenceImageUrl.substring(0, 50))
    } else if (referenceImage && typeof referenceImage === 'string' && referenceImage.length > 0) {
      startImage = normalizeKlingImageInput(referenceImage)
      console.log('[Kling-Official] Using referenceImage for start frame')
    } else if (request.referenceImages && Array.isArray(request.referenceImages) && request.referenceImages.length > 0) {
      startImage = normalizeKlingImageInput(request.referenceImages[0])
      console.log('[Kling-Official] Using first referenceImages entry for start frame')
    }

    if (startImage) {
      input.image = startImage
      console.log('[Kling-Official] ✅ Image-to-video mode with start frame')
    } else {
      console.log('[Kling-Official] Text-to-video mode (no start image)')
    }

    // Get end frame image for frame-to-frame interpolation
    // The official Kling API uses `image_tail` for the end frame
    const endFrameImageUrl = parameters?.endFrameImageUrl
    if (endFrameImageUrl && typeof endFrameImageUrl === 'string') {
      input.image_tail = normalizeKlingImageInput(endFrameImageUrl)
      // Kling API limitation: some model/mode/duration combos do not support image_tail when sound is on.
      // We have runtime evidence this fails for kling-v2-6/pro/5 with sound=on.
      if (input.sound === 'on') {
        input.sound = 'off'
        console.log('[Kling-Official] Disabled sound for frame interpolation (API limitation)')
      }
      console.log('[Kling-Official] ✅ Frame interpolation enabled with end frame (image_tail)')
    }

    console.log('[Kling-Official] Submitting video generation:', {
      ...input,
      image: startImage ? '[START_IMAGE]' : undefined,
      image_tail: endFrameImageUrl ? '[END_IMAGE]' : undefined,
    })

    // Generate JWT token for authentication
    const token = generateKlingJWT()

    // Track API call for rate limiting
    try {
      await recordApiCall('kling', 'kling-official', 1)
    } catch (trackErr) {
      console.warn('[Kling-Official] Failed to track API call:', trackErr)
    }

    // Submit the video generation task
    let response: Response | null = null
    let submitErrorMessage: string | null = null

    // Kling official API has shown intermittent 401 "Authorization signature is invalid".
    // We retry a couple times with freshly generated JWTs before failing the generation.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const attemptToken = attempt === 1 ? token : generateKlingJWT()

      response = await fetch(`${this.baseUrl}/videos/image2video`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${attemptToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      })

      if (response.ok) {
        submitErrorMessage = null
        break
      }

      let errorMessage = 'Kling API request failed'
      let raw: any = null
      try {
        const errorData = await response.json()
        raw = errorData
        errorMessage = errorData.message || errorData.error || JSON.stringify(errorData)
      } catch {
        const errorText = await response.text()
        raw = errorText
        errorMessage = errorText || `HTTP ${response.status}: ${response.statusText}`
      }

      submitErrorMessage = errorMessage
      console.error('[Kling-Official] API error:', errorMessage)
      const submitDateHeader = response.headers.get('date')
      const submitServerMs = submitDateHeader ? Date.parse(submitDateHeader) : NaN
      const submitSkewMs = Number.isFinite(submitServerMs) ? submitServerMs - Date.now() : null
      const shouldRetry =
        response.status === 401 &&
        typeof errorMessage === 'string' &&
        errorMessage.toLowerCase().includes('signature')

      if (!shouldRetry || attempt === 3) {
        throw new Error(errorMessage)
      }
    }

    if (!response) {
      throw new Error(submitErrorMessage || 'Kling API request failed')
    }

    const data = await response.json()
    
    // Check for API-level errors
    if (data.code !== 0) {
      throw new Error(data.message || `API error code: ${data.code}`)
    }

    const taskId = data.data?.task_id
    if (!taskId) {
      throw new Error('No task_id returned from Kling API')
    }

    console.log('[Kling-Official] Task submitted:', taskId)

    const taskUrl =
      typeof (data as any)?.data?.task_url === 'string'
        ? (data as any)?.data?.task_url
        : typeof (data as any)?.data?.taskUrl === 'string'
          ? (data as any)?.data?.taskUrl
          : null
    const taskInfo = (data as any)?.data?.task_info

    // Poll for results
    let attempts = 0
    let signatureFailures = 0
    const maxAttempts = 180 // 15 minutes max (video generation takes time)
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

      // Regenerate token for each poll (in case of long waits)
      const pollToken = generateKlingJWT()

      const statusEndpoint = `${this.baseUrl}/videos/image2video?task_id=${taskId}`
      let statusResponse = await fetch(statusEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${pollToken}`,
        },
      })

      if (!statusResponse.ok) {
        let errorMessage = `Failed to check task status (${statusResponse.status})`
        const statusDateHeader = statusResponse.headers.get('date')
        const statusServerMs = statusDateHeader ? Date.parse(statusDateHeader) : NaN
        const statusSkewMs = Number.isFinite(statusServerMs) ? statusServerMs - Date.now() : null
        try {
          const errorData = await statusResponse.json()
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch {
          errorMessage = `${statusResponse.status}: ${statusResponse.statusText}`
        }

        if (
          statusResponse.status === 401 &&
          typeof errorMessage === 'string' &&
          errorMessage.toLowerCase().includes('signature') &&
          typeof KLING_SECRET_KEY === 'string' &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(KLING_SECRET_KEY) &&
          KLING_SECRET_KEY.length % 4 === 0
        ) {
          try {
            const decodedSecret = Buffer.from(KLING_SECRET_KEY, 'base64')
            const altToken = generateKlingJWT(decodedSecret, { usingDecodedSecret: true })
            const altResponse = await fetch(statusEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${altToken}`,
              },
            })
          } catch (_) {
            // noop
          }
        }

        if (
          statusResponse.status === 401 &&
          typeof errorMessage === 'string' &&
          errorMessage.toLowerCase().includes('signature')
        ) {
          try {
            const retryToken = generateKlingJWT()
            const retryResponse = await fetch(statusEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${retryToken}`,
              },
            })
            // IMPORTANT: If we plan to reuse the successful response later in the loop,
            // we must clone BEFORE reading the body. Otherwise we hit:
            // "Body is unusable: Body has already been read"
            const retryResponseForLater = retryResponse.clone()
            let retryCode: number | null = null
            try {
              const retryJson = await retryResponse.json()
              retryCode = typeof (retryJson as any)?.code === 'number' ? (retryJson as any).code : null
            } catch {
              retryCode = null
            }
            if (retryResponse.ok) {
              statusResponse = retryResponseForLater
              errorMessage = ''
            }
          } catch (_) {
            // noop
          }
        }

        if (!statusResponse.ok) {
          if (
            statusResponse.status === 401 &&
            typeof errorMessage === 'string' &&
            errorMessage.toLowerCase().includes('signature')
          ) {
            signatureFailures += 1
            // Kling status checks can intermittently return 401 even when the submit succeeded.
            // Treat this as transient: allow a longer streak and reset on any successful poll.
            if (signatureFailures <= 20) {
              attempts++
              continue
            }
          }
          throw new Error(errorMessage)
        }
      }

      const statusData = await statusResponse.json()
      // Successful HTTP + JSON parse: reset signature failure streak.
      signatureFailures = 0
      
      if (statusData.code !== 0) {
        throw new Error(statusData.message || `Status check error: ${statusData.code}`)
      }

      const dataField = (statusData as any)?.data

      const normalizeStatus = (value: unknown): string | null => {
        if (typeof value === 'string' && value.trim().length > 0) return value
        if (typeof value === 'number' && Number.isFinite(value)) return String(value)
        return null
      }

      const pickTaskRecord = (): Record<string, any> | null => {
        if (!dataField) return null
        if (Array.isArray(dataField)) {
          // Prefer matching task_id when the API returns a list/array of task objects.
          const objectItems = dataField.filter(
            (item) => item && typeof item === 'object' && !Array.isArray(item)
          ) as Array<Record<string, any>>
          const match = objectItems.find((item) => {
            const id = item.task_id ?? item.taskId ?? item.taskID
            return id !== undefined && String(id) === String(taskId)
          })
          if (match) return match
          // If the API returned a single task object wrapped in an array, use it.
          if (objectItems.length === 1) return objectItems[0]
          // Otherwise we can't safely pick; return null and rely on heuristic status parsing.
          return null
        }
        if (typeof dataField === 'object') return dataField as Record<string, any>
        return null
      }

      const taskRecord = pickTaskRecord()

      const taskStatusRaw =
        normalizeStatus(
          taskRecord?.task_status ??
            taskRecord?.taskStatus ??
            taskRecord?.status ??
            taskRecord?.task_state ??
            null
        ) ??
        (Array.isArray(dataField)
          ? (() => {
              // Some Kling responses appear to return tuple-like arrays. Heuristically
              // detect a known status string from primitives.
              const known = new Set([
                'submitted',
                'processing',
                'succeed',
                'succeeded',
                'success',
                'completed',
                'failed',
                'error',
                'running',
                'queued',
              ])
              for (const item of dataField) {
                if (typeof item === 'string') {
                  const lowered = item.toLowerCase()
                  if (known.has(lowered)) return lowered
                }
              }
              return null
            })()
          : null)

      const taskStatus = typeof taskStatusRaw === 'string' ? taskStatusRaw : null
      const taskStatusNormalized = taskStatus ? taskStatus.toLowerCase() : null

      console.log(`[Kling-Official] Task status: ${taskStatusNormalized ?? 'unknown'} (attempt ${attempts + 1})`)

      if (taskStatusNormalized === 'succeed' || taskStatusNormalized === 'succeeded' || taskStatusNormalized === 'success' || taskStatusNormalized === 'completed') {
        // Get the video URL from the result
        const taskResult =
          taskRecord?.task_result ?? taskRecord?.taskResult ?? taskRecord?.result ?? null
        const videos =
          (taskResult && typeof taskResult === 'object' ? (taskResult as any).videos : null) ??
          (taskRecord && typeof taskRecord === 'object' ? (taskRecord as any).videos : null)

        const findHttpUrl = (value: unknown): string | null => {
          if (typeof value === 'string' && value.startsWith('http')) return value
          if (value && typeof value === 'object') {
            for (const k of ['url', 'video_url', 'fileUrl', 'file_url']) {
              const v = (value as any)[k]
              if (typeof v === 'string' && v.startsWith('http')) return v
            }
          }
          return null
        }

        const videoUrl =
          Array.isArray(videos) && videos.length > 0
            ? findHttpUrl(videos[0])
            : Array.isArray(dataField)
              ? (() => {
                  // Tuple-like fallback: find first http url (prefer .mp4)
                  const httpStrings = dataField.filter(
                    (v) => typeof v === 'string' && v.startsWith('http')
                  ) as string[]
                  const mp4 = httpStrings.find((u) => u.toLowerCase().includes('.mp4'))
                  return mp4 || httpStrings[0] || null
                })()
              : null

        if (!videoUrl) {
          throw new Error('No video URL in result')
        }

        const videoDuration =
          Array.isArray(videos) && videos.length > 0 && videos[0] && typeof videos[0] === 'object'
            ? (videos[0] as any)?.duration || duration
            : duration

        console.log(`[Kling-Official] ✅ Video generated successfully`)

        return {
          id: `kling-${Date.now()}`,
          status: 'completed',
          outputs: [{
            url: videoUrl,
            width: aspectRatio === '9:16' ? 720 : 1280,
            height: aspectRatio === '9:16' ? 1280 : 720,
            duration: videoDuration,
          }],
          metadata: {
            model: request.modelId,
            taskId,
            duration: videoDuration,
            mode,
          },
        }
      } else if (taskStatusNormalized === 'failed' || taskStatusNormalized === 'error') {
        const errorMsg =
          taskRecord?.task_status_msg ||
          taskRecord?.taskStatusMsg ||
          taskRecord?.message ||
          'Video generation failed'
        throw new Error(errorMsg)
      }

      // Still processing, continue polling
      attempts++
    }

    throw new Error('Video generation timeout - request took too long')
  }
}
