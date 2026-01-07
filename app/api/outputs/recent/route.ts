import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// GET /api/outputs/recent - Get recent outputs for the current user
export async function GET(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '12'), 24)

    // Fetch recent outputs for the user's generations
    const recentOutputs = await prisma.output.findMany({
      where: {
        generation: {
          userId: user.id,
          status: 'completed',
        },
      },
      include: {
        generation: {
          select: {
            id: true,
            prompt: true,
            modelId: true,
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
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    })

    return NextResponse.json(recentOutputs)
  } catch (error) {
    console.error('Error fetching recent outputs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recent outputs' },
      { status: 500 }
    )
  }
}

