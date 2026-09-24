import { NextRequest, NextResponse } from 'next/server'
import { prismaOAuthStore } from '@/lib/oauth/store-prisma'

/**
 * GET /api/cron/oauth-cleanup — daily (vercel.json).
 *
 * Deletes what can no longer be used: authorization codes older than a day,
 * access tokens expired a week ago, refresh tokens expired a month ago. The
 * credentials themselves stay, with their usage history.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const removed = await prismaOAuthStore.cleanup(new Date())
  return NextResponse.json({ ok: true, removed })
}
