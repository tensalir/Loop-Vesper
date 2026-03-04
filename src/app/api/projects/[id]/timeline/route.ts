import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

const TIMELINE_MAX_DURATION_MS = 120_000

async function verifyProjectAccess(projectId: string, userId: string) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
        { isShared: true },
      ],
    },
    select: { id: true, ownerId: true, isShared: true },
  })
}

/**
 * GET /api/projects/:id/timeline - List timeline sequences for a project
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const project = await verifyProjectAccess(params.id, user.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const sequences = await prisma.timelineSequence.findMany({
      where: { projectId: params.id },
      include: {
        tracks: {
          include: {
            clips: { orderBy: { startMs: 'asc' } },
            captions: { orderBy: { startMs: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        transitions: true,
      },
      orderBy: { updatedAt: 'desc' },
    })

    return NextResponse.json({ sequences })
  } catch (error) {
    console.error('GET timeline error:', error)
    return NextResponse.json({ error: 'Failed to list timelines' }, { status: 500 })
  }
}

/**
 * POST /api/projects/:id/timeline - Create a new timeline sequence
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const project = await verifyProjectAccess(params.id, user.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const { name, sessionId } = body

    const sequence = await prisma.timelineSequence.create({
      data: {
        projectId: params.id,
        userId: user.id,
        sessionId: sessionId || null,
        name: name || 'Untitled Sequence',
        durationMs: 0,
        fps: 30,
      },
      include: {
        tracks: { include: { clips: true, captions: true }, orderBy: { sortOrder: 'asc' } },
        transitions: true,
      },
    })

    return NextResponse.json({ sequence }, { status: 201 })
  } catch (error) {
    console.error('POST timeline error:', error)
    return NextResponse.json({ error: 'Failed to create timeline' }, { status: 500 })
  }
}
