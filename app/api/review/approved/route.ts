import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// GET /api/review/approved - Get all approved outputs for the current user
export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch all approved outputs for the user's generations
    const approvedOutputs = await prisma.output.findMany({
      where: {
        isApproved: true,
        generation: {
          userId: user.id,
        },
      },
      include: {
        generation: {
          include: {
            session: {
              include: {
                project: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(approvedOutputs)
  } catch (error) {
    console.error('Error fetching approved outputs:', error)
    return NextResponse.json(
      { error: 'Failed to fetch approved outputs' },
      { status: 500 }
    )
  }
}

