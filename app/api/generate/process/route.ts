import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getModel } from '@/lib/models/registry'
import { uploadBase64ToStorage, uploadUrlToStorage } from '@/lib/supabase/storage'
import { logMetric } from '@/lib/metrics'
import { downloadReferenceImageAsDataUrl } from '@/lib/reference-images'
import { Prisma } from '@prisma/client'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

const GENERATION_QUEUE_ENABLED = process.env.GENERATION_QUEUE_ENABLED === 'true'
// Concurrency limit for parallel output uploads (default: 3)
const GENERATION_UPLOAD_CONCURRENCY = Number(process.env.GENERATION_UPLOAD_CONCURRENCY || '3')
const GENERATION_QUEUE_BATCH_SIZE = Number(process.env.GENERATION_QUEUE_BATCH_SIZE || '5')
const GENERATION_QUEUE_LOCK_TIMEOUT_MS = Number(process.env.GENERATION_QUEUE_LOCK_TIMEOUT_MS || 60_000)
const GENERATION_QUEUE_RETRY_DELAY_MS = Number(process.env.GENERATION_QUEUE_RETRY_DELAY_MS || 30_000)

type QueueJobHandle = { id: string; generationId: string }
type GenerationProcessResult = {
  id: string
  status: 'completed' | 'failed' | 'skipped' | 'not_found'
  error?: string
  outputCount?: number
}

