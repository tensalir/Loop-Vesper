import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering since we use cookies
export const dynamic = 'force-dynamic'

/**
 * Cleanup endpoint for stuck generations
 * Marks generations as failed if they've been processing > 2 minutes
 * Can be called manually or via cron job
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // SECURITY: Require admin role to clean up all stuck generations
    const profile = await prisma.profile.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 })
    }

    // Find generations stuck > 2 minutes (Vercel Pro timeout is 60s, so 2min is definitely stuck)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
    
    const stuckGenerations = await prisma.generation.findMany({
      where: {
        status: 'processing',
        createdAt: {
          lt: twoMinutesAgo,
        },
      },
    })

    if (stuckGenerations.length === 0) {
      return NextResponse.json({ 
        message: 'No stuck generations found',
        cleaned: 0 
      })
    }

    // Mark each as failed individually to preserve their parameters
    const cleanedIds: string[] = []
    for (const gen of stuckGenerations) {
      try {
        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: 'failed',
            parameters: {
              ...(gen.parameters as any || {}),
              error: 'Processing timed out - exceeded Vercel function execution limit',
              timeoutDetectedAt: new Date().toISOString(),
            },
          },
        })
        cleanedIds.push(gen.id)
      } catch (error) {
        console.error(`Failed to cleanup generation ${gen.id}:`, error)
      }
    }

    return NextResponse.json({
      message: `Cleaned up ${cleanedIds.length} stuck generation(s)`,
      cleaned: cleanedIds.length,
      generationIds: cleanedIds,
    })
  } catch (error: any) {
    console.error('Error cleaning up stuck generations:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to cleanup stuck generations' },
      { status: 500 }
    )
  }
}

