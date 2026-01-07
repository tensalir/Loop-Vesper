import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

// Batch size for backfill operations
const BACKFILL_BATCH_SIZE = Number(process.env.ANALYSIS_BACKFILL_BATCH_SIZE || '100')

/**
 * POST /api/admin/analysis/backfill
 * 
 * Enqueue all historical outputs that don't have analysis records.
 * Admin-only endpoint.
 */
export async function POST(request: NextRequest) {
  const startedAt = Date.now()
  let metricStatus: 'success' | 'error' = 'success'

  try {
    // Auth check - admin only
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Parse options from body
    const body = await request.json().catch(() => ({}))
    const { limit = BACKFILL_BATCH_SIZE, triggerProcess = false } = body

    // Find outputs without analysis records using a subquery approach
    // Get all output IDs that already have analysis
    const existingAnalyses = await (prisma as any).outputAnalysis.findMany({
      select: { outputId: true },
    })
    const analyzedOutputIds = new Set(existingAnalyses.map((a: { outputId: string }) => a.outputId))

    // Get outputs that don't have analysis
    const outputsToAnalyze = await prisma.output.findMany({
      where: {
        id: {
          notIn: Array.from(analyzedOutputIds) as string[],
        },
      },
      select: { id: true },
      take: limit,
      orderBy: { createdAt: 'desc' }, // Most recent first
    })

    if (outputsToAnalyze.length === 0) {
      return NextResponse.json({
        message: 'All outputs already have analysis records queued',
        enqueued: 0,
      })
    }

    // Create OutputAnalysis records for all found outputs
    const result = await (prisma as any).outputAnalysis.createMany({
      data: outputsToAnalyze.map((output: { id: string }) => ({
        outputId: output.id,
        status: 'queued',
      })),
      skipDuplicates: true,
    })

    console.log(`[Backfill] Enqueued ${result.count} outputs for semantic analysis`)

    // Optionally trigger the processor
    if (triggerProcess && result.count > 0) {
      try {
        const baseUrl = request.nextUrl.origin
        fetch(`${baseUrl}/api/analyze/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.INTERNAL_API_SECRET && {
              'x-internal-secret': process.env.INTERNAL_API_SECRET,
            }),
          },
        }).catch(() => {
          // Fire and forget
        })
        console.log('[Backfill] Triggered analysis processor')
      } catch {
        // Ignore trigger failures
      }
    }

    // Get remaining count for progress info
    const totalOutputs = await prisma.output.count()
    const totalAnalyzed = await (prisma as any).outputAnalysis.count()
    const remaining = totalOutputs - totalAnalyzed

    return NextResponse.json({
      message: `Enqueued ${result.count} outputs for analysis`,
      enqueued: result.count,
      progress: {
        total: totalOutputs,
        queued: totalAnalyzed,
        remaining,
      },
    })
  } catch (error: any) {
    console.error('[Backfill] Error:', error)
    metricStatus = 'error'

    return NextResponse.json(
      { error: error.message || 'Backfill failed' },
      { status: 500 }
    )
  } finally {
    logMetric({
      name: 'api_admin_analysis_backfill',
      status: metricStatus,
      durationMs: Date.now() - startedAt,
    })
  }
}

/**
 * GET /api/admin/analysis/backfill
 * 
 * Get backfill progress/status.
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check - admin only
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get statistics
    const totalOutputs = await prisma.output.count()

    const analysisByStatus = await (prisma as any).outputAnalysis.groupBy({
      by: ['status'],
      _count: { status: true },
    })

    const statusCounts: Record<string, number> = {}
    let totalAnalysisRecords = 0
    for (const stat of analysisByStatus) {
      statusCounts[stat.status] = stat._count.status
      totalAnalysisRecords += stat._count.status
    }

    const pendingBackfill = totalOutputs - totalAnalysisRecords

    return NextResponse.json({
      totalOutputs,
      analysis: {
        total: totalAnalysisRecords,
        byStatus: statusCounts,
      },
      pendingBackfill,
      percentComplete: totalOutputs > 0 
        ? Math.round((totalAnalysisRecords / totalOutputs) * 100) 
        : 100,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    )
  }
}

