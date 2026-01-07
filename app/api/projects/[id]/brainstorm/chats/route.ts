import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Check if user has access to the project (owner or invited member)
 */
async function checkProjectAccess(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        {
          members: {
            some: {
              userId: userId,
            },
          },
        },
      ],
    },
    select: { id: true },
  })
  return !!project
}

/**
 * GET /api/projects/[id]/brainstorm/chats
 * List all brainstorm chat threads for the current user in this project
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

    // Check project access
    const hasAccess = await checkProjectAccess(projectId, user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Fetch chats for this user + project
    const chats = await prisma.projectChat.findMany({
      where: {
        projectId,
        userId: user.id,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    })

    return NextResponse.json(chats)
  } catch (error: any) {
    console.error('Error fetching brainstorm chats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects/[id]/brainstorm/chats
 * Create a new brainstorm chat thread
 */
export async function POST(
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

    // Check project access
    const hasAccess = await checkProjectAccess(projectId, user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Parse optional title from body
    let title = 'New Chat'
    try {
      const body = await request.json()
      if (body.title && typeof body.title === 'string') {
        title = body.title.trim() || 'New Chat'
      }
    } catch {
      // No body or invalid JSON, use default title
    }

    // Create the chat
    const chat = await prisma.projectChat.create({
      data: {
        projectId,
        userId: user.id,
        title,
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(chat, { status: 201 })
  } catch (error: any) {
    console.error('Error creating brainstorm chat:', error)
    return NextResponse.json(
      { error: 'Failed to create chat' },
      { status: 500 }
    )
  }
}

