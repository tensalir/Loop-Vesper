import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Optimized endpoint to fetch projects with thumbnails
 * Uses a single query with joins instead of N+1 pattern
 * 
 * Returns projects with:
 * - Owner profile (displayName, username)
 * - Latest generation thumbnail for each project
 * - Session count per project
 */
export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // First, get all projects the user has access to
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          {
            AND: [
              { isShared: true },
              { ownerId: { not: user.id } },
            ],
          },
          {
            members: {
              some: {
                userId: user.id,
              },
            },
          },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        ownerId: true,
        isShared: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })

    // Prepare IDs for parallel queries
    const ownerIds = Array.from(new Set(projects.map(p => p.ownerId)))
    const projectIds = projects.map(p => p.id)

    // Run independent queries in parallel (all depend only on projects)
    const [owners, sessions, sessionCounts] = await Promise.all([
      // Get owner profiles for all projects
      prisma.profile.findMany({
        where: {
          id: { in: ownerIds },
        },
        select: {
          id: true,
          displayName: true,
          username: true,
        },
      }),
      // Get sessions for all projects
      prisma.session.findMany({
        where: {
          projectId: { in: projectIds },
        },
        select: {
          id: true,
          projectId: true,
          type: true,
        },
      }),
      // Get session counts
      prisma.session.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds },
        },
        _count: true,
      }),
    ])

    const ownerMap = new Map(owners.map(o => [o.id, o]))
    const sessionCountMap = new Map(sessionCounts.map(s => [s.projectId, s._count]))

    // Get latest generation with image output for each project (depends on sessions)
    const sessionIds = sessions.map(s => s.id)

    const latestGenerations = await prisma.generation.findMany({
      where: {
        sessionId: { in: sessionIds },
        status: 'completed',
      },
      select: {
        id: true,
        sessionId: true,
        createdAt: true,
        outputs: {
          where: {
            fileType: 'image',
          },
          select: {
            fileUrl: true,
          },
          take: 1,
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Map session -> project
    const sessionToProject = new Map(sessions.map(s => [s.id, s.projectId]))

    // Find latest image for each project
    const projectThumbnails = new Map<string, string>()

    for (const gen of latestGenerations) {
      if (gen.outputs.length > 0) {
        const projectId = sessionToProject.get(gen.sessionId)
        if (projectId && !projectThumbnails.has(projectId)) {
          projectThumbnails.set(projectId, gen.outputs[0].fileUrl)
        }
      }
    }

    // Build final response
    const projectsWithThumbnails = projects.map(project => ({
      ...project,
      owner: ownerMap.get(project.ownerId) || {
        id: project.ownerId,
        displayName: null,
        username: null,
      },
      thumbnailUrl: projectThumbnails.get(project.id) || null,
      sessionCount: sessionCountMap.get(project.id) || 0,
    }))

    return NextResponse.json(projectsWithThumbnails, {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error) {
    console.error('Error fetching projects with thumbnails:', error)
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    )
  }
}

