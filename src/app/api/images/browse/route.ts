import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const DEFAULT_PAGE_SIZE = 40

/**
 * GET /api/images/browse - Browse images across all accessible projects
 *
 * Access control:
 * - Returns images from projects the user owns, is a member of, or that are shared (public)
 * - For owned or shared projects: shows images from all sessions
 * - For non-owned, non-shared projects: only shows images from non-private sessions
 *
 * Query params:
 *   cursor    - opaque cursor for pagination
 *   limit     - page size (default 40, max 100)
 *   projectId - optional filter to a specific project (within accessible ones)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const cursorParam = searchParams.get('cursor')
    const limitParam = searchParams.get('limit')
    const projectIdFilter = searchParams.get('projectId')
    const limit = Math.min(Math.max(parseInt(limitParam || '', 10) || DEFAULT_PAGE_SIZE, 1), 100)

    // Step 1: Find all projects the user can access (excluding current project if filtered)
    const accessibleProjects = await prisma.project.findMany({
      where: {
        ...(projectIdFilter ? { id: projectIdFilter } : {}),
        OR: [
          { ownerId: user.id },
          {
            members: {
              some: {
                userId: user.id,
              },
            },
          },
          { isShared: true },
        ],
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        isShared: true,
      },
    })

    if (accessibleProjects.length === 0) {
      return NextResponse.json({
        data: [],
        projects: [],
        nextCursor: null,
        hasMore: false,
      })
    }

    // Step 2: Build session privacy filter per project
    // For each project, determine which sessions the user can see
    const projectIds = accessibleProjects.map((p) => p.id)

    // Projects where the user can see ALL sessions (owner or shared)
    const fullAccessProjectIds = accessibleProjects
      .filter((p) => p.ownerId === user.id || p.isShared)
      .map((p) => p.id)

    // Projects where the user can only see public sessions
    const restrictedProjectIds = accessibleProjects
      .filter((p) => p.ownerId !== user.id && !p.isShared)
      .map((p) => p.id)

    // Decode cursor if provided
    let cursorFilter = {}
    if (cursorParam) {
      try {
        const decoded = JSON.parse(Buffer.from(cursorParam, 'base64url').toString('utf-8'))
        cursorFilter = {
          OR: [
            { createdAt: { lt: new Date(decoded.createdAt) } },
            {
              createdAt: { equals: new Date(decoded.createdAt) },
              id: { lt: decoded.id },
            },
          ],
        }
      } catch {
        // Invalid cursor, ignore
      }
    }

    // Step 3: Fetch images with proper access control
    // Combine both access levels in a single query using OR conditions
    const sessionFilter: any[] = []

    if (fullAccessProjectIds.length > 0) {
      // Full access: see images from all sessions in these projects
      sessionFilter.push({
        generation: {
          session: {
            projectId: { in: fullAccessProjectIds },
            type: 'image',
          },
        },
      })
    }

    if (restrictedProjectIds.length > 0) {
      // Restricted access: only see images from non-private sessions
      sessionFilter.push({
        generation: {
          session: {
            projectId: { in: restrictedProjectIds },
            type: 'image',
            isPrivate: false,
          },
        },
      })
    }

    if (sessionFilter.length === 0) {
      return NextResponse.json({
        data: [],
        projects: [],
        nextCursor: null,
        hasMore: false,
      })
    }

    const outputs = await prisma.output.findMany({
      where: {
        ...cursorFilter,
        OR: sessionFilter,
        fileType: 'image',
      },
      select: {
        id: true,
        fileUrl: true,
        width: true,
        height: true,
        createdAt: true,
        generation: {
          select: {
            id: true,
            prompt: true,
            modelId: true,
            session: {
              select: {
                id: true,
                name: true,
                projectId: true,
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
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
    })

    const hasMore = outputs.length > limit
    const pageOutputs = hasMore ? outputs.slice(0, limit) : outputs

    // Build next cursor
    let nextCursor: string | null = null
    if (hasMore && pageOutputs.length > 0) {
      const lastItem = pageOutputs[pageOutputs.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
      ).toString('base64url')
    }

    // Transform to response format with project info
    const images = pageOutputs.map((output) => ({
      id: output.id,
      url: output.fileUrl,
      prompt: output.generation.prompt,
      generationId: output.generation.id,
      sessionName: output.generation.session.name,
      projectId: output.generation.session.projectId,
      projectName: output.generation.session.project.name,
      width: output.width,
      height: output.height,
      createdAt: output.createdAt,
    }))

    // Return unique projects that appear in results (for UI grouping/filtering)
    const projectMap = new Map<string, { id: string; name: string }>()
    for (const img of images) {
      if (!projectMap.has(img.projectId)) {
        projectMap.set(img.projectId, { id: img.projectId, name: img.projectName })
      }
    }

    return NextResponse.json({
      data: images,
      projects: Array.from(projectMap.values()),
      nextCursor,
      hasMore,
    }, {
      headers: {
        'Cache-Control': 'private, max-age=30',
      },
    })
  } catch (error) {
    console.error('Error browsing images:', error)
    return NextResponse.json(
      { error: 'Failed to browse images' },
      { status: 500 }
    )
  }
}
