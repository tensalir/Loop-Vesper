import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET /api/sessions?projectId=xxx - List all sessions for a project
export async function GET(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId')

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this project
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
        ],
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    // Filter sessions based on privacy and ownership
    const isOwner = project.ownerId === user.id
    const sessions = await prisma.session.findMany({
      where: {
        projectId,
        ...(isOwner
          ? {} // Owner sees all sessions
          : { isPrivate: false }), // Non-owners only see public sessions
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })

    // Get project owner profile for display
    const ownerProfile = await prisma.profile.findUnique({
      where: { id: project.ownerId },
      select: {
        id: true,
        displayName: true,
        username: true,
      },
    })

    // Add creator info to each session
    const sessionsWithCreator = sessions.map(session => ({
      ...session,
      creator: ownerProfile,
    }))

    return NextResponse.json(sessionsWithCreator, {
      headers: {
        'Cache-Control': 'private, max-age=30',
      },
    })
  } catch (error) {
    console.error('Error fetching sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch sessions' },
      { status: 500 }
    )
  }
}

// POST /api/sessions - Create a new session
export async function POST(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { projectId, name, type } = body

    if (!projectId || !name || !type) {
      return NextResponse.json(
        { error: 'Project ID, name, and type are required' },
        { status: 400 }
      )
    }

    if (type !== 'image' && type !== 'video') {
      return NextResponse.json(
        { error: 'Type must be either "image" or "video"' },
        { status: 400 }
      )
    }

    // Verify user has access to this project
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
        ],
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    const session = await prisma.session.create({
      data: {
        projectId,
        name: name.trim(),
        type,
      },
    })

    return NextResponse.json(session, { status: 201 })
  } catch (error) {
    console.error('Error creating session:', error)
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    )
  }
}

