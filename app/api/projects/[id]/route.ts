import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logMetric } from '@/lib/metrics'

// GET /api/projects/[id] - Get a specific project
// Query params:
// - includeSessions: set to "1" or "true" to include sessions (default: false)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const startTime = performance.now()
  
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if sessions should be included (opt-in to reduce payload)
    const searchParams = request.nextUrl.searchParams
    const includeSessions = searchParams.get('includeSessions') === '1' || 
                            searchParams.get('includeSessions') === 'true'

    // Project visibility: owner OR explicit member (invite-based sharing)
    // Note: isShared is just a UI toggle for the owner, not a visibility flag
    const project = await prisma.project.findFirst({
      where: {
        id: params.id,
        OR: [
          { ownerId: user.id }, // Owner can always access
          {
            members: {
              some: {
                userId: user.id,
              },
            },
          }, // Explicitly invited to project
        ],
      },
      include: {
        owner: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        // Only include sessions if explicitly requested
        ...(includeSessions && {
          sessions: {
            orderBy: {
              createdAt: 'desc' as const,
            },
          },
        }),
      },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    logMetric({
      name: 'api_project_detail',
      status: 'success',
      durationMs: performance.now() - startTime,
      meta: { 
        projectId: params.id, 
        includeSessions,
        sessionCount: (project as any).sessions?.length || 0,
      },
    })

    return NextResponse.json(project)
  } catch (error: any) {
    logMetric({
      name: 'api_project_detail',
      status: 'error',
      durationMs: performance.now() - startTime,
      meta: { projectId: params.id, error: error?.message },
    })
    console.error('Error fetching project:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project' },
      { status: 500 }
    )
  }
}

// PATCH /api/projects/[id] - Update a project
export async function PATCH(
  request: Request,
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

    const body = await request.json()
    const { name, description, isShared } = body

    // Check if user owns the project
    const existingProject = await prisma.project.findFirst({
      where: {
        id: params.id,
        ownerId: user.id,
      },
    })

    if (!existingProject) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    const project = await prisma.project.update({
      where: { id: params.id },
      data: {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(typeof isShared === 'boolean' && { isShared }),
      },
    })

    return NextResponse.json(project)
  } catch (error) {
    console.error('Error updating project:', error)
    return NextResponse.json(
      { error: 'Failed to update project' },
      { status: 500 }
    )
  }
}

// DELETE /api/projects/[id] - Delete a project
export async function DELETE(
  request: Request,
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

    // Check if user owns the project
    const existingProject = await prisma.project.findFirst({
      where: {
        id: params.id,
        ownerId: user.id,
      },
    })

    if (!existingProject) {
      return NextResponse.json(
        { error: 'Project not found or unauthorized' },
        { status: 404 }
      )
    }

    await prisma.project.delete({
      where: { id: params.id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting project:', error)
    return NextResponse.json(
      { error: 'Failed to delete project' },
      { status: 500 }
    )
  }
}

