import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/projects/:id/timeline/:sequenceId/render - Enqueue a render job
 *
 * Freezes the current timeline state as a snapshot and creates a render job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; sequenceId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const sequence = await prisma.timelineSequence.findFirst({
      where: {
        id: params.sequenceId,
        projectId: params.id,
        project: {
          OR: [
            { ownerId: user.id },
            { members: { some: { userId: user.id } } },
          ],
        },
      },
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
    })

    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 })
    }

    if (sequence.durationMs <= 0) {
      return NextResponse.json({ error: 'Sequence has no content to render' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const resolution = body.resolution ?? 1080

    const renderJob = await prisma.timelineRenderJob.create({
      data: {
        sequenceId: params.sequenceId,
        userId: user.id,
        resolution,
        status: 'queued',
        snapshotJson: JSON.parse(JSON.stringify(sequence)),
      },
    })

    return NextResponse.json({ renderJob }, { status: 201 })
  } catch (error) {
    console.error('POST render error:', error)
    return NextResponse.json({ error: 'Failed to enqueue render' }, { status: 500 })
  }
}

/**
 * GET /api/projects/:id/timeline/:sequenceId/render - List render jobs for a sequence
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; sequenceId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const jobs = await prisma.timelineRenderJob.findMany({
      where: { sequenceId: params.sequenceId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        progress: true,
        resolution: true,
        outputUrl: true,
        outputId: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    })

    return NextResponse.json({ renderJobs: jobs })
  } catch (error) {
    console.error('GET render jobs error:', error)
    return NextResponse.json({ error: 'Failed to list render jobs' }, { status: 500 })
  }
}
