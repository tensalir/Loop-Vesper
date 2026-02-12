import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const DEFAULT_PAGE_SIZE = 40

// GET /api/projects/:id/images - Get images for a project with cursor-based pagination
// Query params:
//   cursor  - opaque cursor for pagination (base64-encoded {createdAt, id})
//   limit   - page size (default 40, max 100)
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

    // Verify user has access to this project (owner, member, or public project)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
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
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    // Session privacy: owner or shared project sees all sessions, otherwise only public
    const isOwner = project.ownerId === user.id
    const showAllSessions = isOwner || project.isShared

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

    // Fetch paginated image outputs with session privacy filtering
    const outputs = await prisma.output.findMany({
      where: {
        ...cursorFilter,
        generation: {
          session: {
            projectId,
            type: 'image',
            ...(showAllSessions ? {} : { isPrivate: false }),
          },
        },
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
            createdAt: true,
            session: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1, // Fetch one extra to determine if there are more
    })

    const hasMore = outputs.length > limit
    const pageOutputs = hasMore ? outputs.slice(0, limit) : outputs

    // Build next cursor from last item
    let nextCursor: string | null = null
    if (hasMore && pageOutputs.length > 0) {
      const lastItem = pageOutputs[pageOutputs.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
      ).toString('base64url')
    }

    // Transform to response format
    const images = pageOutputs.map((output) => ({
      id: output.id,
      url: output.fileUrl,
      prompt: output.generation.prompt,
      generationId: output.generation.id,
      sessionName: output.generation.session.name,
      width: output.width,
      height: output.height,
      createdAt: output.createdAt,
    }))

    return NextResponse.json({
      data: images,
      nextCursor,
      hasMore,
    }, {
      headers: {
        'Cache-Control': 'private, max-age=30',
      },
    })
  } catch (error) {
    console.error('Error fetching project images:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project images' },
      { status: 500 }
    )
  }
}

