import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { modelRegistry } from '@/lib/models/registry'
import { generateInsights, type AnalyticsInsightInput } from '@/lib/analytics/insights'
import { extractSemanticProfile, calculateTagDistribution } from '@/lib/analytics/taxonomy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/insights
 * 
 * Returns deterministic insights based on analytics data.
 * Aggregates semantic patterns, model affinity, convergence signals, and funnel data.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const scope = searchParams.get('scope') || 'my'

    const userId = scope === 'my' ? user.id : undefined

    // Fetch funnels from API
    const baseUrl = request.nextUrl.origin

    const [funnelsRes, cohortRes] = await Promise.all([
      // Project funnels
      fetch(`${baseUrl}/api/analytics/funnels?dimension=project&scope=${scope}`, {
        headers: {
          cookie: request.headers.get('cookie') || '',
        },
      }),
      // Cohorts (my scope only)
      scope === 'my'
        ? fetch(`${baseUrl}/api/analytics/funnels?dimension=model&scope=my`, {
            headers: {
              cookie: request.headers.get('cookie') || '',
            },
          })
        : Promise.resolve(null),
    ])

    if (!funnelsRes.ok) {
      throw new Error('Failed to fetch funnel data for insights')
    }

    const funnelsData = await funnelsRes.json()
    const cohortData = cohortRes ? await cohortRes.json() : null

    // Fetch semantic data directly from DB for pattern analysis
    const outputs = await prisma.output.findMany({
      where: userId ? {
        generation: {
          userId,
        },
      } : undefined,
      include: {
        generation: {
          select: {
            modelId: true,
          },
        },
        analysis: {
          where: {
            status: 'completed',
          },
          select: {
            claudeParsed: true,
          },
        },
        events: {
          where: {
            eventType: { in: ['download', 'share'] },
          },
          select: {
            id: true,
          },
        },
        bookmarks: {
          select: {
            id: true,
          },
        },
      },
      take: 500, // Limit for performance
    })

    // Extract semantic profiles
    const profiles = outputs
      .filter(o => o.analysis)
      .map(o => ({
        ...extractSemanticProfile(o.analysis?.claudeParsed),
        outputId: o.id,
        modelId: o.generation.modelId,
        isKeeper: o.events.length > 0 || o.bookmarks.length > 0 || o.isApproved,
      }))

    // Calculate workspace semantic patterns
    const allSubjects = profiles.flatMap(p => p.subjects)
    const allStyles = profiles.flatMap(p => p.styles)
    const allMoods = profiles.map(p => p.mood).filter((m): m is string => m !== null)

    const semanticPatterns = {
      topSubjects: calculateTagDistribution(allSubjects, profiles.length).slice(0, 10)
        .map(t => ({ subject: t.tag, count: t.count })),
      topStyles: calculateTagDistribution(allStyles, profiles.length).slice(0, 8)
        .map(t => ({ style: t.tag, count: t.count })),
      topMoods: calculateTagDistribution(allMoods, profiles.length).slice(0, 6)
        .map(t => ({ mood: t.tag, count: t.count })),
    }

    // Calculate model affinity (which models for which subjects/styles)
    const modelGroups = new Map<string, typeof profiles>()
    for (const profile of profiles) {
      if (!modelGroups.has(profile.modelId)) {
        modelGroups.set(profile.modelId, [])
      }
      modelGroups.get(profile.modelId)!.push(profile)
    }

    const modelAffinity = Array.from(modelGroups.entries())
      .map(([modelId, modelProfiles]) => {
        const modelSubjects = modelProfiles.flatMap(p => p.subjects)
        const modelStyles = modelProfiles.flatMap(p => p.styles)
        const config = modelRegistry.getModelConfig(modelId)

        return {
          modelName: config?.name || modelId,
          topSubjects: calculateTagDistribution(modelSubjects, modelProfiles.length).slice(0, 5)
            .map(t => ({ subject: t.tag, count: t.count })),
          topStyles: calculateTagDistribution(modelStyles, modelProfiles.length).slice(0, 3)
            .map(t => ({ style: t.tag, count: t.count })),
          totalGenerations: modelProfiles.length,
        }
      })
      .filter(m => m.totalGenerations >= 5) // Only models with sufficient data
      .sort((a, b) => b.totalGenerations - a.totalGenerations)
      .slice(0, 5) // Top 5 models

    // Calculate convergence signals (patterns in keeper outputs)
    const keepers = profiles.filter(p => p.isKeeper)
    const totalKeepers = keepers.length
    let convergenceSignals: AnalyticsInsightInput['convergenceSignals'] = undefined

    if (totalKeepers > 0) {
      const keeperSubjects = keepers.flatMap(p => p.subjects)
      const keeperStyles = keepers.flatMap(p => p.styles)
      const keeperMoods = keepers.map(p => p.mood).filter((m): m is string => m !== null)

      // Calculate convergence rates
      const subjectConvergence = calculateTagDistribution(keeperSubjects, totalKeepers)
        .map(s => {
          const totalCount = allSubjects.filter(sub => sub === s.tag).length
          return {
            subject: s.tag,
            keeperCount: s.count,
            totalCount,
            convergenceRate: totalCount > 0 ? (s.count / totalCount) * 100 : 0,
          }
        })
        .filter(s => s.keeperCount >= 2) // At least 2 keepers
        .sort((a, b) => b.convergenceRate - a.convergenceRate)

      const styleConvergence = calculateTagDistribution(keeperStyles, totalKeepers)
        .map(s => {
          const totalCount = allStyles.filter(style => style === s.tag).length
          return {
            style: s.tag,
            keeperCount: s.count,
            totalCount,
            convergenceRate: totalCount > 0 ? (s.count / totalCount) * 100 : 0,
          }
        })
        .filter(s => s.keeperCount >= 2)
        .sort((a, b) => b.convergenceRate - a.convergenceRate)

      const moodConvergence = calculateTagDistribution(keeperMoods, totalKeepers)
        .map(m => {
          const totalCount = allMoods.filter(mood => mood === m.tag).length
          return {
            mood: m.tag,
            keeperCount: m.count,
            totalCount,
            convergenceRate: totalCount > 0 ? (m.count / totalCount) * 100 : 0,
          }
        })
        .filter(m => m.keeperCount >= 2)
        .sort((a, b) => b.convergenceRate - a.convergenceRate)

      convergenceSignals = {
        keeperSubjects: subjectConvergence.slice(0, 5),
        keeperStyles: styleConvergence.slice(0, 5),
        keeperMoods: moodConvergence.slice(0, 3),
      }
    }

    // Build insight input
    const insightInput: AnalyticsInsightInput = {
      projectFunnels: funnelsData.funnels || [],
      semanticPatterns,
      modelAffinity,
      convergenceSignals,
    }

    // Add cohort insights if available
    if (cohortData?.cohortDistribution?.cohorts) {
      insightInput.cohorts = cohortData.cohortDistribution.cohorts.map((c: any) => ({
        cohort: c.cohort,
        percentage: c.percentage,
      }))
    }

    // Generate insights
    const insights = generateInsights(insightInput)

    return NextResponse.json({
      insights,
      scope,
      generated: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error generating insights:', error)
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    )
  }
}
