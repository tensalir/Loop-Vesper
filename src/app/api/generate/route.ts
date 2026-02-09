import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getModel } from '@/lib/models/registry'
import { logMetric } from '@/lib/metrics'
import { persistReferenceImage, persistReferenceImages } from '@/lib/reference-images'
import { 
  submitReplicatePrediction, 
  supportsWebhook, 
  REPLICATE_MODEL_CONFIGS 
} from '@/lib/models/replicate-utils'
import { validateBody, GenerateRequestSchema } from '@/lib/api/validation'
import { generateLimiter } from '@/lib/api/rate-limit'
import { appendDebugLog } from '@/lib/api/debug-log'

const GENERATION_QUEUE_ENABLED = process.env.GENERATION_QUEUE_ENABLED === 'true'
// Enable webhook-based generation for Replicate models (eliminates timeout issues)
// TEMPORARILY DISABLED: Webhook callbacks not being received from Replicate
// Re-enable once webhook delivery is confirmed working
const USE_REPLICATE_WEBHOOKS = process.env.USE_REPLICATE_WEBHOOKS === 'true' // Default: DISABLED until webhooks work

export async function POST(request: NextRequest) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let generation: any = null
  const startedAt = Date.now()
  let metricStatus: 'success' | 'error' = 'success'
  let statusCode = 200
  const metricMeta: Record<string, any> = {}

  const respond = (body: any, status: number = 200) => {
    statusCode = status
    metricStatus = status >= 400 ? 'error' : 'success'
    return NextResponse.json(body, { status })
  }
  
  try {
    const supabase = createRouteHandlerClient({ cookies })

    // Check authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return respond({ error: 'Unauthorized' }, 401)
    }

    // Rate limit check
    const rateLimited = generateLimiter.check(user.id)
    if (rateLimited) return rateLimited

    // Parse and validate request body
    const validation = await validateBody(request, GenerateRequestSchema)
    if (validation.error) return validation.error
    const { sessionId, modelId, prompt, negativePrompt, parameters: requestParameters } = validation.data
    const rawParameters = (requestParameters || {}) as Record<string, any>
    const { 
      referenceImage, 
      referenceImages, 
      referenceImageId, 
      referenceImageUrl,  // Pre-uploaded URL (bypasses 4.5MB limit)
      endFrameImage, 
      endFrameImageId,
      endFrameImageUrl,   // Pre-uploaded URL (bypasses 4.5MB limit) 
      ...otherParameters 
    } = rawParameters
    let referencePointer: Record<string, any> | null = null
    let endFramePointer: Record<string, any> | null = null

    // Generate a unique ID for reference images (used before generation is created)
    const referenceGroupId = `refgrp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Handle reference images - PRIORITY: pre-uploaded URL > base64 > referenceImageId
    if (referenceImageUrl && typeof referenceImageUrl === 'string' && referenceImageUrl.startsWith('http')) {
      // Pre-uploaded URL - use directly (no upload needed, bypasses 4.5MB limit!)
      metricMeta.hasReferenceImage = true
      metricMeta.referenceSource = 'pre-uploaded-url'
      referencePointer = { referenceImageUrl }
      console.log(`[generate] Using pre-uploaded reference URL: ${referenceImageUrl.slice(0, 50)}...`)
    } else if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
      // Multiple images - persist all of them to storage, store only URLs
      metricMeta.hasReferenceImage = true
      metricMeta.referenceImageCount = referenceImages.length
      
      // Filter to only base64 data URLs that need uploading
      const base64Images = referenceImages.filter(
        (img: unknown) => typeof img === 'string' && img.startsWith('data:')
      )
      // Keep any existing HTTP URLs as-is
      const existingUrls = referenceImages.filter(
        (img: unknown) => typeof img === 'string' && img.startsWith('http')
      )
      
      if (base64Images.length > 0) {
        // Persist base64 images to storage
        const uploadedUrls = await persistReferenceImages(base64Images, user.id, referenceGroupId)
        referencePointer = {
          referenceImages: [...existingUrls, ...uploadedUrls],
        }
      } else {
        // All images are already URLs
        referencePointer = {
          referenceImages: existingUrls,
        }
      }
    } else if (referenceImage && typeof referenceImage === 'string' && referenceImage.startsWith('data:')) {
      // Single base64 image (backward compatibility)
      metricMeta.hasReferenceImage = true
      metricMeta.referenceSource = 'base64-upload'
      referencePointer = await persistReferenceImage(referenceImage, user.id, referenceImageId)
    } else if (referenceImage && typeof referenceImage === 'string' && referenceImage.startsWith('http')) {
      // BACKWARD COMPATIBILITY: referenceImage sent as URL (should be referenceImageUrl)
      // Treat it like referenceImageUrl to avoid breaking older clients
      metricMeta.hasReferenceImage = true
      metricMeta.referenceSource = 'legacy-url-in-referenceImage'
      referencePointer = { referenceImageUrl: referenceImage }
      console.log(`[generate] LEGACY: referenceImage sent as URL, treating as referenceImageUrl: ${referenceImage.slice(0, 50)}...`)
    } else if (referenceImageId) {
      referencePointer = { referenceImageId }
    }

    // Handle end frame image - PRIORITY: pre-uploaded URL > base64
    if (endFrameImageUrl && typeof endFrameImageUrl === 'string' && endFrameImageUrl.startsWith('http')) {
      // Pre-uploaded URL - use directly (no upload needed!)
      endFramePointer = { endFrameImageUrl }
      console.log(`[generate] Using pre-uploaded end frame URL: ${endFrameImageUrl.slice(0, 50)}...`)
    } else if (endFrameImage && typeof endFrameImage === 'string' && endFrameImage.startsWith('data:')) {
      // End frame is a base64 image - persist to storage
      const endFrameGroupId = `endframe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const persistResult = await persistReferenceImage(endFrameImage, user.id, endFrameImageId || endFrameGroupId)
      if (persistResult?.referenceImageUrl) {
        endFramePointer = { endFrameImageUrl: persistResult.referenceImageUrl }
      }
    } else if (endFrameImage && typeof endFrameImage === 'string' && endFrameImage.startsWith('http')) {
      // End frame is already a URL (legacy format)
      endFramePointer = { endFrameImageUrl: endFrameImage }
    }

    const generationParameters = {
      ...otherParameters,
      ...(referencePointer || {}),
      ...(endFramePointer || {}),
    }

    // Track metrics
    metricMeta.sessionId = sessionId
    metricMeta.modelId = modelId

    // SECURITY: Verify user has access to this session via project ownership, membership, or public project
    const sessionRecord = await prisma.session.findFirst({
      where: {
        id: sessionId,
        project: {
          OR: [
            { ownerId: user.id }, // User owns the project
            {
              members: {
                some: {
                  userId: user.id, // User is a member of the project
                },
              },
            },
            { isShared: true }, // Public project
          ],
        },
      },
      select: { id: true },
    })

    if (!sessionRecord) {
      return respond(
        { error: 'Session not found or unauthorized' },
        403
      )
    }

    // Verify model exists
    const model = getModel(modelId)
    if (!model) {
      return respond(
        { error: `Model not found: ${modelId}` },
        404
      )
    }

    // Create generation record in database with 'processing' status
    // Note: cost field is nullable and will be set later when generation completes
    try {
      generation = await prisma.generation.create({
        data: {
          sessionId,
          userId: user.id,
          modelId,
          prompt,
          negativePrompt: negativePrompt || null,
          parameters: generationParameters,
          status: 'processing',
          // cost is nullable, so we don't set it here - it will be calculated and set when generation completes
        },
      })
    } catch (error: any) {
      // Handle case where cost column doesn't exist yet (migration not applied)
      if (error.message?.includes('cost') || error.message?.includes('column') || error.code === 'P2002') {
        console.error('Database schema mismatch - cost column may be missing. Run migration: prisma/migrations/add_cost_column.sql')
        // Try without cost field (if Prisma allows it)
        generation = await prisma.generation.create({
          data: {
            sessionId,
            userId: user.id,
            modelId,
            prompt,
            negativePrompt: negativePrompt || null,
            parameters: generationParameters,
            status: 'processing',
          } as any, // Type assertion to bypass Prisma validation if column missing
        })
      } else {
        throw error
      }
    }

    console.log(`[${generation.id}] Generation created, starting async processing`)
    metricMeta.generationId = generation.id
    
    // Update session's updatedAt to reflect recent activity
    // This ensures sessions sort by last interaction, not just creation date
    await prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    }).catch((err) => {
      // Non-critical - log but don't fail the generation
      console.warn(`[${generation.id}] Failed to update session timestamp:`, err.message)
    })
    
    if (GENERATION_QUEUE_ENABLED) {
      await prisma.generationJob.create({
        data: {
          generationId: generation.id,
        },
      })
      console.log(`[${generation.id}] Job enqueued for background processor`)
    }
    // Best-effort: add initial debug log
    await appendDebugLog(generation.id, 'generate:create')

    if (!GENERATION_QUEUE_ENABLED) {
      const baseUrl = request.nextUrl.origin
      
      
      // NEW: Use webhooks for Replicate models (eliminates polling timeout issues)
      if (USE_REPLICATE_WEBHOOKS && supportsWebhook(modelId)) {
        console.log(`[${generation.id}] Using webhook-based generation for ${modelId}`)
        
        try {
          const modelConfig = REPLICATE_MODEL_CONFIGS[modelId]
          const webhookUrl = `${baseUrl}/api/webhooks/replicate`
          
          // Build input for the model
          const input = modelConfig.buildInput({
            prompt,
            negativePrompt,
            ...generationParameters,
          })
          
          console.log(`[${generation.id}] Submitting to Replicate with webhook: ${webhookUrl}`)
          
          // Submit prediction with webhook
          const prediction = await submitReplicatePrediction({
            modelPath: modelConfig.modelPath,
            input,
            webhookUrl,
            webhookEventsFilter: ['completed'],
          })
          
          // Store prediction ID for webhook matching
          await prisma.generation.update({
            where: { id: generation.id },
            data: {
              parameters: {
                ...generationParameters,
                replicatePredictionId: prediction.predictionId,
                webhookUrl,
                submittedAt: new Date().toISOString(),
              },
            },
          })
          
          console.log(`[${generation.id}] ✅ Prediction submitted: ${prediction.predictionId}`)
          
          // Return immediately - webhook will handle completion
          return respond({
            id: generation.id,
            status: 'processing',
            message: 'Generation started. Results will arrive via webhook.',
            predictionId: prediction.predictionId,
          })
          
        } catch (webhookError: any) {
          console.error(`[${generation.id}] Webhook submission failed, falling back to polling:`, webhookError.message)
          // Fall through to polling-based approach
        }
      }
      
      // FALLBACK: Trigger background processing asynchronously (fire and forget)
      // Used for non-Replicate models or when webhook submission fails
      // IMPORTANT: The process endpoint takes 30-60+ seconds to complete (Replicate polling)
      // We should NOT wait for completion - just verify the request was accepted
      // TIER 2 FIX: Use request origin as default to avoid URL mismatches with custom domains
      
      console.log(`[${generation.id}] Triggering background process at: ${baseUrl}/api/generate/process`)
      
      const triggerProcessing = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const processUrl = `${baseUrl}/api/generate/process`
            console.log(`[${generation.id}] Attempt ${i + 1}/${retries}: Calling ${processUrl}`)
            
            const hasSecret = Boolean(process.env.INTERNAL_API_SECRET)
            console.log(`[${generation.id}] Internal secret available: ${hasSecret}`)
            
            // Use AbortController so we can handle timeout gracefully
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10000)
            
            let response: Response
            try {
              response = await fetch(processUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  // Add internal secret for server-to-server calls
                  ...(process.env.INTERNAL_API_SECRET && {
                    'x-internal-secret': process.env.INTERNAL_API_SECRET,
                  }),
                },
                body: JSON.stringify({
                  generationId: generation.id,
                }),
                signal: controller.signal,
                // Detect unexpected redirects instead of silently following them
                redirect: 'manual',
              })
            } finally {
              clearTimeout(timeoutId)
            }
            
            // Check for redirects (which can strip headers and cause auth failures)
            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.get('location')
              console.warn(`[${generation.id}] Unexpected redirect: ${response.status} -> ${location}`)
              // Treat redirect as failure and retry
              if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)))
                continue
              }
            }
            
            console.log(`[${generation.id}] Response status: ${response.status} ${response.statusText}`)
            
            if (response.ok) {
              console.log(`[${generation.id}] Background processing triggered successfully`)
              await appendDebugLog(generation.id, 'process:triggered')
              return
            }
            
            // TIER 1 FIX: Handle non-OK responses (like 401) - don't just silently exit
            // A 401 is a normal HTTP response, not an exception, so we must handle it explicitly
            const errorText = await response.text().catch(() => '')
            console.warn(`[${generation.id}] Trigger failed: ${response.status} ${response.statusText} ${errorText}`)
            
            if (i < retries - 1) {
              // Not last attempt - wait and retry
              await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)))
              continue
            }
            
            // TIER 1 FIX: Last attempt with non-OK response - mark generation as FAILED
            // This prevents "stuck forever" in processing state
            console.error(`[${generation.id}] All ${retries} retries exhausted with non-OK response, marking generation as failed`)
            await prisma.generation.update({
              where: { id: generation.id },
              data: { 
                status: 'failed',
                parameters: {
                  ...generationParameters,
                  error: `Failed to trigger processing: ${response.status} ${response.statusText}`,
                  triggerErrorText: errorText?.slice(0, 1000),
                }
              },
            }).catch(console.error)
            
            await appendDebugLog(generation.id, 'process:trigger-failed-http', { status: response.status, error: errorText?.slice(0, 200) })
            return // Exit after marking failed
            
          } catch (error: any) {
            // This catches network errors, timeouts, etc. (not HTTP error responses)
            const errorMessage = error.message || error.toString()
            const errorName = error.name || 'Unknown'
            const isTimeout = errorName === 'AbortError' || errorMessage.includes('abort') || errorMessage.includes('timeout')
            
            if (isTimeout) {
              // IMPORTANT: Timeout does NOT mean failure!
              // The process endpoint takes 30-60+ seconds to complete.
              // If we timed out, the request was likely received and is processing.
              // The frontend fallback and realtime subscriptions will handle completion.
              console.log(`[${generation.id}] Trigger timed out waiting for response - this is NORMAL`)
              console.log(`[${generation.id}] Processing is likely running. Frontend fallback will also trigger.`)
              
              await appendDebugLog(generation.id, 'process:trigger-timeout-expected', { note: 'Request likely received, processing continues' })
              
              // Do NOT mark as failed - let processing continue
              return
            }
            
            // Non-timeout exception (network error, etc.)
            console.error(`[${generation.id}] Background processing trigger attempt ${i + 1} failed (exception):`, {
              error: errorMessage,
              name: errorName,
              stack: error.stack,
              url: `${baseUrl}/api/generate/process`,
            })
            
            if (i === retries - 1) {
              console.error(`[${generation.id}] All retries exhausted (exception), marking generation as failed`)
              await prisma.generation.update({
                where: { id: generation.id },
                data: { 
                  status: 'failed',
                  parameters: {
                    ...generationParameters,
                    error: `Failed to start background processing: ${errorMessage}`,
                  }
                },
              }).catch(console.error)
              try {
                await appendDebugLog(generation.id, 'process:trigger-failed-exception', { error: errorMessage })
              } catch (_) {}
            } else {
              await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)))
            }
          }
        }
      }
      
      triggerProcessing().catch((error) => {
        console.error(`[${generation.id}] Background processing trigger failed completely:`, error)
        prisma.generation.update({
          where: { id: generation.id },
          data: { 
            status: 'failed',
            parameters: {
              ...generationParameters,
              error: 'Failed to start background processing',
            }
          },
        }).catch(console.error)
      })
    } else {
      console.log(`[${generation.id}] Queue mode enabled - awaiting worker pull`)
    }

    // Return immediately with processing status
    return respond({
      id: generation.id,
      status: 'processing',
      message: 'Generation started. Poll for updates.',
    })
  } catch (error: any) {
    console.error('Generation error:', error)
    metricStatus = 'error'
    statusCode = 500
    
    // Update generation status to failed if we created it
    if (generation) {
      await prisma.generation.update({
        where: { id: generation.id },
        data: { 
          status: 'failed',
          parameters: {
            ...(generation.parameters as any),
            error: error.message,
          }
        },
      }).catch(console.error)
    }
    
    return respond(
      { 
        id: generation?.id,
        status: 'failed',
        error: error.message || 'Generation failed' 
      },
      500
    )
  } finally {
    logMetric({
      name: 'api_generate_post',
      status: metricStatus,
      durationMs: Date.now() - startedAt,
      meta: {
        ...metricMeta,
        statusCode,
      },
    })
  }
}

