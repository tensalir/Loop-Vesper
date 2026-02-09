import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getProviderSnapshot, UsageSnapshot } from '@/lib/rate-limits/usage'
import { getBlockedProviders } from '@/lib/rate-limits/trackedFetch'

export const dynamic = 'force-dynamic'

/**
 * GET /api/analytics/rate-limits
 * Returns rate limit status and usage for Gemini and Replicate (admin only)
 */
export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // SECURITY: Only admins can view rate limits
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin access required' }, { status: 403 })
    }

    // Get usage snapshots for all providers/scopes
    const snapshot = await getProviderSnapshot()
    
    // Get any temporarily blocked providers (from 429 responses)
    const blockedProviders = getBlockedProviders()

    // Update fallback status based on blocked providers
    const geminiNanaBananaBlocked = blockedProviders.some(
      b => b.provider === 'gemini' && b.scope === 'gemini-nano-banana-pro'
    )
    const geminiVeoBlocked = blockedProviders.some(
      b => b.provider === 'gemini' && b.scope === 'gemini-veo-3.1'
    )

    // Derive overall status for the header badge
    // 'ok' = all good, 'limited' = approaching limits, 'blocked' = at least one scope blocked
    let overallStatus: 'ok' | 'limited' | 'blocked' = 'ok'
    
    if (snapshot.gemini.overall === 'blocked' || geminiNanaBananaBlocked || geminiVeoBlocked) {
      overallStatus = 'blocked'
    } else if (snapshot.gemini.overall === 'limited') {
      overallStatus = 'limited'
    }

    // Detect which Google backend is configured
    const hasVertexCredentials = !!(
      process.env.GOOGLE_CLOUD_PROJECT_ID && 
      (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
    )
    const hasGeminiApiKey = !!process.env.GEMINI_API_KEY
    
    // Determine active Google backend
    // Priority: Vertex AI > Gemini API
    let googleBackend: 'vertex' | 'gemini-api' | 'none' = 'none'
    if (hasVertexCredentials) {
      googleBackend = 'vertex'
    } else if (hasGeminiApiKey) {
      googleBackend = 'gemini-api'
    }

    // Format the response for the frontend
    return NextResponse.json({
      status: overallStatus,
      googleBackend, // 'vertex' | 'gemini-api' | 'none'
      gemini: {
        nanoBanana: {
          ...formatUsageSnapshot(snapshot.gemini.nanoBanana),
          temporarilyBlocked: geminiNanaBananaBlocked,
          fallbackActive: geminiNanaBananaBlocked || snapshot.gemini.nanoBanana.status === 'blocked',
        },
        veo: {
          ...formatUsageSnapshot(snapshot.gemini.veo),
          temporarilyBlocked: geminiVeoBlocked,
          fallbackActive: geminiVeoBlocked || snapshot.gemini.veo.status === 'blocked',
        },
        overall: snapshot.gemini.overall,
      },
      replicate: {
        kling: formatUsageSnapshot(snapshot.replicate.kling),
        nanoBanana: formatUsageSnapshot(snapshot.replicate.nanoBanana),
        overall: snapshot.replicate.overall,
      },
      blockedProviders: blockedProviders.map(b => ({
        provider: b.provider,
        scope: b.scope,
        resetInSeconds: b.remainingSeconds,
      })),
      lastUpdated: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Error fetching rate limits:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rate limits', details: error.message },
      { status: 500 }
    )
  }
}

/**
 * Format usage snapshot for API response
 */
function formatUsageSnapshot(snapshot: UsageSnapshot) {
  return {
    status: snapshot.status,
    minute: {
      used: snapshot.minute.used,
      limit: snapshot.minute.limit,
      remaining: snapshot.minute.remaining,
      resetInSeconds: snapshot.minute.resetInSeconds,
      percentage: snapshot.minute.limit > 0 
        ? Math.round((snapshot.minute.used / snapshot.minute.limit) * 100) 
        : 0,
    },
    month: {
      used: snapshot.month.used,
      limit: snapshot.month.limit,
      remaining: snapshot.month.remaining,
      resetInSeconds: snapshot.month.resetInSeconds,
      percentage: snapshot.month.limit > 0 
        ? Math.round((snapshot.month.used / snapshot.month.limit) * 100) 
        : 0,
    },
  }
}
