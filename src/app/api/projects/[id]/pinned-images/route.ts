import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/projects/[id]/pinned-images
 * 
 * List all pinned images for a project
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
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const pinnedImages = await prisma.pinnedImage.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })

    return NextResponse.json({ pinnedImages })
  } catch (error: any) {
    console.error('Error fetching pinned images:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch pinned images' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/projects/[id]/pinned-images
 * 
 * Pin an image to the project
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
    const body = await request.json()
    const { imageUrl, label } = body as { imageUrl: string; label?: string }

    if (!imageUrl || typeof imageUrl !== 'string') {
      return NextResponse.json(
        { error: 'imageUrl is required and must be a string' },
        { status: 400 }
      )
    }

    // Check project access (any member can pin)
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

    // Get the current max sortOrder for this project
    const maxSort = await prisma.pinnedImage.aggregate({
      where: { projectId },
      _max: { sortOrder: true },
    })
    const nextSortOrder = (maxSort._max.sortOrder ?? -1) + 1

    // Create the pinned image
    const pinnedImage = await prisma.pinnedImage.create({
      data: {
        projectId,
        imageUrl,
        label: label?.trim() || null,
        sortOrder: nextSortOrder,
        pinnedBy: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    })

    return NextResponse.json({ pinnedImage }, { status: 201 })
  } catch (error: any) {
    console.error('Error pinning image:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to pin image' },
      { status: 500 }
    )
  }
}