async function claimGenerationJobs(batchSize: number): Promise<QueueJobHandle[]> {
  const now = new Date()
  const lockExpiry = new Date(now.getTime() - GENERATION_QUEUE_LOCK_TIMEOUT_MS)

  return prisma.$transaction(async (tx) => {
    const jobs = await tx.generationJob.findMany({
      where: {
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiry } }],
        AND: [
          {
            OR: [{ runAfter: null }, { runAfter: { lte: now } }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    })

    const claimed: QueueJobHandle[] = []
    for (const job of jobs) {
      const updated = await tx.generationJob.update({
        where: { id: job.id },
        data: {
          lockedAt: now,
          attempts: { increment: 1 },
        },
      })
      claimed.push({ id: updated.id, generationId: updated.generationId })
    }

    return claimed
  })
}

async function resolveJobHandle(handle: QueueJobHandle, result: GenerationProcessResult) {
  if (!GENERATION_QUEUE_ENABLED) return

  if (result.status === 'completed' || result.status === 'skipped' || result.status === 'not_found') {
    await prisma.generationJob
      .delete({
        where: { id: handle.id },
      })
      .catch(() => {})
    return
  }

  // Failed: release the lock and schedule retry
  await prisma.generationJob
    .update({
      where: { id: handle.id },
      data: {
        lockedAt: null,
        runAfter: new Date(Date.now() + GENERATION_QUEUE_RETRY_DELAY_MS),
      },
    })
    .catch(() => {})
}

async function processGenerationById(
  generationId: string
): Promise<GenerationProcessResult> {
  let heartbeatTimer: NodeJS.Timeout | null = null
  let stopHeartbeatRef: (() => void) | null = null
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  const appendLog = async (step: string, extra?: Record<string, any>) => {
    try {
      const existing = await prisma.generation.findUnique({ where: { id: generationId } })
      if (!existing) return
      const prev = (existing.parameters as any) || {}
      const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
      logs.push({
        at: new Date().toISOString(),
        step,
        ...((extra || {}) as any),
      })
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          parameters: {
            ...prev,
            lastHeartbeatAt: new Date().toISOString(),
            lastStep: step,
            debugLogs: logs.slice(-100),
          },
        },
      })
    } catch (_) {}
  }

  const startHeartbeat = (label: string) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = setInterval(() => {
      appendLog(label)
    }, 10000)
  }
  stopHeartbeatRef = stopHeartbeat

  try {
    await appendLog('process:start')

    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
      include: {
        session: {
          select: {
            type: true,
          },
        },
      },
    })

    if (!generation) {
      return { id: generationId, status: 'not_found', error: 'Generation not found' }
    }

    // #region agent log
    console.log(`[DEBUG:B] Process endpoint - id=${generationId}, status=${generation.status}, model=${generation.modelId}, hasWebhookPrediction=${!!(generation.parameters as any)?.replicatePredictionId}`)
    fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'local-debug',hypothesisId:'B',location:'api/generate/process/route.ts:start',message:'Process endpoint started',data:{generationId,status:generation.status,model:generation.modelId,hasWebhookPrediction:!!(generation.parameters as any)?.replicatePredictionId},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (generation.status === 'completed' || generation.status === 'failed' || generation.status === 'cancelled') {
      // #region agent log
      console.log(`[DEBUG:B] Skipping - terminal status: ${generation.status}`)
      // #endregion
      return {
        id: generation.id,
        status: 'skipped',
      }
    }

    // Skip if webhook-based prediction is already submitted
    // The generate route submits directly to Replicate with webhook, so we don't need to process again
    const params = generation.parameters as any
    if (params?.replicatePredictionId) {
      // #region agent log
      console.log(`[DEBUG:D] Skipping - webhook prediction exists: ${params.replicatePredictionId}`)
      // #endregion
      console.log(`[${generationId}] Skipping - webhook prediction already submitted: ${params.replicatePredictionId}`)
      await appendLog('process:skipped-webhook-active', { predictionId: params.replicatePredictionId })
      return {
        id: generation.id,
        status: 'skipped',
      }
    }

    // ATOMIC LOCK: Prevent duplicate processing by checking/setting processingStartedAt
    // This prevents race conditions when both server and frontend trigger process endpoint
    const lockWindow = 60_000 // 60 seconds - if processing started within this window, skip
    const now = Date.now()
    const existingLock = params?.processingStartedAt
    
    if (existingLock && (now - existingLock) < lockWindow) {
      // #region agent log
      console.log(`[DEBUG:B] Skipping - already being processed (lock age: ${now - existingLock}ms)`)
      fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'local-debug',hypothesisId:'B',location:'api/generate/process/route.ts:lock-skip',message:'Skipping - duplicate process call blocked',data:{generationId,lockAge:now-existingLock},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      console.log(`[${generationId}] Skipping - already being processed by another request (${now - existingLock}ms ago)`)
      await appendLog('process:skipped-duplicate', { lockAge: now - existingLock })
      return {
        id: generation.id,
        status: 'skipped',
      }
    }

    // Set the processing lock atomically
    try {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          parameters: {
            ...params,
            processingStartedAt: now,
          },
        },
      })
      console.log(`[${generationId}] Acquired processing lock at ${now}`)
    } catch (lockError) {
      console.error(`[${generationId}] Failed to acquire lock:`, lockError)
      // Continue anyway - the lock is best-effort
    }

    // Get model adapter
    const model = getModel(generation.modelId)
    if (!model) {
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: 'failed',
          parameters: {
            ...(generation.parameters as any),
            error: `Model not found: ${generation.modelId}`,
          },
        },
      })
      return {
        id: generation.id,
        status: 'failed',
        error: `Model not found: ${generation.modelId}`,
      }
    }

    // Extract parameters
    const parameters = generation.parameters as any
    const {
      referenceImage,
      referenceImageUrl: persistedReferenceUrl,
      referenceImagePath,
      referenceImageBucket,
      referenceImageMimeType,
      referenceImageChecksum,
      referenceImageId,
      ...otherParameters
    } = parameters || {}

    let inlineReferenceImage = referenceImage as string | undefined
    let referenceImageUrl = persistedReferenceUrl as string | undefined

    // Debug: Log what we received from parameters
    console.log(`[${generationId}] Reference image debug:`, {
      hasReferenceImage: Boolean(referenceImage),
      referenceImageLength: typeof referenceImage === 'string' ? referenceImage.length : 0,
      referenceImagePrefix: typeof referenceImage === 'string' ? referenceImage.substring(0, 50) : 'N/A',
      hasPersistedUrl: Boolean(persistedReferenceUrl),
      persistedUrl: persistedReferenceUrl || 'N/A',
      hasReferenceImages: Boolean((parameters as any)?.referenceImages),
      referenceImagesCount: Array.isArray((parameters as any)?.referenceImages) ? (parameters as any).referenceImages.length : 0,
    })

    if (inlineReferenceImage && inlineReferenceImage.startsWith('data:') && !referenceImageUrl) {
      try {
        const extension = inlineReferenceImage.includes('image/png') ? 'png' : 'jpg'
        const storagePath = `${generation.userId}/${generationId}/reference.${extension}`
        referenceImageUrl = await uploadBase64ToStorage(inlineReferenceImage, 'generated-images', storagePath)
      } catch (e) {
        console.error(`[${generationId}] Failed to upload inline reference image:`, e)
      }
    }

    if (!inlineReferenceImage && referenceImageUrl) {
      try {
        inlineReferenceImage = await downloadReferenceImageAsDataUrl(referenceImageUrl, referenceImageMimeType)
      } catch (error) {
        console.error(`[${generationId}] Failed to hydrate reference image from storage:`, error)
      }
    }

    if (referenceImageUrl || inlineReferenceImage) {
      console.log(`[${generationId}] Reference image resolved`, {
        hasInline: Boolean(inlineReferenceImage),
        referenceImageUrl,
        referenceImageId,
        referenceImagePath,
        referenceImageBucket,
        referenceImageChecksum,
      })
    }

    console.log(`[${generationId}] Starting generation with model ${generation.modelId}`)
    await appendLog('model:generate:start', { modelId: generation.modelId })
    startHeartbeat('model:generate:heartbeat')

    // Handle multiple reference images or single image
    const referenceImages = (otherParameters as any).referenceImages
    const hasMultipleImages = Array.isArray(referenceImages) && referenceImages.length > 0
    
    // For models that need data URLs (like Replicate), convert URLs to data URLs if needed
    let processedReferenceImages: string[] | undefined
    if (hasMultipleImages) {
      processedReferenceImages = await Promise.all(
        referenceImages.map(async (img: string, index: number) => {
          // If it's already a data URL, use it as-is
          if (img.startsWith('data:')) {
            return img
          }
          // If it's a URL, try to download and convert to data URL for Replicate
          // (Replicate can handle URLs, but data URLs are more reliable)
          if (img.startsWith('http')) {
            try {
              // Try to infer mime type from URL or use default
              const mimeType = img.match(/\.(png|jpg|jpeg|webp)$/i)?.[1] === 'png' ? 'image/png' : 'image/jpeg'
              const dataUrl = await downloadReferenceImageAsDataUrl(img, mimeType)
              console.log(`[${generationId}] Converted reference image ${index + 1} from URL to data URL`)
              return dataUrl
            } catch (error) {
              console.warn(`[${generationId}] Failed to convert reference image ${index + 1} URL to data URL, using URL directly:`, img.substring(0, 100))
              // Fallback to URL - Replicate should handle public URLs
              return img
            }
          }
          return img
        })
      )
      console.log(`[${generationId}] Processed ${processedReferenceImages.length} reference image(s) for generation`)
    }
    
    // Build the generation request
    const generationRequest: any = {
      prompt: generation.prompt,
      negativePrompt: generation.negativePrompt || undefined,
      parameters: otherParameters,
      ...otherParameters,
    }

    // Add reference images - handle both single and multiple
    if (hasMultipleImages) {
      generationRequest.referenceImages = processedReferenceImages || referenceImages
      console.log(`[${generationId}] Passing ${generationRequest.referenceImages.length} reference images to model`)
    } else if (inlineReferenceImage) {
      generationRequest.referenceImage = inlineReferenceImage
      generationRequest.referenceImageUrl = referenceImageUrl
      console.log(`[${generationId}] Passing single reference image to model (${inlineReferenceImage.substring(0, 30)}...)`)
    } else if (referenceImageUrl) {
      generationRequest.referenceImageUrl = referenceImageUrl
      console.log(`[${generationId}] Passing reference URL to model: ${referenceImageUrl.substring(0, 50)}...`)
    } else {
      console.log(`[${generationId}] No reference image provided for generation`)
    }

    // Generate using the model
    const result = await model.generate(generationRequest)
    stopHeartbeat()
    await appendLog('model:generate:end', { status: result?.status })

    console.log(`[${generationId}] Generation result:`, result.status)

    try {
      const latest = await prisma.generation.findUnique({ where: { id: generation.id } })
      if (latest && latest.status === 'cancelled') {
        await appendLog('cancelled:skip-after-generate')
        return { id: generation.id, status: 'skipped' }
      }
    } catch (_) {}

    if (result.status === 'completed' && result.outputs) {
      // Import p-limit dynamically for parallel uploads
      const pLimit = (await import('p-limit')).default
      const limit = pLimit(GENERATION_UPLOAD_CONCURRENCY)

      // Start heartbeat for the entire upload phase
      startHeartbeat('storage:upload-batch:heartbeat')

      console.log(`[${generationId}] Uploading ${result.outputs.length} outputs in parallel (concurrency: ${GENERATION_UPLOAD_CONCURRENCY})`)

      // Upload all outputs in parallel with limited concurrency
      const uploadResults = await Promise.allSettled(
        result.outputs.map((output, i) =>
          limit(async () => {
            let finalUrl = output.url

            if (output.url.startsWith('data:')) {
              const extension = generation.session.type === 'video' ? 'mp4' : output.url.includes('image/png') ? 'png' : 'jpg'
              const bucket = generation.session.type === 'video' ? 'generated-videos' : 'generated-images'
              const storagePath = `${generation.userId}/${generationId}/${i}.${extension}`

              console.log(`[${generationId}] Uploading base64 ${generation.session.type} ${i} to storage`)
              finalUrl = await uploadBase64ToStorage(output.url, bucket, storagePath)
              console.log(`[${generationId}] Uploaded ${i} to: ${finalUrl}`)
            } else if (output.url.startsWith('http')) {
              const extension = generation.session.type === 'video' ? 'mp4' : output.url.includes('.png') ? 'png' : 'jpg'
              const bucket = generation.session.type === 'video' ? 'generated-videos' : 'generated-images'
              const storagePath = `${generation.userId}/${generationId}/${i}.${extension}`

              console.log(`[${generationId}] Uploading external URL ${i} to storage`)
              try {
                const isGeminiFile = output.url.includes('generativelanguage.googleapis.com')
                const headers = isGeminiFile && process.env.GEMINI_API_KEY ? { 'x-goog-api-key': process.env.GEMINI_API_KEY as string } : undefined
                finalUrl = await uploadUrlToStorage(output.url, bucket, storagePath, headers ? { headers } : undefined)
                console.log(`[${generationId}] Uploaded ${i} to: ${finalUrl}`)
              } catch (error) {
                console.error(`[${generationId}] Failed to upload ${i} to storage, using original URL:`, error)
                await appendLog('storage:upload-url:failed', { index: i, error: (error as any)?.message })
                // Fallback to original URL
              }
            }

            return {
              index: i,
              finalUrl,
              output,
            }
          })
        )
      )

      stopHeartbeat()

      // Store original outputs for fallback reference
      const originalOutputs = result.outputs

      // Process results - use fallback URL for any failures
      const outputRecords = uploadResults.map((uploadResult, i) => {
        const originalOutput = originalOutputs[i]
        let finalUrl = originalOutput.url

        if (uploadResult.status === 'fulfilled') {
          finalUrl = uploadResult.value.finalUrl
        } else {
          console.error(`[${generationId}] Upload ${i} failed:`, uploadResult.reason)
          // Keep original URL as fallback
        }

        return {
          generationId: generation.id,
          fileUrl: finalUrl,
          fileType: generation.session.type,
          width: originalOutput.width,
          height: originalOutput.height,
          duration: originalOutput.duration,
        }
      })

      await prisma.output.createMany({
        data: outputRecords,
      })

      // Enqueue semantic analysis for the new outputs (best-effort)
      try {
        // Fetch the created output IDs
        const createdOutputs = await prisma.output.findMany({
          where: { generationId: generation.id },
          select: { id: true },
        })

        if (createdOutputs.length > 0) {
          // Create OutputAnalysis rows for each output (idempotent via unique constraint)
          await (prisma as any).outputAnalysis.createMany({
            data: createdOutputs.map((output: { id: string }) => ({
              outputId: output.id,
              status: 'queued',
            })),
            skipDuplicates: true,
          })
          console.log(`[${generationId}] Enqueued ${createdOutputs.length} output(s) for semantic analysis`)
        }
      } catch (analysisError: any) {
        // Don't fail the generation if analysis enqueue fails
        console.warn(`[${generationId}] Failed to enqueue analysis:`, analysisError.message)
      }

      // Calculate cost for this generation
      const { calculateGenerationCost } = await import('@/lib/cost/calculator')
      const totalVideoDuration = outputRecords.reduce((sum, output) => {
        return sum + (output.duration || 0)
      }, 0)
      const costResult = calculateGenerationCost(generation.modelId, {
        outputCount: outputRecords.length,
        videoDurationSeconds: totalVideoDuration > 0 ? totalVideoDuration : undefined,
      })

      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'completed',
          cost: costResult.cost,
        },
      })

      console.log(`[${generationId}] Generation completed successfully`)
      await appendLog('process:completed', { outputCount: outputRecords.length })

      return {
        id: generation.id,
        status: 'completed',
        outputCount: outputRecords.length,
      }
    }

    if (result.status === 'failed') {
      const errorContext = {
        message: result.error || 'Generation failed',
        type: 'ModelGenerationError',
        timestamp: new Date().toISOString(),
        userId: generation.userId,
      }
      
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'failed',
          parameters: {
            ...(generation.parameters as any),
            error: errorContext.message,
            errorContext, // Store full error context for debugging
          },
        },
      })

      console.log(`[${generationId}] Generation failed for user ${generation.userId}:`, errorContext.message)
      await appendLog('process:failed', { error: result.error, userId: generation.userId })

      return {
        id: generation.id,
        status: 'failed',
        error: result.error || 'Generation failed',
      }
    }

    // Handle unexpected status (like 'processing') as failed
    return {
      id: generation.id,
      status: 'failed',
      error: `Unexpected generation status: ${result.status}`,
    }
  } catch (error: any) {
    console.error('Background generation error:', error)

    try {
      const generation = await prisma.generation.findUnique({
        where: { id: generationId },
      })

      if (generation) {
        const errorContext = {
          message: error.message || 'Generation failed',
          type: error.name || 'UnknownError',
          stack: error.stack || undefined,
          timestamp: new Date().toISOString(),
          userId: generation.userId,
        }
        
        await prisma.generation.update({
          where: { id: generationId },
          data: {
            status: 'failed',
            parameters: {
              ...(generation.parameters as any),
              error: errorContext.message,
              errorContext, // Store full error context for debugging
            },
          },
        })
        
        // Log with user context for easier debugging
        console.error(`[${generationId}] Generation failed for user ${generation.userId}:`, errorContext)
      }
    } catch (updateError) {
      console.error('Failed to update generation status:', updateError)
    }

    return {
      id: generationId,
      status: 'failed',
      error: error.message || 'Generation failed',
    }
  } finally {
    stopHeartbeatRef?.()
  }
}

