import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

// GET /api/projects - List all projects for the current user
export async function GET() {
  const startTime = performance.now()
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ensure user profile exists (create if it doesn't)
    await prisma.profile.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        username: user.email?.split('@')[0],
        displayName: user.user_metadata?.full_name || user.email,
      },
    })

    // Fetch projects visible to the user:
    // 1. Projects owned by user
    // 2. Projects where user is explicitly a member (invite-based sharing)
    // 3. Public shared projects from other users (isShared = true)
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: user.id }, // Own projects
          {
            members: {
              some: {
                userId: user.id,
              },
            },
          }, // Explicitly invited to project
          {
            AND: [
              { isShared: true },
              { NOT: { ownerId: user.id } },
            ],
          }, // Public shared projects from others
        ],
      },
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        sessions: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    })

    logMetric({
      name: 'api_projects_list',
      status: 'success',
      durationMs: performance.now() - startTime,
      meta: { projectCount: projects.length },
    })

    return NextResponse.json(projects)
  } catch (error: any) {
    logMetric({
      name: 'api_projects_list',
      status: 'error',
      durationMs: performance.now() - startTime,
      meta: { error: error.message },
    })
    console.error('Error fetching projects:', error)
    return NextResponse.json(
      { 
        error: 'Failed to fetch projects',
        details: error.message,
        code: error.code
      },
      { status: 500 }
    )
  }
}

// POST /api/projects - Create a new project
export async function POST(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Ensure user profile exists (create if it doesn't)
    await prisma.profile.upsert({
      where: { id: user.id },
      update: {},
      create: {
        id: user.id,
        username: user.email?.split('@')[0],
        displayName: user.user_metadata?.full_name || user.email,
      },
    })

    const body = await request.json()
    const { name, description } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    const project = await prisma.project.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        ownerId: user.id,
        // Visible in Community Creations by default (owner can toggle)
        isShared: true,
      },
    })

    // Create a default session for the project
    await prisma.session.create({
      data: {
        projectId: project.id,
        name: 'Session 1',
        type: 'image',
        // Public by default (owner can toggle per-session privacy)
        isPrivate: false,
      },
    })

    return NextResponse.json(project, { status: 201 })
  } catch (error: any) {
    console.error('Error creating project:', error)
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
    })
    return NextResponse.json(
      { 
        error: 'Failed to create project',
        details: error.message,
        code: error.code
      },
      { status: 500 }
    )
  }
}

