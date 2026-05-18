import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import {
  assessGenerationLiveness,
  LIVENESS_DEFAULT_THRESHOLDS,
} from '@/lib/generation/liveness'

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
 * Cleanup endpoint for stuck generations
 * Marks generations as failed if they appear abandoned (no heartbeat for a while).
 * Can be called manually or via cron job
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // SECURITY: Require admin role to clean up all stuck generations
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 })
    }

    // "Stuck" heuristic — see [`src/lib/generation/liveness.ts`](src/lib/generation/liveness.ts).
    //
    // We must NOT mark these as failed:
    //  - Webhook-backed Replicate predictions inside their grace window
    //    (heartbeats stop after `process:skipped-webhook-active`, but the
    //    job is healthy and will resolve via the webhook).
    //  - Jobs the provider router rescheduled (`routingDelayed` +
    //    `routingRetryAt`) — the queue picks those up after the cool-off.
    //  - Recent rows that simply haven't started writing heartbeats yet.
    //
    // The shared `assessGenerationLiveness` helper enforces these rules so
    // the cleanup endpoint, the gallery UI, and the tests cannot drift.
    const MIN_AGE_MINUTES = LIVENESS_DEFAULT_THRESHOLDS.MIN_AGE_MINUTES
    const HEARTBEAT_STALE_MINUTES = LIVENESS_DEFAULT_THRESHOLDS.HEARTBEAT_STALE_MINUTES
    const WEBHOOK_GRACE_MINUTES = LIVENESS_DEFAULT_THRESHOLDS.WEBHOOK_GRACE_MINUTES
    const minAgeAgo = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000)

    const candidates = await prisma.generation.findMany({
      where: {
        status: 'processing',
        createdAt: {
          lt: minAgeAgo,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
      },
    })

    const now = Date.now()
    const skippedReasons: Record<string, number> = {}
    const stuckGenerations: typeof candidates = []
    for (const gen of candidates) {
      const liveness = assessGenerationLiveness(gen, {
        now,
        minAgeMinutes: MIN_AGE_MINUTES,
        heartbeatStaleMinutes: HEARTBEAT_STALE_MINUTES,
        webhookGraceMinutes: WEBHOOK_GRACE_MINUTES,
      })
      if (liveness.isStuck) {
        stuckGenerations.push(gen)
      } else {
        skippedReasons[liveness.reason] = (skippedReasons[liveness.reason] || 0) + 1
      }
    }

    if (stuckGenerations.length === 0) {
      return NextResponse.json({
        message: 'No stuck generations found',
        cleaned: 0,
        scanned: candidates.length,
        skippedReasons,
        heuristic: {
          minAgeMinutes: MIN_AGE_MINUTES,
          heartbeatStaleMinutes: HEARTBEAT_STALE_MINUTES,
          webhookGraceMinutes: WEBHOOK_GRACE_MINUTES,
        },
      })
    }

    // Mark each as failed individually to preserve their parameters
    const cleanedIds: string[] = []
    const cleanedByUser: Record<string, { userId: string; userEmail: string; count: number }> = {}
    
    for (const gen of stuckGenerations) {
      try {
        await prisma.generation.update({
          where: { id: gen.id },
          data: {
            status: 'failed',
            parameters: {
              ...(gen.parameters as any || {}),
              error: 'Processing appears stuck (no progress heartbeat)',
              timeoutDetectedAt: new Date().toISOString(),
            },
          },
        })
        cleanedIds.push(gen.id)
        
        // Track by user
        const userId = gen.userId
        if (!cleanedByUser[userId]) {
          // Try to get email from Supabase Auth using admin client
          let userEmail = 'unknown'
          try {
            const supabaseAdmin = getSupabaseAdmin()
            const { data: { user }, error } = await supabaseAdmin.auth.admin.getUserById(userId)
            if (user?.email && !error) {
              userEmail = user.email
            }
          } catch (error) {
            // User might not exist in auth
            console.warn(`Could not fetch email for user ${userId}:`, error)
          }
          
          cleanedByUser[userId] = {
            userId,
            userEmail,
            count: 0,
          }
        }
        cleanedByUser[userId].count++
      } catch (error) {
        console.error(`Failed to cleanup generation ${gen.id}:`, error)
      }
    }

    return NextResponse.json({
      message: `Cleaned up ${cleanedIds.length} stuck generation(s)`,
      cleaned: cleanedIds.length,
      scanned: candidates.length,
      skippedReasons,
      generationIds: cleanedIds,
      byUser: Object.values(cleanedByUser),
      heuristic: {
        minAgeMinutes: MIN_AGE_MINUTES,
        heartbeatStaleMinutes: HEARTBEAT_STALE_MINUTES,
        webhookGraceMinutes: WEBHOOK_GRACE_MINUTES,
      },
    })
  } catch (error: any) {
    console.error('Error cleaning up stuck generations:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to cleanup stuck generations' },
      { status: 500 }
    )
  }
}

