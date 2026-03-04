import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const DEFAULT_PAGE_SIZE = 24

/**
 * GET /api/projects/:id/videos - Paginated video outputs for the timeline browse library.
 * Returns only video-type outputs from completed generations in this project.
 * Query params:
 *   cursor - opaque base64url cursor for keyset pagination
 *   limit  - page size (default 24, max 100)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const { searchParams } = new URL(request.url)
    const cursorParam = searchParams.get('cursor')
    const limitParam = searchParams.get('limit')
    const limit = Math.min(Math.max(parseInt(limitParam || '', 10) || DEFAULT_PAGE_SIZE, 1), 100)

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
          { isShared: true },
        ],
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    const isOwner = project.ownerId === user.id
    const showAllSessions = isOwner || project.isShared

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
        // Invalid cursor
      }
    }

    const outputs = await prisma.output.findMany({
      where: {
        ...cursorFilter,
        fileType: 'video',
        generation: {
          session: {
            projectId,
            ...(showAllSessions ? {} : { isPrivate: false }),
          },
          status: 'completed',
        },
      },
      select: {
        id: true,
        fileUrl: true,
        fileType: true,
        width: true,
        height: true,
        duration: true,
        createdAt: true,
        generation: {
          select: {
            id: true,
            prompt: true,
            session: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })

    const hasMore = outputs.length > limit
    const pageOutputs = hasMore ? outputs.slice(0, limit) : outputs

    let nextCursor: string | null = null
    if (hasMore && pageOutputs.length > 0) {
      const lastItem = pageOutputs[pageOutputs.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
      ).toString('base64url')
    }

    const data = pageOutputs.map((o) => ({
      id: o.id,
      url: o.fileUrl,
      prompt: o.generation.prompt,
      generationId: o.generation.id,
      sessionName: o.generation.session.name,
      projectId,
      width: o.width,
      height: o.height,
      durationMs: o.duration ? Math.round(o.duration * 1000) : null,
      createdAt: o.createdAt,
    }))

    return NextResponse.json(
      { data, nextCursor, hasMore },
      { headers: { 'Cache-Control': 'private, max-age=30' } }
    )
  } catch (error) {
    console.error('Error fetching project videos:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project videos' },
      { status: 500 }
    )
  }
}
