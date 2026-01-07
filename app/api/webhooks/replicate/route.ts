import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage, uploadUrlToStorage } from '@/lib/supabase/storage'
import { logMetric } from '@/lib/metrics'
import crypto from 'crypto'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

/**
 * Replicate Webhook Handler
 * 
 * This endpoint receives callbacks from Replicate when predictions complete.
 * It replaces the polling-based approach, eliminating timeout issues.
 * 
 * Replicate sends:
 * - id: prediction ID
 * - status: "starting" | "processing" | "succeeded" | "failed" | "canceled"
 * - output: array of URLs (when succeeded)
 * - error: error message (when failed)
 */

interface ReplicateWebhookPayload {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: string | string[] | null
  error?: string | null
  metrics?: {
    predict_time?: number
  }
  created_at?: string
  completed_at?: string
}

/**
 * Verify webhook signature from Replicate (optional but recommended)
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string | null
): boolean {
  if (!secret || !signature) {
    // If no secret configured, skip verification (less secure)
    return true
  }

  try {
    const [timestampPart, signaturePart] = signature.split(',')
    const timestamp = timestampPart?.split('=')[1]
    const sig = signaturePart?.split('=')[1]

    if (!timestamp || !sig) {
      console.warn('[Replicate Webhook] Invalid signature format')
      return false
    }

    // Check timestamp is recent (within 5 minutes)
    const webhookTime = parseInt(timestamp, 10) * 1000
    const now = Date.now()
    if (Math.abs(now - webhookTime) > 5 * 60 * 1000) {
      console.warn('[Replicate Webhook] Timestamp too old')
      return false
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex')

    return crypto.timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expectedSig, 'hex')
    )
  } catch (error) {
    console.error('[Replicate Webhook] Signature verification error:', error)
    return false
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let metricStatus: 'success' | 'error' = 'success'
  let predictionId: string | null = null

  try {
    // Get raw body for signature verification
    const rawBody = await request.text()
    const payload: ReplicateWebhookPayload = JSON.parse(rawBody)
    predictionId = payload.id

    console.log(`[Replicate Webhook] Received: prediction=${predictionId}, status=${payload.status}`)

    // Verify signature if secret is configured
    const signature = request.headers.get('webhook-signature')
    const secret = process.env.REPLICATE_WEBHOOK_SECRET
    
    if (secret && !verifyWebhookSignature(rawBody, signature, secret)) {
      console.error(`[Replicate Webhook] Invalid signature for prediction ${predictionId}`)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Find the generation by prediction ID
    // The prediction ID is stored in parameters.replicatePredictionId
    const generation = await prisma.generation.findFirst({
      where: {
        parameters: {
          path: ['replicatePredictionId'],
          equals: predictionId,
        },
      },
      include: {
        session: {
          select: {
            type: true,
          },
        },
      },
    })

    if (!generation) {
      console.warn(`[Replicate Webhook] No generation found for prediction ${predictionId}`)
      // Return 200 to acknowledge receipt (don't want Replicate to retry)
      return NextResponse.json({ 
        received: true, 
        warning: 'Generation not found',
        predictionId 
      })
    }

    console.log(`[Replicate Webhook] Found generation ${generation.id} for prediction ${predictionId}`)

    // Skip if generation is already in a terminal state
    if (['completed', 'failed', 'cancelled'].includes(generation.status)) {
      console.log(`[Replicate Webhook] Generation ${generation.id} already ${generation.status}, skipping`)
      return NextResponse.json({ 
        received: true, 
        skipped: true,
        reason: `Already ${generation.status}` 
      })
    }

    // Handle different statuses
    if (payload.status === 'succeeded') {
      console.log(`[Replicate Webhook] Processing successful prediction for ${generation.id}`)
      
      // Parse output URLs
      let outputUrls: string[] = []
      if (payload.output) {
        if (Array.isArray(payload.output)) {
          outputUrls = payload.output
        } else if (typeof payload.output === 'string') {
          outputUrls = [payload.output]
        }
      }

      if (outputUrls.length === 0) {
        console.error(`[Replicate Webhook] No output URLs for prediction ${predictionId}`)
        await prisma.generation.update({
          where: { id: generation.id },
          data: {
            status: 'failed',
            parameters: {
              ...(generation.parameters as any),
              error: 'No output URLs in webhook payload',
              webhookPayload: payload,
            },
          },
        })
        return NextResponse.json({ received: true, error: 'No output URLs' })
      }

      // Upload outputs to storage
      const outputRecords = []
      for (let i = 0; i < outputUrls.length; i++) {
        const outputUrl = outputUrls[i]
        let finalUrl = outputUrl

        // Upload to Supabase storage
        try {
          const extension = generation.session.type === 'video' ? 'mp4' : 
            outputUrl.includes('.png') ? 'png' : 'jpg'
          const bucket = generation.session.type === 'video' ? 'generated-videos' : 'generated-images'
          const storagePath = `${generation.userId}/${generation.id}/${i}.${extension}`

          console.log(`[Replicate Webhook] Uploading output ${i} to storage`)
          finalUrl = await uploadUrlToStorage(outputUrl, bucket, storagePath)
          console.log(`[Replicate Webhook] Uploaded to: ${finalUrl}`)
        } catch (uploadError: any) {
          console.error(`[Replicate Webhook] Failed to upload output ${i}:`, uploadError.message)
          // Use original URL as fallback
        }

        // Determine dimensions based on aspect ratio (if available)
        const params = generation.parameters as any
        const aspectRatio = params?.aspectRatio || '1:1'
        const aspectRatioDimensions: Record<string, { width: number; height: number }> = {
          '1:1': { width: 1024, height: 1024 },
          '2:3': { width: 832, height: 1248 },
          '3:2': { width: 1248, height: 832 },
          '3:4': { width: 864, height: 1184 },
          '4:3': { width: 1184, height: 864 },
          '9:16': { width: 768, height: 1344 },
          '16:9': { width: 1344, height: 768 },
        }
        const dimensions = aspectRatioDimensions[aspectRatio] || { width: 1024, height: 1024 }

        outputRecords.push({
          generationId: generation.id,
          fileUrl: finalUrl,
          fileType: generation.session.type,
          width: dimensions.width,
          height: dimensions.height,
        })
      }

      // Create output records
      await prisma.output.createMany({
        data: outputRecords,
      })

      // Enqueue semantic analysis for the new outputs (best-effort)
      try {
        const createdOutputs = await prisma.output.findMany({
          where: { generationId: generation.id },
          select: { id: true },
        })

        if (createdOutputs.length > 0) {
          await (prisma as any).outputAnalysis.createMany({
            data: createdOutputs.map((output: { id: string }) => ({
              outputId: output.id,
              status: 'queued',
            })),
            skipDuplicates: true,
          })
          console.log(`[Replicate Webhook] Enqueued ${createdOutputs.length} output(s) for semantic analysis`)
        }
      } catch (analysisError: any) {
        console.warn(`[Replicate Webhook] Failed to enqueue analysis:`, analysisError.message)
      }

      // Calculate cost
      const { calculateGenerationCost } = await import('@/lib/cost/calculator')
      const costResult = calculateGenerationCost(generation.modelId, {
        outputCount: outputRecords.length,
      })

      // Update generation to completed
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'completed',
          cost: costResult.cost,
          parameters: {
            ...(generation.parameters as any),
            webhookCompletedAt: new Date().toISOString(),
            replicatePredictTime: payload.metrics?.predict_time,
          },
        },
      })

      console.log(`[Replicate Webhook] ✅ Generation ${generation.id} completed with ${outputRecords.length} output(s)`)

      return NextResponse.json({
        received: true,
        generationId: generation.id,
        status: 'completed',
        outputCount: outputRecords.length,
      })

    } else if (payload.status === 'failed' || payload.status === 'canceled') {
      console.log(`[Replicate Webhook] Prediction ${predictionId} ${payload.status}: ${payload.error}`)

      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: 'failed',
          parameters: {
            ...(generation.parameters as any),
            error: payload.error || `Prediction ${payload.status}`,
            webhookStatus: payload.status,
            webhookFailedAt: new Date().toISOString(),
          },
        },
      })

      return NextResponse.json({
        received: true,
        generationId: generation.id,
        status: 'failed',
        error: payload.error,
      })

    } else {
      // Still processing - just acknowledge
      console.log(`[Replicate Webhook] Prediction ${predictionId} still ${payload.status}`)
      return NextResponse.json({
        received: true,
        status: payload.status,
      })
    }

  } catch (error: any) {
    console.error('[Replicate Webhook] Error:', error)
    metricStatus = 'error'

    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 500 }
    )
  } finally {
    logMetric({
      name: 'api_webhook_replicate',
      status: metricStatus,
      durationMs: Date.now() - startedAt,
      meta: { predictionId },
    })
  }
}

// Also handle GET for webhook verification (some services require this)
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: 'ok',
    message: 'Replicate webhook endpoint is active',
    timestamp: new Date().toISOString(),
  })
}
