import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * DELETE /api/projects/[id]/pinned-images/[imageId]
 * 
 * Unpin an image from the project
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: projectId, imageId } = params

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
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found or insufficient permissions' },
        { status: 404 }
      )
    }

    // Check the pinned image exists and belongs to this project
    const pinnedImage = await prisma.pinnedImage.findFirst({
      where: {
        id: imageId,
        projectId,
      },
    })

    if (!pinnedImage) {
      return NextResponse.json(
        { error: 'Pinned image not found' },
        { status: 404 }
      )
    }

    // Delete the pinned image
    await prisma.pinnedImage.delete({
      where: { id: imageId },
    })

    return NextResponse.json({ message: 'Image unpinned successfully' })
  } catch (error: any) {
    console.error('Error unpinning image:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to unpin image' },
      { status: 500 }
    )
  }
}
