import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getModel } from '@/lib/models/registry'
import { logMetric } from '@/lib/metrics'
import { persistReferenceImage } from '@/lib/reference-images'

const GENERATION_QUEUE_ENABLED = process.env.GENERATION_QUEUE_ENABLED === 'true'

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

    // Handle multiple reference images (preferred) or single image (backward compatibility)
    if (referenceImages && Array.isArray(referenceImages) && referenceImages.length > 0) {
      // Multiple images - persist all of them
      metricMeta.hasReferenceImage = true
      metricMeta.referenceImageCount = referenceImages.length
      // For now, persist all images and pass them through
      // We'll store them as an array in the parameters
      referencePointer = {
        referenceImages: referenceImages, // Pass through as-is for now
        // If needed, we could persist each one separately
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
      // Trigger background processing asynchronously (fire and forget)
      // Don't await - this allows us to return immediately
      // Use retry logic for serverless environments where internal fetches can fail
      // In Vercel, use VERCEL_URL for internal calls, but ensure it has protocol
      let baseUrl: string
      if (process.env.VERCEL_URL) {
        baseUrl = process.env.VERCEL_URL.startsWith('http') 
          ? process.env.VERCEL_URL 
          : `https://${process.env.VERCEL_URL}`
      } else if (process.env.NEXT_PUBLIC_VERCEL_URL) {
        baseUrl = process.env.NEXT_PUBLIC_VERCEL_URL.startsWith('http')
          ? process.env.NEXT_PUBLIC_VERCEL_URL
          : `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      } else {
        baseUrl = request.nextUrl.origin
      }
      
      console.log(`[${generation.id}] Triggering background process at: ${baseUrl}/api/generate/process`)
      
      const triggerProcessing = async (retries = 3) => {
        for (let i = 0; i < retries; i++) {
          try {
            const processUrl = `${baseUrl}/api/generate/process`
            console.log(`[${generation.id}] Attempt ${i + 1}: Calling ${processUrl}`)
            
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/e6034d14-134b-41df-97f8-0c4119e294f2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H1',location:'app/api/generate/route.ts:triggerProcessing',message:'internal trigger fetch',data:{generationId:generation.id,baseUrl,processUrl,hasInternalApiSecret:Boolean(process.env.INTERNAL_API_SECRET)},timestamp:Date.now()})}).catch(()=>{});
            // #endregion
            
            const response = await fetch(processUrl, {
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
              signal: AbortSignal.timeout(10000),
            })
            
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
            
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)))
              continue
            }
          } catch (error: any) {
            const errorMessage = error.message || error.toString()
            const errorName = error.name || 'Unknown'
            console.error(`[${generation.id}] Background processing trigger attempt ${i + 1} failed:`, {
              error: errorMessage,
              name: errorName,
              stack: error.stack,
              url: `${baseUrl}/api/generate/process`,
            })
            
            if (i === retries - 1) {
              console.error(`[${generation.id}] All retries exhausted, marking generation as failed`)
              await prisma.generation.update({
                where: { id: generation.id },
                data: { 
                  status: 'failed',
                  parameters: {
                    ...generationParameters,
                    error: 'Failed to start background processing after retries',
                  }
                },
              }).catch(console.error)
              try {
                const existing = await prisma.generation.findUnique({ where: { id: generation.id } })
                const prev = (existing?.parameters as any) || {}
                const logs = Array.isArray(prev.debugLogs) ? prev.debugLogs : []
                logs.push({ at: new Date().toISOString(), step: 'process:trigger-failed', error: error?.message })
                await prisma.generation.update({
                  where: { id: generation.id },
                  data: { parameters: { ...prev, debugLogs: logs.slice(-100), lastStep: 'process:trigger-failed' } },
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

