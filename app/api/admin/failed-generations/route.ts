import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

// Force dynamic rendering since we use cookies
export const dynamic = 'force-dynamic'

// Create admin client for auth operations
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase admin credentials')
  }
  
  return createClient(supabaseUrl, supabaseServiceKey)
}

/**
 * Admin endpoint to list all failed and stuck generations with user information
 * GET /api/admin/failed-generations?status=failed|stuck|all&userId=xxx&limit=50
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

    // SECURITY: Only admins can view all failed generations
    const profile = await prisma.profile.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get('status') || 'all' // 'failed', 'stuck', or 'all'
    const userId = searchParams.get('userId') // Optional: filter by specific user
    const limit = parseInt(searchParams.get('limit') || '50')
    const hoursAgo = parseInt(searchParams.get('hoursAgo') || '24') // Default: last 24 hours

    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000)
    const stuckThreshold = new Date(Date.now() - 10 * 60 * 1000) // 10 minutes for "stuck"

    // Build where clause
    const whereClause: any = {
      createdAt: {
        gte: cutoffTime,
      },
    }

    // Filter by user if provided
    if (userId) {
      whereClause.userId = userId
    }

    // Filter by status
    if (statusFilter === 'failed') {
      whereClause.status = 'failed'
    } else if (statusFilter === 'stuck') {
      whereClause.status = 'processing'
      whereClause.createdAt = {
        ...whereClause.createdAt,
        lt: stuckThreshold,
      }
    } else if (statusFilter === 'all') {
      // Include both failed and stuck
      whereClause.OR = [
        { status: 'failed' },
        {
          status: 'processing',
          createdAt: {
            ...whereClause.createdAt,
            lt: stuckThreshold,
          },
        },
      ]
    }

    // Fetch generations with user info
    const generations = await prisma.generation.findMany({
      where: whereClause,
      select: {
        id: true,
        sessionId: true,
        userId: true,
        modelId: true,
        prompt: true,
        status: true,
        parameters: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
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

    // Extract error messages from parameters
    const generationsWithErrors = generations.map((gen) => {
      const params = gen.parameters as any
      const errorMessage = params?.error || (gen.status === 'processing' ? 'Stuck in processing' : null)
      
      return {
        ...gen,
        errorMessage,
        isStuck: gen.status === 'processing' && gen.createdAt < stuckThreshold,
        ageMinutes: Math.floor((Date.now() - gen.createdAt.getTime()) / 1000 / 60),
      }
    })

    // Fetch user emails from Supabase Auth using admin client
    const userIds = Array.from(new Set(generationsWithErrors.map((g) => g.userId)))
    const userEmails: Record<string, string> = {}
    
    try {
      const supabaseAdmin = getSupabaseAdmin()
      for (const userId of userIds) {
        try {
          const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId)
          if (user?.email && !error) {
            userEmails[userId] = user.email
          }
        } catch (error) {
          // User might not exist in auth
          console.warn(`Could not fetch email for user ${userId}:`, error)
        }
      }
    } catch (error) {
      console.warn('Could not initialize Supabase admin client:', error)
    }

    // Group by user for summary
    const byUser: Record<string, { count: number; user: any; generations: typeof generationsWithErrors }> = {}
    for (const gen of generationsWithErrors) {
      const userId = gen.userId
      if (!byUser[userId]) {
        byUser[userId] = {
          count: 0,
          user: gen.user,
          generations: [],
        }
      }
      byUser[userId].count++
      byUser[userId].generations.push(gen)
    }

    return NextResponse.json({
      total: generationsWithErrors.length,
      summary: {
        failed: generationsWithErrors.filter((g) => g.status === 'failed').length,
        stuck: generationsWithErrors.filter((g) => g.isStuck).length,
      },
      byUser: Object.values(byUser).map((entry) => ({
        userId: entry.user.id,
        userDisplayName: entry.user.displayName || entry.user.username || 'Unknown',
        userEmail: userEmails[entry.user.id] || 'N/A',
        count: entry.count,
        generations: entry.generations,
      })),
      generations: generationsWithErrors,
    })
  } catch (error: any) {
    console.error('Error fetching failed generations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch failed generations', details: error.message },
      { status: 500 }
    )
  }
}

