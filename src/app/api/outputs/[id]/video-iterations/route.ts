import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/outputs/[id]/video-iterations
 * 
 * Returns video generations that were created from a specific image output.
 * These are identified by `parameters.sourceOutputId` matching the output ID.
 * 
 * Query params:
 *   - limit: max iterations to return (default 10)
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

    const userId = user.id
    const outputId = params.id
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50)

    // First, verify the output exists and user has access via project ownership/membership
    const sourceOutput = await prisma.output.findUnique({
      where: { id: outputId },
      include: {
        generation: {
          include: {
            session: {
              include: {
                project: {
                  include: {
                    members: {
                      where: { userId },
                      select: { userId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!sourceOutput) {
      return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    }

    const project = sourceOutput.generation.session.project
    const isOwner = project.ownerId === userId
    const isMember = project.members.length > 0
    const isPublicProject = project.isShared === true

    if (!isOwner && !isMember && !isPublicProject) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // If project is shared, show all video iterations; otherwise only current user's
    const showAllIterations = isOwner || project.isShared

    // Query video generations where parameters.sourceOutputId matches
    // Using raw query for JSONB filtering since Prisma's JSON support is limited
    const iterations = await prisma.$queryRaw<Array<{
      id: string
      session_id: string
      user_id: string
      model_id: string
      prompt: string
      negative_prompt: string | null
      parameters: any
      status: string
      cost: string | null
      created_at: Date
      session_name: string
      session_type: string
    }>>`
      SELECT 
        g.id,
        g.session_id,
        g.user_id,
        g.model_id,
        g.prompt,
        g.negative_prompt,
        g.parameters,
        g.status,
        g.cost,
        g.created_at,
        s.name as session_name,
        s.type as session_type
      FROM generations g
      JOIN sessions s ON g.session_id = s.id
      WHERE s.type = 'video'
        AND g.parameters->>'sourceOutputId' = ${outputId}
        AND (${showAllIterations} OR g.user_id = ${userId}::uuid)
      ORDER BY g.created_at DESC
      LIMIT ${limit}
    `

    // Fetch outputs for these generations
    const generationIds = iterations.map((i) => i.id)
    const outputs = generationIds.length > 0
      ? await prisma.output.findMany({
          where: { generationId: { in: generationIds } },
          orderBy: { createdAt: 'asc' },
        })
      : []

    // Fetch bookmarks for these outputs
    const outputIds = outputs.map((o) => o.id)
    const bookmarks = outputIds.length > 0
      ? await prisma.bookmark.findMany({
          where: {
            outputId: { in: outputIds },
            userId,
          },
          select: { outputId: true },
        })
      : []
    const bookmarkedOutputIds = new Set(bookmarks.map((b) => b.outputId))

    // Group outputs by generation
    type OutputSubset = {
      id: string
      fileUrl: string
      fileType: string
      width: number | null
      height: number | null
      duration: number | null
      createdAt: Date
      isBookmarked: boolean
    }
    const outputsByGeneration = outputs.reduce((acc, output) => {
      if (!acc[output.generationId]) {
        acc[output.generationId] = []
      }
      acc[output.generationId].push({
        id: output.id,
        fileUrl: output.fileUrl,
        fileType: output.fileType,
        width: output.width,
        height: output.height,
        duration: output.duration,
        createdAt: output.createdAt,
        isBookmarked: bookmarkedOutputIds.has(output.id),
      })
      return acc
    }, {} as Record<string, OutputSubset[]>)

    // Format response
    const data = iterations.map((iteration) => ({
      id: iteration.id,
      sessionId: iteration.session_id,
      userId: iteration.user_id,
      modelId: iteration.model_id,
      prompt: iteration.prompt,
      negativePrompt: iteration.negative_prompt,
      // Sanitize parameters - strip debug/internal fields
      parameters: {
        aspectRatio: iteration.parameters?.aspectRatio,
        resolution: iteration.parameters?.resolution,
        duration: iteration.parameters?.duration,
        sourceOutputId: iteration.parameters?.sourceOutputId,
        referenceImageUrl: iteration.parameters?.referenceImageUrl,
      },
      status: iteration.status,
      cost: iteration.cost ? parseFloat(iteration.cost) : null,
      createdAt: iteration.created_at,
      // Indicate if current user owns this iteration (for delete permissions in UI)
      isOwner: iteration.user_id === userId,
      session: {
        id: iteration.session_id,
        name: iteration.session_name,
        type: iteration.session_type,
      },
      outputs: outputsByGeneration[iteration.id] || [],
    }))

    // Compute summary stats
    // Treat both queued + processing as "active" so UI can show glow/poll immediately.
    const hasProcessing = data.some((d) => d.status === 'processing' || d.status === 'queued')
    const latestStatus = data[0]?.status || null

    return NextResponse.json({
      iterations: data,
      count: data.length,
      hasProcessing,
      latestStatus,
      sourceOutputId: outputId,
    })
  } catch (error) {
    console.error('Error fetching video iterations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch video iterations' },
      { status: 500 }
    )
  }
}

