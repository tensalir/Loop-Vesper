import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { modelRegistry } from '@/lib/models/registry'

export const dynamic = 'force-dynamic'

// K-anonymity threshold: minimum unique users required before showing global stats
const K_ANON_THRESHOLD = 3

interface ProviderBreakdown {
  provider: string
  count: number
  percentage: number
}

interface TypeBreakdown {
  type: 'image' | 'video'
  count: number
  percentage: number
}

interface TopModel {
  modelId: string
  modelName: string
  provider: string
  type: 'image' | 'video'
  count: number
  percentage: number
}

/**
 * GET /api/analytics/global/usage
 * Returns anonymized, aggregated usage statistics across all users.
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

    // Count unique users who have generated content
    const uniqueUsersResult = await prisma.generation.groupBy({
      by: ['userId'],
      _count: true,
    })
    const uniqueUsers = uniqueUsersResult.length

    // K-anonymity check
    if (uniqueUsers < K_ANON_THRESHOLD) {
      return NextResponse.json({
        available: false,
        message: 'Not enough data yet. Global analytics require at least a few active users to ensure privacy.',
        cohort: {
          uniqueUsers,
          minUsersRequired: K_ANON_THRESHOLD,
        },
      })
    }

    // Get total generations (all users)
    const totalGenerations = await prisma.generation.count()

    // Get generations with images
    const imageGenerations = await prisma.generation.count({
      where: {
        outputs: {
          some: {
            fileType: 'image',
          },
        },
      },
    })

    // Get generations with videos
    const videoGenerations = await prisma.generation.count({
      where: {
        outputs: {
          some: {
            fileType: 'video',
          },
        },
      },
    })

    // Get model usage statistics (aggregated across all users)
    const modelUsage = await prisma.generation.groupBy({
      by: ['modelId'],
      _count: {
        modelId: true,
      },
      orderBy: {
        _count: {
          modelId: 'desc',
        },
      },
      take: 10, // Top 10 models
    })

    // Map model IDs to names with provider/type info
    const topModels: TopModel[] = modelUsage.map((usage) => {
      const model = modelRegistry.getModel(usage.modelId)
      const config = model?.getConfig()
      
      return {
        modelId: usage.modelId,
        modelName: config?.name || usage.modelId,
        provider: config?.provider || 'Unknown',
        type: (config?.type || 'image') as 'image' | 'video',
        count: usage._count.modelId,
        percentage: totalGenerations > 0 ? (usage._count.modelId / totalGenerations) * 100 : 0,
      }
    })

    // Calculate provider breakdown
    const providerCounts: Record<string, number> = {}
    for (const model of topModels) {
      const provider = model.provider
      providerCounts[provider] = (providerCounts[provider] || 0) + model.count
    }

    // For models not in top 10, we still need their counts for accurate provider breakdown
    // Use a simpler approach: group providers based on modelId patterns
    const allModelUsage = await prisma.generation.groupBy({
      by: ['modelId'],
      _count: {
        modelId: true,
      },
    })

    // Reset and recalculate with all models
    const allProviderCounts: Record<string, number> = {}
    for (const usage of allModelUsage) {
      const model = modelRegistry.getModel(usage.modelId)
      const config = model?.getConfig()
      const provider = config?.provider || 'Unknown'
      allProviderCounts[provider] = (allProviderCounts[provider] || 0) + usage._count.modelId
    }

    const byProvider: ProviderBreakdown[] = Object.entries(allProviderCounts)
      .map(([provider, count]) => ({
        provider,
        count,
        percentage: totalGenerations > 0 ? (count / totalGenerations) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)

    // Calculate type breakdown (image vs video)
    const byType: TypeBreakdown[] = [
      {
        type: 'image' as const,
        count: imageGenerations,
        percentage: totalGenerations > 0 ? (imageGenerations / totalGenerations) * 100 : 0,
      },
      {
        type: 'video' as const,
        count: videoGenerations,
        percentage: totalGenerations > 0 ? (videoGenerations / totalGenerations) * 100 : 0,
      },
    ]

    return NextResponse.json({
      available: true,
      totalGenerations,
      totalImages: imageGenerations,
      totalVideos: videoGenerations,
      topModels,
      byProvider,
      byType,
      cohort: {
        uniqueUsers,
        minUsersRequired: K_ANON_THRESHOLD,
      },
      // Note: No user identifiers, prompts, or output URLs are returned
    })
  } catch (error) {
    console.error('Error fetching global analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch global analytics' },
      { status: 500 }
    )
  }
}