/**
 * Background processor for async generation
 * This endpoint processes a generation that's already been created in the database
 * It's called asynchronously after the main generate endpoint returns
 */
export async function POST(request: NextRequest) {
  // Read body once and store it for error handling
  let requestBody: any = {}
  const startedAt = Date.now()
  let metricStatus: 'success' | 'error' = 'success'
  let statusCode = 200
  const metricMeta: Record<string, any> = {}

  const respond = (body: any, status: number = 200) => {
    statusCode = status
    metricStatus = status >= 400 ? 'error' : 'success'
    return NextResponse.json(body, { status })
  }
  
  // Allow internal calls via secret header OR authenticated users
  // This endpoint can be called from:
  // 1. Server-side (internal) with secret header
  // 2. Authenticated users (frontend fallback)
  const internalSecret = request.headers.get('x-internal-secret')
  const expectedSecret = process.env.INTERNAL_API_SECRET
  
  // Debug: Log auth check details
  const receivedPreview = internalSecret 
    ? `${internalSecret.substring(0, 4)}...${internalSecret.substring(internalSecret.length - 4)}`
    : 'NOT RECEIVED'
  const expectedPreview = expectedSecret 
    ? `${expectedSecret.substring(0, 4)}...${expectedSecret.substring(expectedSecret.length - 4)}`
    : 'NOT SET'
  console.log(`[process] Auth check - received: ${receivedPreview}, expected: ${expectedPreview}, match: ${internalSecret === expectedSecret}`)
  
  // If internal secret is provided and matches, skip auth check
  const isInternalCall = internalSecret && expectedSecret && internalSecret === expectedSecret
  
  // If no internal secret or it doesn't match, check auth (for frontend calls)
  if (!isInternalCall) {
    try {
      const { createRouteHandlerClient } = await import('@supabase/auth-helpers-nextjs')
      const { cookies } = await import('next/headers')
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session }, error: authError } = await supabase.auth.getSession()
      
      if (authError) {
        console.error(`[process] Auth error: ${authError.message}`)
        return respond({ error: 'Unauthorized', details: authError.message }, 401)
      }
      
      if (!session) {
        console.warn(`[process] No session found - cookies may not be available`)
        return respond({ error: 'Unauthorized', details: 'No active session' }, 401)
      }
      
      console.log(`[process] Auth successful - user: ${session.user.id}`)
    } catch (authCheckError: any) {
      // If auth check fails and no valid internal secret, deny access
      console.error(`[process] Auth check exception:`, authCheckError?.message || authCheckError)
      if (!isInternalCall) {
        return respond({ error: 'Unauthorized', details: authCheckError?.message || 'Auth check failed' }, 401)
      }
    }
  }
  
  try {
    requestBody = await request.json().catch(() => ({}))
    if (requestBody && Object.keys(requestBody).length > 0) {
      console.log(`[${requestBody.generationId || 'queue'}] Process endpoint payload:`, JSON.stringify(requestBody))
    }
  } catch (error) {
    console.error('Failed to parse request body:', error)
    metricStatus = 'error'
    return respond({ error: 'Invalid request body' }, 400)
  }

  try {
    const directGenerationId: string | undefined = requestBody.generationId
    let handles: Array<{ generationId: string; job?: QueueJobHandle }> = []

    if (directGenerationId) {
      metricMeta.generationId = directGenerationId
      handles.push({ generationId: directGenerationId })
    } else if (GENERATION_QUEUE_ENABLED) {
      const jobs = await claimGenerationJobs(GENERATION_QUEUE_BATCH_SIZE)
      if (!jobs.length) {
        return respond({ message: 'No queued generations available' })
      }
      handles = jobs.map((job) => ({ generationId: job.generationId, job }))
      metricMeta.batchSize = handles.length
    } else {
      return respond({ error: 'Generation ID is required' }, 400)
    }

    const results: GenerationProcessResult[] = []

    for (const handle of handles) {
      const result = await processGenerationById(handle.generationId)
      results.push(result)
      if (handle.job) {
        await resolveJobHandle(handle.job, result)
      }
    }

    metricMeta.results = results.map((r) => ({ id: r.id, status: r.status }))

    const hasFailure = results.some((r) => r.status === 'failed')
    const httpStatus = hasFailure ? 500 : 200

    if (handles.length === 1 && !handles[0].job) {
      return respond(results[0], httpStatus)
    }

    return respond(
      {
        processed: results.length,
        results,
      },
      httpStatus
    )
  } catch (error: any) {
    console.error('Background generation error:', error)
    metricStatus = 'error'
    return respond(
      {
        error: error.message || 'Generation failed',
        status: 'failed',
      },
      500
    )
  } finally {
    logMetric({
      name: 'api_generate_process_post',
      status: metricStatus,
      durationMs: Date.now() - startedAt,
      meta: {
        ...metricMeta,
        statusCode,
      },
    })
  }
}