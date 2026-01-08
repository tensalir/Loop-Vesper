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

    if (generation.status === 'completed' || generation.status === 'failed' || generation.status === 'cancelled') {
      return {
        id: generation.id,
        status: 'skipped',
      }
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
    
    // Generate using the model
    const result = await model.generate({
      prompt: generation.prompt,
      negativePrompt: generation.negativePrompt || undefined,
      ...(hasMultipleImages 
        ? { referenceImages } 
        : { referenceImage: inlineReferenceImage, referenceImageUrl }),
      parameters: otherParameters,
      ...otherParameters,
    })
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
      const outputRecords = []

      for (let i = 0; i < result.outputs.length; i++) {
        const output = result.outputs[i]
        let finalUrl = output.url

        if (output.url.startsWith('data:')) {
          const extension = generation.session.type === 'video' ? 'mp4' : output.url.includes('image/png') ? 'png' : 'jpg'
          const bucket = generation.session.type === 'video' ? 'generated-videos' : 'generated-images'
          const storagePath = `${generation.userId}/${generationId}/${i}.${extension}`

          console.log(`[${generationId}] Uploading base64 ${generation.session.type} ${i} to storage`)
          startHeartbeat('storage:upload:heartbeat')
          finalUrl = await uploadBase64ToStorage(output.url, bucket, storagePath)
          console.log(`[${generationId}] Uploaded to: ${finalUrl}`)
          stopHeartbeat()
        } else if (output.url.startsWith('http')) {
          const extension = generation.session.type === 'video' ? 'mp4' : output.url.includes('.png') ? 'png' : 'jpg'
          const bucket = generation.session.type === 'video' ? 'generated-videos' : 'generated-images'
          const storagePath = `${generation.userId}/${generationId}/${i}.${extension}`

          console.log(`[${generationId}] Uploading external URL ${i} to storage`)
          try {
            startHeartbeat('storage:upload-url:heartbeat')
            const isGeminiFile = output.url.includes('generativelanguage.googleapis.com')
            const headers = isGeminiFile && process.env.GEMINI_API_KEY ? { 'x-goog-api-key': process.env.GEMINI_API_KEY as string } : undefined
            finalUrl = await uploadUrlToStorage(output.url, bucket, storagePath, headers ? { headers } : undefined)
            console.log(`[${generationId}] Uploaded to: ${finalUrl}`)
            stopHeartbeat()
          } catch (error) {
            console.error(`[${generationId}] Failed to upload to storage, using original URL:`, error)
            stopHeartbeat()
            await appendLog('storage:upload-url:failed', { error: (error as any)?.message })
          }
        }

        outputRecords.push({
          generationId: generation.id,
          fileUrl: finalUrl,
          fileType: generation.session.type,
          width: output.width,
          height: output.height,
          duration: output.duration,
        })
      }

      await prisma.output.createMany({
        data: outputRecords,
      })

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
  
  // If internal secret is provided and matches, skip auth check
  const isInternalCall = internalSecret && expectedSecret && internalSecret === expectedSecret
  
  // If no internal secret or it doesn't match, check auth (for frontend calls)
  if (!isInternalCall) {
    try {
      const { createRouteHandlerClient } = await import('@supabase/auth-helpers-nextjs')
      const { cookies } = await import('next/headers')
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session }, error: authError } = await supabase.auth.getSession()
      
      if (authError || !session) {
        return respond({ error: 'Unauthorized' }, 401)
      }
    } catch (authCheckError) {
      // If auth check fails and no valid internal secret, deny access
      if (!isInternalCall) {
        return respond({ error: 'Unauthorized' }, 401)
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
