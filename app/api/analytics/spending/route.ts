import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { modelRegistry } from '@/lib/models/registry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/spending
 * Returns spending breakdown by provider/model (admin only)
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

    // SECURITY: Only admins can view spending
    const profile = await prisma.profile.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 })
    }

    // Get all completed generations with costs
    const generations = await prisma.generation.findMany({
      where: {
        status: 'completed',
        cost: {
          not: null,
        },
      },
      select: {
        id: true,
        modelId: true,
        cost: true,
        createdAt: true,
        outputs: {
          select: {
            fileType: true,
            duration: true,
          },
        },
      },
    })

    // Calculate totals and breakdowns
    const totalCost = generations.reduce((sum, gen) => {
      return sum + (gen.cost ? Number(gen.cost) : 0)
    }, 0)

    // Group by provider
    const byProvider: Record<string, { cost: number; count: number; models: Record<string, { cost: number; count: number; modelId: string }> }> = {}

    for (const gen of generations) {
      const cost = gen.cost ? Number(gen.cost) : 0
      let provider = 'unknown'

      if (gen.modelId.startsWith('gemini-') || gen.modelId.includes('veo')) {
        provider = 'Gemini'
      } else if (gen.modelId.startsWith('replicate-')) {
        provider = 'Replicate'
      } else if (gen.modelId.startsWith('fal-')) {
        provider = 'FAL.ai'
      }

      if (!byProvider[provider]) {
        byProvider[provider] = { cost: 0, count: 0, models: {} }
      }

      byProvider[provider].cost += cost
      byProvider[provider].count += 1

      // Get model name for display
      const model = modelRegistry.getModel(gen.modelId)
      const modelName = model?.getConfig().name || gen.modelId

      if (!byProvider[provider].models[modelName]) {
        byProvider[provider].models[modelName] = { cost: 0, count: 0, modelId: gen.modelId }
      }
      byProvider[provider].models[modelName].cost += cost
      byProvider[provider].models[modelName].count += 1
    }

    // Convert to array format
    const providerBreakdown = Object.entries(byProvider).map(([provider, data]) => ({
      provider,
      totalCost: data.cost,
      generationCount: data.count,
      models: Object.entries(data.models).map(([modelName, modelData]) => ({
        modelName,
        cost: modelData.cost,
        generationCount: modelData.count,
      })),
    }))

    // Calculate spending over time (last 30 days, daily breakdown)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const recentGenerations = generations.filter((g) => g.createdAt >= thirtyDaysAgo)

    const dailySpending: Record<string, number> = {}
    for (const gen of recentGenerations) {
      const date = new Date(gen.createdAt).toISOString().split('T')[0]
      const cost = gen.cost ? Number(gen.cost) : 0
      dailySpending[date] = (dailySpending[date] || 0) + cost
    }

    const dailyBreakdown = Object.entries(dailySpending)
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      totalCost,
      totalGenerations: generations.length,
      providerBreakdown,
      dailyBreakdown,
      lastUpdated: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Error fetching spending analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch spending analytics', details: error.message },
      { status: 500 }
    )
  }
}

