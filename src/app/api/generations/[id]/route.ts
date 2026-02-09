import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// GET /api/generations/[id] - Fetch a single generation with outputs
// Used for lazy loading outputs in light mode
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

    const generationId = params.id

    if (!generationId) {
      return NextResponse.json(
        { error: 'Generation ID is required' },
        { status: 400 }
      )
    }

    // Fetch the generation with outputs
    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
      include: {
        outputs: {
          select: {
            id: true,
            generationId: true,
            fileUrl: true,
            fileType: true,
            width: true,
            height: true,
            duration: true,
            isStarred: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        session: {
          select: {
            projectId: true,
            project: {
              select: {
                ownerId: true,
                isShared: true,
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
      return NextResponse.json(
        { error: 'Generation not found' },
        { status: 404 }
      )
    }

    // Check access
    const project = generation.session.project
    const isProjectOwner = project.ownerId === user.id
    const isMember = project.members.length > 0
    const isPublicProject = project.isShared === true

    if (!isProjectOwner && !isMember && !isPublicProject) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Fetch bookmarks for outputs
    const outputIds = generation.outputs.map(o => o.id)
    const bookmarks = outputIds.length > 0
      ? await prisma.bookmark.findMany({
          where: {
            outputId: { in: outputIds },
            userId: user.id,
          },
          select: { outputId: true },
        })
      : []
    const bookmarkedOutputIds = new Set(bookmarks.map(b => b.outputId))

    // Add isBookmarked to outputs
    const outputsWithBookmarks = generation.outputs.map(output => ({
      ...output,
      isBookmarked: bookmarkedOutputIds.has(output.id),
    }))

    // Return full generation data for cache updates (used by realtime hook)
    return NextResponse.json({
      id: generation.id,
      sessionId: generation.sessionId,
      userId: generation.userId,
      modelId: generation.modelId,
      prompt: generation.prompt,
      negativePrompt: generation.negativePrompt,
      parameters: generation.parameters,
      status: generation.status,
      cost: generation.cost,
      createdAt: generation.createdAt,
      outputs: outputsWithBookmarks,
      // Include ownership flag for UI
      isOwner: generation.userId === user.id,
    })
  } catch (error: any) {
    console.error('Error fetching generation:', error)
    return NextResponse.json(
      { error: 'Failed to fetch generation', details: error.message },
      { status: 500 }
    )
  }
}

// PATCH /api/generations/[id] - Update generation status (e.g., dismiss a stuck generation)
export async function PATCH(
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

    const generationId = params.id
    const body = await request.json()
    const { status } = body

    if (!generationId) {
      return NextResponse.json(
        { error: 'Generation ID is required' },
        { status: 400 }
      )
    }

    // Only allow setting status to 'dismissed'
    if (status !== 'dismissed') {
      return NextResponse.json(
        { error: 'Only status "dismissed" is allowed' },
        { status: 400 }
      )
    }

    // Fetch the generation
    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
    })

    if (!generation) {
      return NextResponse.json(
        { error: 'Generation not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (generation.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Update the generation status to 'dismissed'
    const updated = await prisma.generation.update({
      where: { id: generationId },
      data: { status: 'dismissed' },
    })

    return NextResponse.json({
      id: generationId,
      status: updated.status,
      message: 'Generation dismissed successfully',
    })
  } catch (error: any) {
    console.error('Error dismissing generation:', error)
    return NextResponse.json(
      { error: 'Failed to dismiss generation', details: error.message },
      { status: 500 }
    )
  }
}

export async function DELETE(
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

    const generationId = params.id

    if (!generationId) {
      return NextResponse.json(
        { error: 'Generation ID is required' },
        { status: 400 }
      )
    }

    // Fetch the generation
    const generation = await prisma.generation.findUnique({
      where: { id: generationId },
    })

    if (!generation) {
      return NextResponse.json(
        { error: 'Generation not found' },
        { status: 404 }
      )
    }

    // Verify ownership
    if (generation.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Only allow deleting cancelled, failed, or dismissed generations
    if (generation.status !== 'cancelled' && generation.status !== 'failed' && generation.status !== 'dismissed') {
      return NextResponse.json(
        { error: 'Can only delete cancelled, failed, or dismissed generations' },
        { status: 400 }
      )
    }

    // Delete associated outputs first (if any)
    await prisma.output.deleteMany({
      where: { generationId },
    })

    // Delete the generation
    await prisma.generation.delete({
      where: { id: generationId },
    })

    return NextResponse.json({
      id: generationId,
      message: 'Generation deleted successfully',
    })
  } catch (error: any) {
    console.error('Error deleting generation:', error)
    return NextResponse.json(
      { error: 'Failed to delete generation', details: error.message },
      { status: 500 }
    )
  }
}

