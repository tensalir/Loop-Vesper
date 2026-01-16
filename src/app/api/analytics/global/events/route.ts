import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { modelRegistry } from '@/lib/models/registry'

export const dynamic = 'force-dynamic'

// K-anonymity threshold: minimum unique users required before showing global stats
const K_ANON_THRESHOLD = 3

interface ModelDownloadStats {
  modelId: string
  modelName: string
  provider: string
  type: 'image' | 'video'
  downloadCount: number
  outputCount: number
  downloadRate: number // percentage of outputs that were downloaded
}

interface EventTypeSummary {
  eventType: string
  count: number
  uniqueOutputs: number
  uniqueUsers: number
}

/**
 * GET /api/analytics/global/events
 * Returns aggregated download/event statistics across all users.
 * This data helps understand which model/prompt combinations produce
 * outputs that users find valuable enough to download.
 * Enforces k-anonymity: only returns data if enough unique users exist.
 */
export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Count unique users who have downloaded content
    const uniqueDownloadUsers = await prisma.outputEvent.groupBy({
      by: ['userId'],
      where: { eventType: 'download' },
    })

    // K-anonymity check based on users who have downloaded
    if (uniqueDownloadUsers.length < K_ANON_THRESHOLD) {
      return NextResponse.json({
        available: false,
        message: 'Not enough download data yet. Quality signals require at least a few active users.',
        cohort: {
          uniqueUsers: uniqueDownloadUsers.length,
          minUsersRequired: K_ANON_THRESHOLD,
        },
      })
    }

    // Get total event counts by type
    const eventTypeCounts = await prisma.outputEvent.groupBy({
      by: ['eventType'],
      _count: { eventType: true },
    })

    // Get unique outputs and users per event type
    const eventTypeSummaries: EventTypeSummary[] = await Promise.all(
      eventTypeCounts.map(async (et) => {
        const uniqueOutputs = await prisma.outputEvent.groupBy({
          by: ['outputId'],
          where: { eventType: et.eventType },
        })
        const uniqueUsers = await prisma.outputEvent.groupBy({
          by: ['userId'],
          where: { eventType: et.eventType },
        })
        return {
          eventType: et.eventType,
          count: et._count.eventType,
          uniqueOutputs: uniqueOutputs.length,
          uniqueUsers: uniqueUsers.length,
        }
      })
    )

    // Get download counts by model (joining through output -> generation)
    // This is the key quality signal
    const downloadsByModel = await prisma.$queryRaw<
      Array<{ modelId: string; downloadCount: bigint; outputCount: bigint }>
    >`
      SELECT 
        g."model_id" as "modelId",
        COUNT(DISTINCT e.id) as "downloadCount",
        COUNT(DISTINCT o.id) as "outputCount"
      FROM output_events e
      JOIN outputs o ON e.output_id = o.id
      JOIN generations g ON o.generation_id = g.id
      WHERE e.event_type = 'download'
      GROUP BY g."model_id"
      ORDER BY "downloadCount" DESC
      LIMIT 15
    `

    // Also get total output counts per model for calculating download rates
    const totalOutputsByModel = await prisma.$queryRaw<
      Array<{ modelId: string; totalOutputs: bigint }>
    >`
      SELECT 
        g."model_id" as "modelId",
        COUNT(o.id) as "totalOutputs"
      FROM outputs o
      JOIN generations g ON o.generation_id = g.id
      GROUP BY g."model_id"
    `

    const totalOutputsMap = new Map(
      totalOutputsByModel.map((m) => [m.modelId, Number(m.totalOutputs)])
    )

    // Map model IDs to names with provider/type info and calculate download rates
    const modelDownloadStats: ModelDownloadStats[] = downloadsByModel.map((usage) => {
      const config = modelRegistry.getModelConfig(usage.modelId)
      const totalOutputs = totalOutputsMap.get(usage.modelId) || 0
      const downloadCount = Number(usage.downloadCount)

      return {
        modelId: usage.modelId,
        modelName: config?.name || usage.modelId,
        provider: config?.provider || 'Unknown',
        type: (config?.type || 'image') as 'image' | 'video',
        downloadCount,
        outputCount: totalOutputs,
        downloadRate: totalOutputs > 0 ? (downloadCount / totalOutputs) * 100 : 0,
      }
    })

    // Sort by download rate (quality signal) - which models produce the most "keeper" outputs
    const byDownloadRate = [...modelDownloadStats].sort(
      (a, b) => b.downloadRate - a.downloadRate
    )

    // Get total counts
    const totalDownloads = eventTypeSummaries.find((e) => e.eventType === 'download')?.count || 0
    const totalOutputsWithDownloads =
      eventTypeSummaries.find((e) => e.eventType === 'download')?.uniqueOutputs || 0
    const totalOutputs = await prisma.output.count()

    return NextResponse.json({
      available: true,
      summary: {
        totalDownloads,
        totalOutputsWithDownloads,
        totalOutputs,
        overallDownloadRate: totalOutputs > 0 ? (totalOutputsWithDownloads / totalOutputs) * 100 : 0,
      },
      eventTypes: eventTypeSummaries,
      byModel: modelDownloadStats, // Sorted by download count
      byDownloadRate, // Sorted by download rate (quality signal)
      cohort: {
        uniqueDownloadUsers: uniqueDownloadUsers.length,
        minUsersRequired: K_ANON_THRESHOLD,
      },
    })
  } catch (error) {
    console.error('Error fetching event analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch event analytics' },
      { status: 500 }
    )
  }
}
