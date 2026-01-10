import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { modelRegistry } from '@/lib/models/registry'

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

    const userId = session.user.id

    // Get total generations
    const totalGenerations = await prisma.generation.count({
      where: { userId },
    })

    // Get image generations count
    const imageGenerations = await prisma.generation.count({
      where: {
        userId,
        outputs: {
          some: {
            fileType: 'image',
          },
        },
      },
    })

    // Get video generations count
    const videoGenerations = await prisma.generation.count({
      where: {
        userId,
        outputs: {
          some: {
            fileType: 'video',
          },
        },
      },
    })

    // Get model usage statistics
    const modelUsage = await prisma.generation.groupBy({
      by: ['modelId'],
      where: { userId },
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

    // Map model IDs to names and calculate percentages
    const topModels = modelUsage.map((usage) => {
      const config = modelRegistry.getModelConfig(usage.modelId)
      const count = usage._count.modelId
      const percentage = totalGenerations > 0 ? (count / totalGenerations) * 100 : 0

      return {
        modelId: usage.modelId,
        modelName: config?.name || usage.modelId,
        provider: config?.provider || 'Unknown',
        type: (config?.type || 'image') as 'image' | 'video',
        count,
        percentage,
      }
    })

    // Calculate provider breakdown from all user's generations
    const allModelUsage = await prisma.generation.groupBy({
      by: ['modelId'],
      where: { userId },
      _count: {
        modelId: true,
      },
    })

    const providerCounts: Record<string, number> = {}
    for (const usage of allModelUsage) {
      const config = modelRegistry.getModelConfig(usage.modelId)
      const provider = config?.provider || 'Unknown'
      providerCounts[provider] = (providerCounts[provider] || 0) + usage._count.modelId
    }

    const byProvider = Object.entries(providerCounts)
      .map(([provider, count]) => ({
        provider,
        count,
        percentage: totalGenerations > 0 ? (count / totalGenerations) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count)

    // Calculate type breakdown (image vs video)
    const byType = [
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
      totalGenerations,
      totalImages: imageGenerations,
      totalVideos: videoGenerations,
      topModels,
      byProvider,
      byType,
    })
  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}

