import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildRenderPlan, buildFFmpegArgs, type TimelineSnapshot } from '@/lib/timeline/render-graph'

export const dynamic = 'force-dynamic'

/**
 * POST /api/timeline/render/process
 *
 * Background render processor for timeline sequences.
 *
 * In production, this should be deployed as a long-running worker (not a Vercel
 * function) with FFmpeg installed. For V1 we define the full orchestration flow:
 *
 * 1. Claim a queued render job
 * 2. Build the FFmpeg filter graph from the frozen snapshot
 * 3. Execute FFmpeg composition
 * 4. Upload result to Supabase Storage
 * 5. Create generation + output records for gallery integration
 * 6. Mark job complete
 *
 * The Vercel endpoint acts as the entry point / job claimer. Actual FFmpeg execution
 * requires a worker environment.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()

  try {
    // Auth: internal secret or authenticated user
    const internalSecret = request.headers.get('x-internal-secret')
    const expectedSecret = process.env.INTERNAL_API_SECRET

    if (!internalSecret || internalSecret !== expectedSecret) {
      const { createRouteHandlerClient } = await import('@supabase/auth-helpers-nextjs')
      const { cookies } = await import('next/headers')
      const supabase = createRouteHandlerClient({ cookies })
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const body = await request.json().catch(() => ({}))
    const renderJobId: string | undefined = body.renderJobId

    let job: any

    if (renderJobId) {
      job = await prisma.timelineRenderJob.findUnique({
        where: { id: renderJobId },
      })
    } else {
      // Claim the oldest queued job
      const queued = await prisma.timelineRenderJob.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      })
      if (!queued) {
        return NextResponse.json({ message: 'No queued render jobs' })
      }
      job = queued
    }

    if (!job) {
      return NextResponse.json({ error: 'Render job not found' }, { status: 404 })
    }

    if (job.status !== 'queued') {
      return NextResponse.json({
        message: `Job ${job.id} is already ${job.status}`,
        skipped: true,
      })
    }

    // Mark as processing
    await prisma.timelineRenderJob.update({
      where: { id: job.id },
      data: { status: 'processing', progress: 5 },
    })

    try {
      const snapshot = job.snapshotJson as TimelineSnapshot
      if (!snapshot || !snapshot.tracks) {
        throw new Error('Invalid snapshot: missing timeline data')
      }

      // Build render plan
      const plan = buildRenderPlan(snapshot, job.resolution)

      // Update progress
      await prisma.timelineRenderJob.update({
        where: { id: job.id },
        data: { progress: 15 },
      })

      // Build FFmpeg command (for external worker execution)
      const outputFilename = `timeline-${job.id}.mp4`
      const ffmpegArgs = buildFFmpegArgs(plan, outputFilename)

      // Store the computed render plan for the worker to pick up
      await prisma.timelineRenderJob.update({
        where: { id: job.id },
        data: {
          progress: 20,
          snapshotJson: {
            ...(job.snapshotJson as any),
            _renderPlan: {
              inputs: plan.inputs,
              filterComplex: plan.filterComplex,
              outputArgs: plan.outputArgs,
              ffmpegArgs,
              outputFilename,
              totalDurationMs: plan.totalDurationMs,
            },
          },
        },
      })

      /**
       * WORKER HANDOFF POINT
       *
       * In production, the actual FFmpeg execution happens in a separate worker
       * process with access to FFmpeg binary and sufficient compute time.
       *
       * The worker:
       * 1. Reads the render job with status='processing' and _renderPlan
       * 2. Downloads all input files
       * 3. Runs FFmpeg with the computed args
       * 4. Uploads the output to Supabase Storage
       * 5. Creates Generation + Output records
       * 6. Updates the job to status='completed'
       *
       * For now, we return the render plan so a client/worker can execute it.
       */

      return NextResponse.json({
        renderJobId: job.id,
        status: 'processing',
        renderPlan: {
          inputCount: plan.inputs.length,
          filterComplexLength: plan.filterComplex.length,
          totalDurationMs: plan.totalDurationMs,
          ffmpegArgs,
        },
        message: 'Render plan computed. Awaiting worker execution.',
      })
    } catch (renderError: any) {
      console.error(`[Render ${job.id}] Error:`, renderError)

      await prisma.timelineRenderJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: renderError.message || 'Render failed',
        },
      })

      return NextResponse.json(
        { error: renderError.message || 'Render failed', renderJobId: job.id },
        { status: 500 }
      )
    }
  } catch (error: any) {
    console.error('Render process error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process render' },
      { status: 500 }
    )
  }
}
