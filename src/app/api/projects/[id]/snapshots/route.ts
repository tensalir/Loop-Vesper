import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/projects/[id]/snapshots
 *
 * Returns snapshot image outputs for a project (generations with modelId 'snapshot-capture').
 * Used by the SnapshotRail in the Video tab to list captured frames.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id

    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: user.id },
          { members: { some: { userId: user.id } } },
          { isShared: true },
        ],
      },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const generations = await prisma.generation.findMany({
      where: {
        modelId: 'snapshot-capture',
        session: { projectId },
        status: 'completed',
      },
      include: {
        outputs: {
          where: { fileType: 'image' },
          select: {
            id: true,
            fileUrl: true,
            createdAt: true,
          },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    })

    const snapshots = generations
      .filter((g) => g.outputs.length > 0)
      .map((g) => {
        const params = g.parameters as any
        return {
          id: g.outputs[0].id,
          fileUrl: g.outputs[0].fileUrl,
          generationId: g.id,
          timecodeMs: params?.sourceTimecodeMs ?? null,
          sourceVideoOutputId: params?.sourceVideoOutputId ?? null,
          label: params?.sourceLabel ?? null,
          createdAt: g.outputs[0].createdAt,
        }
      })

    return NextResponse.json({ snapshots })
  } catch (error: any) {
    console.error('Error fetching snapshots:', error)
    return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 })
  }
}
