import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering since we use cookies
export const dynamic = 'force-dynamic'

/**
 * User-facing endpoint to see their own failed and stuck generations
 * GET /api/generations/failed?sessionId=xxx&hoursAgo=24
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId') // Optional: filter by session
    const hoursAgo = parseInt(searchParams.get('hoursAgo') || '24') // Default: last 24 hours
    const limit = parseInt(searchParams.get('limit') || '50')

    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
    const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000) // 10 minutes for "stuck"

    // Build where clause - only user's own generations
    const whereClause: any = {
      userId: session.user.id,
      createdAt: {
        gte: cutoffTime,
      },
      OR: [
        { status: 'failed' },
        {
          status: 'processing',
          createdAt: {
            lt: stuckThreshold,
          },
        },
      ],
    }

    // Filter by session if provided
    if (sessionId) {
      whereClause.sessionId = sessionId
    }

    // Fetch generations
    const generations = await prisma.generation.findMany({
      where: whereClause,
      select: {
        id: true,
        sessionId: true,
        modelId: true,
        prompt: true,
        status: true,
        parameters: true,
        createdAt: true,
        session: {
          select: {
            id: true,
            name: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    })

    // Extract error messages and categorize
    const failedGenerations = generations
      .filter((g) => g.status === 'failed')
      .map((gen) => {
        const params = gen.parameters as any
        return {
          ...gen,
          errorMessage: params?.error || 'Generation failed',
          ageMinutes: Math.floor((Date.now() - gen.createdAt.getTime()) / 1000 / 60),
        }
      })

    const stuckGenerations = generations
      .filter((g) => g.status === 'processing' && g.createdAt < stuckThreshold)
      .map((gen) => {
        return {
          ...gen,
          errorMessage: 'Stuck in processing - may have timed out',
          ageMinutes: Math.floor((Date.now() - gen.createdAt.getTime()) / 1000 / 60),
          isStuck: true,
        }
      })

    return NextResponse.json({
      failed: {
        count: failedGenerations.length,
        generations: failedGenerations,
      },
      stuck: {
        count: stuckGenerations.length,
        generations: stuckGenerations,
      },
      total: generations.length,
    })
  } catch (error: any) {
    console.error('Error fetching failed generations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch failed generations', details: error.message },
      { status: 500 }
    )
  }
}





