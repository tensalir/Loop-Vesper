import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { modelRegistry } from '@/lib/models/registry'
import {
  calculateFunnelMetrics,
  calculateUserCohort,
  calculateCohortDistribution,
  FUNNEL_STAGES,
  type FunnelMetrics,
  type UserCohort,
} from '@/lib/analytics/cohorts'
import {
  extractSemanticProfile,
} from '@/lib/analytics/taxonomy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/funnels
 * 
 * Returns intent-to-outcome funnel metrics and behavioral cohorts.
 * Can be filtered by:
 * - dimension: 'subject' | 'model' | 'project'
 * - scope: 'my' | 'global' (global requires k-anonymity)
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
    const dimension = searchParams.get('dimension') || 'subject'
    const scope = searchParams.get('scope') || 'my'

    const userId = scope === 'my' ? user.id : undefined

    // Get all outputs with their analysis and events
    const outputs = await prisma.output.findMany({
      where: userId ? {
        generation: {
          userId,
        },
      } : undefined,
      include: {
        generation: {
          include: {
            session: {
              include: {
                project: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
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
          select: {
            eventType: true,
          },
        },
        bookmarks: {
          select: {
            id: true,
          },
        },
        notes: {
          select: {
            id: true,
          },
        },
      },
    })

    // Build funnel data structures by dimension
    const funnelData = new Map<string, {
      label: string
      generated: Set<string>
      analyzed: Set<string>
      iterated: Set<string>
      engaged: Set<string>
      completed: Set<string>
    }>()

    // Helper to initialize funnel bucket
    const getFunnelBucket = (key: string, label: string) => {
      if (!funnelData.has(key)) {
        funnelData.set(key, {
          label,
          generated: new Set(),
          analyzed: new Set(),
          iterated: new Set(),
          engaged: new Set(),
          completed: new Set(),
        })
      }
      return funnelData.get(key)!
    }

    // Track generations per user for iteration detection
    const userGenerationsBySession = new Map<string, Set<string>>()

    // Process each output
    for (const output of outputs) {
      const gen = output.generation
      const sessionKey = gen.sessionId
      const outputId = output.id

      // Track generations for iteration detection
      if (!userGenerationsBySession.has(sessionKey)) {
        userGenerationsBySession.set(sessionKey, new Set())
      }
      userGenerationsBySession.get(sessionKey)!.add(gen.id)

      // Determine dimension key
      let dimensionKey: string
      let dimensionLabel: string

      if (dimension === 'model') {
        const config = modelRegistry.getModelConfig(gen.modelId)
        dimensionKey = gen.modelId
        dimensionLabel = config?.name || gen.modelId
      } else if (dimension === 'project') {
        dimensionKey = gen.session.project.id
        dimensionLabel = gen.session.project.name
      } else {
        // subject dimension - use top subject from semantic profile
        const profile = output.analysis ? extractSemanticProfile(output.analysis.claudeParsed) : null
        const subject = profile && profile.subjects.length > 0 ? profile.subjects[0] : 'unknown'
        dimensionKey = subject
        dimensionLabel = subject.charAt(0).toUpperCase() + subject.slice(1)
      }

      const bucket = getFunnelBucket(dimensionKey, dimensionLabel)

      // Stage 1: Generated (all outputs)
      bucket.generated.add(outputId)

      // Stage 2: Analyzed (has completed analysis)
      if (output.analysis) {
        bucket.analyzed.add(outputId)
      }

      // Stage 3: Iterated (session has multiple generations)
      const sessionGenerations = userGenerationsBySession.get(sessionKey)
      if (sessionGenerations && sessionGenerations.size > 1) {
        bucket.iterated.add(outputId)
      }

      // Stage 4: Engaged (bookmarked, noted, or approved)
      const isEngaged = output.bookmarks.length > 0 || output.notes.length > 0 || output.isApproved
      if (isEngaged) {
        bucket.engaged.add(outputId)
      }

      // Stage 5: Completed (downloaded or shared)
      const hasDownloadOrShare = output.events.some(
        e => e.eventType === 'download' || e.eventType === 'share'
      )
      if (hasDownloadOrShare) {
        bucket.completed.add(outputId)
      }
    }

    // Convert to funnel metrics
    const funnels: FunnelMetrics[] = []
    for (const [key, bucket] of Array.from(funnelData.entries())) {
      const funnel = calculateFunnelMetrics(key, bucket.label, {
        [FUNNEL_STAGES.GENERATED]: bucket.generated.size,
        [FUNNEL_STAGES.ANALYZED]: bucket.analyzed.size,
        [FUNNEL_STAGES.ITERATED]: bucket.iterated.size,
        [FUNNEL_STAGES.ENGAGED]: bucket.engaged.size,
        [FUNNEL_STAGES.COMPLETED]: bucket.completed.size,
      })
      funnels.push(funnel)
    }

    // Sort by generation count
    funnels.sort((a, b) => b.stages.generated.count - a.stages.generated.count)

    // Calculate user cohorts (for 'my' scope only)
    let cohorts: UserCohort[] = []
    let cohortDistribution = null

    if (scope === 'my') {
      // Get user behavior metrics
      const userGenerations = await prisma.generation.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          modelId: true,
          createdAt: true,
          sessionId: true,
          outputs: {
            select: {
              events: {
                where: {
                  eventType: { in: ['download', 'share'] },
                },
                select: { id: true },
              },
            },
          },
        },
      })

      if (userGenerations.length > 0) {
        const dates = userGenerations.map(g => g.createdAt.getTime())
        const minDate = Math.min(...dates)
        const maxDate = Math.max(...dates)
        const timeSpanDays = (maxDate - minDate) / (1000 * 60 * 60 * 24) || 1

        const uniqueModels = new Set(userGenerations.map(g => g.modelId))
        const downloadsOrShares = userGenerations.reduce(
          (sum, g) => sum + g.outputs.reduce((s, o) => s + o.events.length, 0),
          0
        )

        // Calculate iterations per session
        const generationsBySession = new Map<string, number>()
        for (const gen of userGenerations) {
          generationsBySession.set(gen.sessionId, (generationsBySession.get(gen.sessionId) || 0) + 1)
        }
        const avgIterationsPerSession = generationsBySession.size > 0
          ? Array.from(generationsBySession.values()).reduce((a, b) => a + b, 0) / generationsBySession.size
          : 1

        const cohort = calculateUserCohort({
          totalGenerations: userGenerations.length,
          timeSpanDays,
          avgIterationsPerSession,
          uniqueModelsUsed: uniqueModels.size,
          downloadsOrShares,
        })

        if (cohort) {
          cohort.userId = user.id
          cohorts.push(cohort)
          cohortDistribution = calculateCohortDistribution([cohort])
        }
      }
    }

    return NextResponse.json({
      dimension,
      scope,
      funnels: funnels.slice(0, 20), // Top 20
      cohorts: scope === 'my' ? cohorts : undefined,
      cohortDistribution: scope === 'my' ? cohortDistribution : undefined,
    })
  } catch (error) {
    console.error('Error fetching funnel analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch funnel analytics' },
      { status: 500 }
    )
  }
}
