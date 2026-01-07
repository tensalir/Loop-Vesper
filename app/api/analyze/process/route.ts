import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { captionOutput } from '@/lib/analysis/gemini'
import { parseCaption } from '@/lib/analysis/claude'
import { logMetric } from '@/lib/metrics'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

// Configuration
const ANALYSIS_BATCH_SIZE = Number(process.env.ANALYSIS_BATCH_SIZE || '5')
const ANALYSIS_LOCK_TIMEOUT_MS = Number(process.env.ANALYSIS_LOCK_TIMEOUT_MS || 120_000) // 2 minutes
const ANALYSIS_RETRY_DELAY_MS = Number(process.env.ANALYSIS_RETRY_DELAY_MS || 60_000) // 1 minute
const ANALYSIS_MAX_ATTEMPTS = Number(process.env.ANALYSIS_MAX_ATTEMPTS || '3')

interface AnalysisJob {
  id: string
  outputId: string
}

interface AnalysisResult {
  id: string
  outputId: string
  status: 'completed' | 'failed' | 'skipped'
  error?: string
}

/**
 * Claim a batch of OutputAnalysis rows for processing
 */
async function claimAnalysisJobs(batchSize: number): Promise<AnalysisJob[]> {
  const now = new Date()
  const lockExpiry = new Date(now.getTime() - ANALYSIS_LOCK_TIMEOUT_MS)

  return prisma.$transaction(async (tx) => {
    // Find jobs that are:
    // - queued/failed with no lock, OR
    // - locked but lock expired
    // AND: runAfter is null or in the past
    // AND: attempts < max
    const jobs = await (tx as any).outputAnalysis.findMany({
      where: {
        OR: [
          { status: 'queued', lockedAt: null },
          { status: 'failed', lockedAt: null, attempts: { lt: ANALYSIS_MAX_ATTEMPTS } },
          { lockedAt: { lt: lockExpiry } },
        ],
        AND: [
          { OR: [{ runAfter: null }, { runAfter: { lte: now } }] },
          { attempts: { lt: ANALYSIS_MAX_ATTEMPTS } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
      select: { id: true, outputId: true },
    })

    // Lock claimed jobs
    const claimed: AnalysisJob[] = []
    for (const job of jobs) {
      await (tx as any).outputAnalysis.update({
        where: { id: job.id },
        data: {
          lockedAt: now,
          status: 'processing',
          attempts: { increment: 1 },
        },
      })
      claimed.push({ id: job.id, outputId: job.outputId })
    }

    return claimed
  })
}

/**
 * Safely release lock on a job, ensuring it's never stuck
 */
async function releaseJobLock(jobId: string, error?: string): Promise<void> {
  try {
    const analysisRecord = await (prisma as any).outputAnalysis.findUnique({
      where: { id: jobId },
      select: { attempts: true, status: true },
    })

    if (!analysisRecord) {
      console.warn(`[Analysis ${jobId}] Record not found when releasing lock`)
      return
    }

    // Only release lock if still in processing state (avoid race conditions)
    if (analysisRecord.status === 'processing') {
      const attempts = analysisRecord.attempts || 1
      const shouldRetry = attempts < ANALYSIS_MAX_ATTEMPTS

      await (prisma as any).outputAnalysis.update({
        where: { id: jobId },
        data: {
          status: shouldRetry ? 'queued' : 'failed',
          error: error?.slice(0, 1000) || 'Processing interrupted',
          lockedAt: null,
          runAfter: shouldRetry ? new Date(Date.now() + ANALYSIS_RETRY_DELAY_MS) : null,
        },
      })

      console.log(`[Analysis ${jobId}] 🔓 Lock released (will ${shouldRetry ? 'retry' : 'fail'})`)
    }
  } catch (releaseError: any) {
    // Last resort: try to release lock with minimal update
    console.error(`[Analysis ${jobId}] Failed to release lock:`, releaseError.message)
    try {
      await (prisma as any).outputAnalysis.update({
        where: { id: jobId },
        data: { lockedAt: null, status: 'queued' },
      }).catch(() => {}) // Ignore errors in last resort
    } catch {}
  }
}

/**
 * Process a single output analysis job
 * Wrapped with try-finally to ensure lock is always released
 */
async function processAnalysisJob(job: AnalysisJob): Promise<AnalysisResult> {
  const { id, outputId } = job
  let lockReleased = false

  try {
    // Fetch the output with its generation context
    const output = await prisma.output.findUnique({
      where: { id: outputId },
      include: {
        generation: {
          select: {
            modelId: true,
            prompt: true,
          },
        },
        bookmarks: {
          select: { id: true },
          take: 1,
        },
      },
    })

    if (!output) {
      // Output was deleted, mark analysis as failed
      await (prisma as any).outputAnalysis.update({
        where: { id },
        data: {
          status: 'failed',
          error: 'Output not found (may have been deleted)',
          lockedAt: null,
        },
      })
      lockReleased = true
      return { id, outputId, status: 'failed', error: 'Output not found' }
    }

    console.log(`[Analysis ${id}] Captioning ${output.fileType}: ${output.fileUrl.slice(0, 60)}...`)

    // Step 1: Get Gemini caption
    const captionResult = await captionOutput(
      output.fileUrl,
      output.fileType as 'image' | 'video'
    )

    console.log(`[Analysis ${id}] Got caption (${captionResult.caption.length} chars), parsing with Claude...`)

    // Step 2: Parse with Claude
    const parseResult = await parseCaption(captionResult.caption, {
      fileType: output.fileType as 'image' | 'video',
      modelId: output.generation.modelId,
      prompt: output.generation.prompt,
      isApproved: output.isApproved,
      isBookmarked: output.bookmarks.length > 0,
    })

    console.log(`[Analysis ${id}] Parsed successfully, saving results...`)

    // Step 3: Save results and release lock
    await (prisma as any).outputAnalysis.update({
      where: { id },
      data: {
        status: 'completed',
        geminiCaption: captionResult.caption,
        geminiModel: captionResult.model,
        claudeParsed: parseResult.parsed,
        claudeModel: parseResult.model,
        completedAt: new Date(),
        lockedAt: null,
        error: null,
      },
    })

    lockReleased = true
    console.log(`[Analysis ${id}] ✅ Completed`)

    return { id, outputId, status: 'completed' }
  } catch (error: any) {
    console.error(`[Analysis ${id}] ❌ Failed:`, error.message)

    // Update with error and release lock
    const analysisRecord = await (prisma as any).outputAnalysis.findUnique({
      where: { id },
      select: { attempts: true },
    })

    const attempts = analysisRecord?.attempts || 1
    const shouldRetry = attempts < ANALYSIS_MAX_ATTEMPTS

    await (prisma as any).outputAnalysis.update({
      where: { id },
      data: {
        status: shouldRetry ? 'queued' : 'failed',
        error: error.message?.slice(0, 1000) || 'Unknown error',
        lockedAt: null,
        runAfter: shouldRetry ? new Date(Date.now() + ANALYSIS_RETRY_DELAY_MS) : null,
      },
    })

    lockReleased = true
    return { id, outputId, status: 'failed', error: error.message }
  } finally {
    // Safety net: ensure lock is always released, even if something goes wrong
    if (!lockReleased) {
      console.warn(`[Analysis ${id}] Lock not released in normal flow, releasing in finally block`)
      await releaseJobLock(id, 'Processing error - lock released in finally block')
    }
  }
}

/**
 * POST /api/analyze/process
 * 
 * Process queued output analyses.
 * Can be called with a specific outputId or will claim a batch from the queue.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let metricStatus: 'success' | 'error' = 'success'
  const metricMeta: Record<string, any> = {}

  // Auth: Allow internal calls via secret header OR admin users
  const internalSecret = request.headers.get('x-internal-secret')
  const expectedSecret = process.env.INTERNAL_API_SECRET

  const isInternalCall = internalSecret && expectedSecret && internalSecret === expectedSecret

  if (!isInternalCall) {
    // Check for admin auth
    try {
      const { createRouteHandlerClient } = await import('@supabase/auth-helpers-nextjs')
      const { cookies } = await import('next/headers')
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Check admin role
      const profile = await prisma.profile.findUnique({
        where: { id: session.user.id },
        select: { role: true },
      })

      if (profile?.role !== 'admin') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      }
    } catch (authError: any) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { outputId } = body

    let jobs: AnalysisJob[] = []

    if (outputId) {
      // Process specific output
      const analysis = await (prisma as any).outputAnalysis.findUnique({
        where: { outputId },
        select: { id: true, outputId: true, status: true },
      })

      if (!analysis) {
        return NextResponse.json({ error: 'Analysis not found for output' }, { status: 404 })
      }

      if (analysis.status === 'completed') {
        return NextResponse.json({ 
          message: 'Analysis already completed',
          outputId,
          status: 'skipped',
        })
      }

      // Lock and process
      await (prisma as any).outputAnalysis.update({
        where: { id: analysis.id },
        data: {
          lockedAt: new Date(),
          status: 'processing',
          attempts: { increment: 1 },
        },
      })

      jobs = [{ id: analysis.id, outputId: analysis.outputId }]
      metricMeta.mode = 'single'
      metricMeta.outputId = outputId
    } else {
      // Claim batch from queue
      jobs = await claimAnalysisJobs(ANALYSIS_BATCH_SIZE)
      metricMeta.mode = 'batch'
      metricMeta.claimed = jobs.length
    }

    if (jobs.length === 0) {
      return NextResponse.json({
        message: 'No analyses queued',
        processed: 0,
      })
    }

    // Fire-and-forget: return immediately and process in background
    // This ensures processing continues even if client disconnects
    const processJobs = async () => {
      const processStartedAt = Date.now()
      const results: AnalysisResult[] = []
      let processMetricStatus: 'success' | 'error' = 'success'

      try {
        console.log(`[Analysis Process] Starting batch processing of ${jobs.length} job(s)`)
        
        // Process all jobs sequentially
        for (const job of jobs) {
          try {
            const result = await processAnalysisJob(job)
            results.push(result)
          } catch (jobError: any) {
            console.error(`[Analysis Process] Job ${job.id} failed with unhandled error:`, jobError)
            // Ensure lock is released even for unexpected errors
            await releaseJobLock(job.id, jobError.message || 'Unexpected error')
            results.push({ 
              id: job.id, 
              outputId: job.outputId, 
              status: 'failed', 
              error: jobError.message 
            })
          }
        }

        const completed = results.filter(r => r.status === 'completed').length
        const failed = results.filter(r => r.status === 'failed').length

        console.log(`[Analysis Process] Batch completed: ${completed} succeeded, ${failed} failed`)

        // Log metrics after processing completes
        logMetric({
          name: 'api_analyze_process_background',
          status: processMetricStatus,
          durationMs: Date.now() - processStartedAt,
          meta: {
            ...metricMeta,
            results: results.map(r => ({ id: r.id, status: r.status })),
            completed,
            failed,
          },
        })
      } catch (error: any) {
        console.error('[Analysis Process] Background processing error:', error)
        processMetricStatus = 'error'
        
        // Emergency cleanup: release all locks
        for (const job of jobs) {
          await releaseJobLock(job.id, 'Background processing failed').catch(() => {})
        }

        logMetric({
          name: 'api_analyze_process_background',
          status: 'error',
          durationMs: Date.now() - processStartedAt,
          meta: { ...metricMeta, error: error.message },
        })
      }
    }

    // Start background processing (don't await)
    processJobs().catch((error) => {
      // Last resort error handler
      console.error('[Analysis Process] Fatal error in background processing:', error)
    })

    // Return immediately - processing continues in background
    metricMeta.claimed = jobs.length
    metricMeta.mode = metricMeta.mode || 'batch'
    
    return NextResponse.json({
      message: 'Processing started',
      claimed: jobs.length,
      note: 'Processing continues in background. Check status endpoint for progress.',
    })
  } catch (error: any) {
    console.error('[Analysis Process] Error:', error)
    metricStatus = 'error'

    return NextResponse.json(
      { error: error.message || 'Analysis processing failed' },
      { status: 500 }
    )
  } finally {
    // Log initial request metric (processing happens in background)
    logMetric({
      name: 'api_analyze_process',
      status: metricStatus,
      durationMs: Date.now() - startedAt,
      meta: metricMeta,
    })
  }
}

/**
 * GET /api/analyze/process
 * 
 * Get status of analysis queue
 */
export async function GET(request: NextRequest) {
  // Allow internal calls or admin users
  const internalSecret = request.headers.get('x-internal-secret')
  const expectedSecret = process.env.INTERNAL_API_SECRET
  const isInternalCall = internalSecret && expectedSecret && internalSecret === expectedSecret

  if (!isInternalCall) {
    try {
      const { createRouteHandlerClient } = await import('@supabase/auth-helpers-nextjs')
      const { cookies } = await import('next/headers')
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const profile = await prisma.profile.findUnique({
        where: { id: session.user.id },
        select: { role: true },
      })

      if (profile?.role !== 'admin') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
      }
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const now = new Date()
    const lockExpiry = new Date(now.getTime() - ANALYSIS_LOCK_TIMEOUT_MS)

    // Get queue statistics
    const stats = await (prisma as any).outputAnalysis.groupBy({
      by: ['status'],
      _count: { status: true },
    })

    const statusCounts: Record<string, number> = {}
    for (const stat of stats) {
      statusCounts[stat.status] = stat._count.status
    }

    // Get stuck jobs (locked but expired)
    const stuckJobs = await (prisma as any).outputAnalysis.findMany({
      where: {
        status: 'processing',
        lockedAt: { lt: lockExpiry },
      },
      select: {
        id: true,
        outputId: true,
        lockedAt: true,
        attempts: true,
      },
      take: 10, // Limit to first 10 for display
    })

    // Get all locked jobs (including non-expired)
    const lockedJobs = await (prisma as any).outputAnalysis.findMany({
      where: {
        status: 'processing',
        lockedAt: { not: null },
      },
      select: {
        id: true,
        lockedAt: true,
        attempts: true,
      },
    })

    const totalOutputs = await prisma.output.count()
    const analyzedOutputs = await (prisma as any).outputAnalysis.count({
      where: { status: 'completed' },
    })

    return NextResponse.json({
      queue: statusCounts,
      total: {
        outputs: totalOutputs,
        analyzed: analyzedOutputs,
        pending: totalOutputs - analyzedOutputs,
      },
      locked: {
        total: lockedJobs.length,
        expired: stuckJobs.length,
        expiredJobs: stuckJobs.map((job: any) => ({
          id: job.id,
          outputId: job.outputId,
          lockedAt: job.lockedAt?.toISOString(),
          ageMs: job.lockedAt ? now.getTime() - new Date(job.lockedAt).getTime() : 0,
          attempts: job.attempts,
        })),
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get queue status' },
      { status: 500 }
    )
  }
}

