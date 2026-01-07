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

const GENERATION_QUEUE_ENABLED = process.env.GENERATION_QUEUE_ENABLED === 'true'
// Enable webhook-based generation for Replicate models (eliminates timeout issues)
// TEMPORARILY DISABLED: Webhook callbacks not being received from Replicate
// Re-enable once webhook delivery is confirmed working
const USE_REPLICATE_WEBHOOKS = process.env.USE_REPLICATE_WEBHOOKS === 'true' // Default: DISABLED until webhooks work

export async function POST(request: NextRequest) {
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
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return respond({ error: 'Unauthorized' }, 401)
    }

    const user = session.user

    // Parse request body
    const body = await request.json()
    const {
      sessionId,
      modelId,
      prompt,
      negativePrompt,
      parameters: requestParameters,
    } = body
    const rawParameters = requestParameters || {}
    const { referenceImage, referenceImages, referenceImageId, ...otherParameters } = rawParameters
    let referencePointer: Record<string, any> | null = null

    // Generate a unique ID for reference images (used before generation is created)
    const referenceGroupId = `refgrp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Handle multiple reference images (preferred) or single image (backward compatibility)
    if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
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
      // Single image (backward compatibility)
      metricMeta.hasReferenceImage = true
      referencePointer = await persistReferenceImage(referenceImage, user.id, referenceImageId)
    } else if (referenceImageId) {
      referencePointer = { referenceImageId }
    }

    const generationParameters = {
      ...otherParameters,
      ...(referencePointer || {}),
    }

    // Validate required fields
    metricMeta.sessionId = sessionId
    metricMeta.modelId = modelId

    if (!sessionId || !modelId || !prompt) {
      return respond(
        { error: 'Missing required fields: sessionId, modelId, prompt' },
        400
      )
    }

    // SECURITY: Verify user has access to this session via project ownership or membership
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'local-debug',hypothesisId:'A',location:'api/generate/route.ts:created',message:'Generation record created',data:{generationId:generation.id,modelId,prompt:prompt?.substring(0,50),useWebhooks:USE_REPLICATE_WEBHOOKS,supportsWebhook:supportsWebhook(modelId)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    metricMeta.generationId = generation.id
    if (GENERATION_QUEUE_ENABLED) {
      await prisma.generationJob.create({
        data: {
          generationId: generation.id,
        },
      })
      console.log(`[${generation.id}] Job enqueued for background processor`)
    }
    // Best-effort: add initial debug log
    try {
      const existing = await prisma.generation.findUnique({ where: { id: generation.id } })
      const prev = (existing?.parameters as any) || {}
      const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
      logs.push({ at: new Date().toISOString(), step: 'generate:create' })
      await prisma.generation.update({
        where: { id: generation.id },
        data: { parameters: { ...prev, debugLogs: logs.slice(-100), lastStep: 'generate:create' } },
      })
    } catch (_) {}

    if (!GENERATION_QUEUE_ENABLED) {
      const baseUrl = request.nextUrl.origin
      
      // #region agent log
      console.log(`[DEBUG:A] Generation flow: id=${generation.id}, model=${modelId}, USE_WEBHOOKS=${USE_REPLICATE_WEBHOOKS}, supportsWebhook=${supportsWebhook(modelId)}, willUseWebhook=${USE_REPLICATE_WEBHOOKS && supportsWebhook(modelId)}`)
      // #endregion
      
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
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'local-debug',hypothesisId:'A',location:'api/generate/route.ts:triggerProcess',message:'About to call process endpoint',data:{generationId:generation.id,baseUrl},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      
      const triggerProcessing = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const processUrl = `${baseUrl}/api/generate/process`
            console.log(`[${generation.id}] Attempt ${i + 1}/${retries}: Calling ${processUrl}`)
            
            // Debug: Log whether secret is available
            const hasSecret = Boolean(process.env.INTERNAL_API_SECRET)
            const secretPreview = process.env.INTERNAL_API_SECRET 
              ? `${process.env.INTERNAL_API_SECRET.substring(0, 4)}...${process.env.INTERNAL_API_SECRET.substring(process.env.INTERNAL_API_SECRET.length - 4)}`
              : 'NOT SET'
            console.log(`[${generation.id}] Internal secret available: ${hasSecret}, preview: ${secretPreview}`)
            
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
              try {
                const existing = await prisma.generation.findUnique({ where: { id: generation.id } })
                const prev = (existing?.parameters as any) || {}
                const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
                logs.push({ at: new Date().toISOString(), step: 'process:triggered' })
                await prisma.generation.update({
                  where: { id: generation.id },
                  data: { parameters: { ...prev, debugLogs: logs.slice(-100), lastStep: 'process:triggered' } },
                })
              } catch (_) {}
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
            
            try {
              const existing = await prisma.generation.findUnique({ where: { id: generation.id } })
              const prev = (existing?.parameters as any) || {}
              const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
              logs.push({ at: new Date().toISOString(), step: 'process:trigger-failed-http', status: response.status, error: errorText?.slice(0, 200) })
              await prisma.generation.update({
                where: { id: generation.id },
                data: { parameters: { ...prev, debugLogs: logs.slice(-100), lastStep: 'process:trigger-failed-http' } },
              })
            } catch (_) {}
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
              
              try {
                const existing = await prisma.generation.findUnique({ where: { id: generation.id } })
                const prev = (existing?.parameters as any) || {}
                const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
                logs.push({ at: new Date().toISOString(), step: 'process:trigger-timeout-expected', note: 'Request likely received, processing continues' })
                await prisma.generation.update({
                  where: { id: generation.id },
                  data: { parameters: { ...prev, debugLogs: logs.slice(-100), lastStep: 'process:trigger-timeout-expected' } },
                })
              } catch (_) {}
              
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
                const existing = await prisma.generation.findUnique({ where: { id: generation.id } })
                const prev = (existing?.parameters as any) || {}
                const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
                logs.push({ at: new Date().toISOString(), step: 'process:trigger-failed-exception', error: errorMessage })
                await prisma.generation.update({
                  where: { id: generation.id },
                  data: { parameters: { ...prev, debugLogs: logs.slice(-100), lastStep: 'process:trigger-failed-exception' } },
                })
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

