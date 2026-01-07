import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering since we use cookies
export const dynamic = 'force-dynamic'

/**
 * Debug endpoint to check for stuck processing generations
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

    // SECURITY: Only show user's own stuck generations
    // Find generations stuck in processing for more than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    
    const stuckGenerations = await prisma.generation.findMany({
      where: {
        userId: session.user.id, // Only own generations
        status: 'processing',
        createdAt: {
          lt: fiveMinutesAgo,
        },
      },
      select: {
        id: true,
        status: true,
        modelId: true,
        createdAt: true,
        prompt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 10,
    })

    return NextResponse.json({
      stuckCount: stuckGenerations.length,
      stuckGenerations,
    })
  } catch (error) {
    console.error('Error checking stuck generations:', error)
    return NextResponse.json(
      { error: 'Failed to check stuck generations' },
      { status: 500 }
    )
  }
}
