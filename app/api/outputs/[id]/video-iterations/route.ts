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
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id
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

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

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
      WHERE g.user_id = ${userId}::uuid
        AND s.type = 'video'
        AND g.parameters->>'sourceOutputId' = ${outputId}
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

    // Group outputs by generation
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
      })
      return acc
    }, {} as Record<string, typeof outputs>)

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
      session: {
        id: iteration.session_id,
        name: iteration.session_name,
        type: iteration.session_type,
      },
      outputs: outputsByGeneration[iteration.id] || [],
    }))

    // Compute summary stats
    const hasProcessing = data.some((d) => d.status === 'processing')
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

