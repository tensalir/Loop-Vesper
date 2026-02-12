import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import {
  extractSemanticProfile,
  calculateTagDistribution,
  ProjectSemanticFingerprint,
} from '@/lib/analytics/taxonomy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/projects/[projectId]/profile
 * 
 * Returns semantic profile for a specific project using actual claudeParsed fields:
 * - Top subjects
 * - Dominant styles
 * - Mood distribution
 * - Color palette
 * - Common techniques
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId } = params

    // Verify user has access to this project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        ownerId: true,
        members: {
          where: { userId: user.id },
          select: { id: true },
        },
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Check access
    const hasAccess = project.ownerId === user.id || project.members.length > 0

    if (!hasAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get all analyzed outputs for this project
    const analyzedOutputs = await prisma.output.findMany({
      where: {
        generation: {
          session: {
            projectId,
          },
        },
        analysis: {
          status: 'completed',
          claudeParsed: { not: null },
        },
      },
      include: {
        analysis: {
          select: {
            claudeParsed: true,
          },
        },
      },
    })

    // Get total outputs for this project
    const totalOutputs = await prisma.output.count({
      where: {
        generation: {
          session: {
            projectId,
          },
        },
      },
    })

    // Extract semantic profiles
    const profiles = analyzedOutputs
      .map((output) => extractSemanticProfile(output.analysis?.claudeParsed))
      .filter((p) => p.subjects.length > 0 || p.styles.length > 0)

    // Aggregate subjects
    const allSubjects = profiles.flatMap((p) => p.subjects)
    const subjectDistribution = calculateTagDistribution(allSubjects, profiles.length)

    // Aggregate styles
    const allStyles = profiles.flatMap((p) => p.styles)
    const styleDistribution = calculateTagDistribution(allStyles, profiles.length)

    // Aggregate moods (filter nulls)
    const moods = profiles
      .map((p) => p.mood)
      .filter((m): m is string => m !== null)
    const moodDistribution = calculateTagDistribution(moods, profiles.length)

    // Aggregate colors
    const allColors = profiles.flatMap((p) => p.colors)
    const colorDistribution = calculateTagDistribution(allColors, profiles.length)

    // Aggregate techniques
    const allTechniques = profiles.flatMap((p) => p.techniques)
    const techniqueDistribution = calculateTagDistribution(allTechniques, profiles.length)

    const fingerprint: ProjectSemanticFingerprint = {
      projectId: project.id,
      projectName: project.name,
      topSubjects: subjectDistribution.slice(0, 10).map((d) => ({
        subject: d.tag,
        count: d.count,
        percentage: d.percentage,
      })),
      dominantStyles: styleDistribution.slice(0, 10).map((d) => ({
        style: d.tag,
        count: d.count,
        percentage: d.percentage,
      })),
      moodDistribution: moodDistribution.slice(0, 8).map((d) => ({
        mood: d.tag,
        count: d.count,
        percentage: d.percentage,
      })),
      colorPalette: colorDistribution.slice(0, 10).map((d) => ({
        color: d.tag,
        count: d.count,
        percentage: d.percentage,
      })),
      techniques: techniqueDistribution.slice(0, 12).map((d) => ({
        technique: d.tag,
        count: d.count,
        percentage: d.percentage,
      })),
      totalAnalyzed: analyzedOutputs.length,
      analysisCompleteness: totalOutputs > 0 ? (analyzedOutputs.length / totalOutputs) * 100 : 0,
      lastUpdated: new Date(),
    }

    return NextResponse.json(fingerprint)
  } catch (error) {
    console.error('Error fetching project semantic profile:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project semantic profile' },
      { status: 500 }
    )
  }
}
