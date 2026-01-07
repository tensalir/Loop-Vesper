import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/projects/[id]/briefing
 * 
 * Get the project briefing
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
      select: { id: true, briefing: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    return NextResponse.json({
      briefing: project.briefing || null,
    })
  } catch (error: any) {
    console.error('Error fetching briefing:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch briefing' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/projects/[id]/briefing
 * 
 * Update the project briefing (owner or admin members only)
 */
export async function PUT(
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
    const body = await request.json()
    const { briefing } = body as { briefing: string | null }

    if (briefing !== null && typeof briefing !== 'string') {
      return NextResponse.json(
        { error: 'Briefing must be a string or null' },
        { status: 400 }
      )
    }

    // Check project access and permissions (owner or admin member)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: user.id },
          {
            members: {
              some: {
                userId: user.id,
                role: 'admin',
              },
            },
          },
        ],
      },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or insufficient permissions' },
        { status: 404 }
      )
    }

    // Update briefing
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        briefing: briefing?.trim() || null,
        updatedAt: new Date(),
      },
      select: { briefing: true },
    })

    return NextResponse.json({
      briefing: updated.briefing,
      message: 'Briefing updated successfully',
    })
  } catch (error: any) {
    console.error('Error updating briefing:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update briefing' },
      { status: 500 }
    )
  }
}

