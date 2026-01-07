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
 * Process a single output analysis job
 */
async function processAnalysisJob(job: AnalysisJob): Promise<AnalysisResult> {
  const { id, outputId } = job

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

    // Step 3: Save results
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

    return { id, outputId, status: 'failed', error: error.message }
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

    // Process all jobs
    const results: AnalysisResult[] = []
    for (const job of jobs) {
      const result = await processAnalysisJob(job)
      results.push(result)
    }

    metricMeta.results = results.map(r => ({ id: r.id, status: r.status }))

    const completed = results.filter(r => r.status === 'completed').length
    const failed = results.filter(r => r.status === 'failed').length

    return NextResponse.json({
      processed: results.length,
      completed,
      failed,
      results,
    })
  } catch (error: any) {
    console.error('[Analysis Process] Error:', error)
    metricStatus = 'error'

    return NextResponse.json(
      { error: error.message || 'Analysis processing failed' },
      { status: 500 }
    )
  } finally {
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
    // Get queue statistics
    const stats = await (prisma as any).outputAnalysis.groupBy({
      by: ['status'],
      _count: { status: true },
    })

    const statusCounts: Record<string, number> = {}
    for (const stat of stats) {
      statusCounts[stat.status] = stat._count.status
    }

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
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get queue status' },
      { status: 500 }
    )
  }
}

