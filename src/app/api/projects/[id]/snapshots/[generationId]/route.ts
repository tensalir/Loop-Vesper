import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

/**
 * DELETE /api/projects/[id]/snapshots/[generationId]
 *
 * Deletes a snapshot generation (modelId = snapshot-capture) and its outputs.
 * Unlike generic generation deletion, snapshot deletions are allowed for completed generations.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; generationId: string } }
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
    const generationId = params.generationId

    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
      include: {
        session: {
          include: {
            project: {
              include: {
                members: {
                  where: { userId: user.id },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    })

    if (!generation) {
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
    }

    if (generation.modelId !== 'snapshot-capture') {
      return NextResponse.json({ error: 'Not a snapshot generation' }, { status: 400 })
    }

    if (generation.session.projectId !== projectId) {
      return NextResponse.json({ error: 'Snapshot not in project' }, { status: 400 })
    }

    const project = generation.session.project
    const isOwner = project.ownerId === user.id
    const isMember = project.members.length > 0
    const isCreator = generation.userId === user.id

    if (!isOwner && !isMember && !isCreator) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    await prisma.output.deleteMany({
      where: { generationId },
    })

    await prisma.generation.delete({
      where: { id: generationId },
    })

    return NextResponse.json({
      id: generationId,
      message: 'Snapshot deleted successfully',
    })
  } catch (error: any) {
    console.error('Error deleting snapshot:', error)
    return NextResponse.json(
      { error: 'Failed to delete snapshot', details: error.message },
      { status: 500 }
    )
  }
}
