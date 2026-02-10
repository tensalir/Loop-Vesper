/**
 * Admin sync status: link/event counts, replay backlog, rollout phase.
 * GET: return status. POST: optional replay trigger and phase override.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getSyncRolloutPhase, setSyncRolloutPhase } from '@/lib/sync/metrics'
import type { RolloutPhase } from '@/lib/sync/metrics'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [linkCount, eventCount, eventBySource, oldestEvent] = await Promise.all([
    prisma.syncLink.count(),
    prisma.syncEvent.count(),
    prisma.syncEvent.groupBy({
      by: ['source'],
      _count: { id: true },
    }),
    prisma.syncEvent.findFirst({
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    }),
  ])

  const phase = getSyncRolloutPhase()
  return NextResponse.json({
    phase,
    links: linkCount,
    events: eventCount,
    eventsBySource: Object.fromEntries(eventBySource.map((s) => [s.source, s._count.id])),
    oldestEventAt: oldestEvent?.occurredAt ?? null,
  })
}

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { phase?: RolloutPhase }
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  if (body.phase != null) {
    setSyncRolloutPhase(body.phase)
  }

  const phase = getSyncRolloutPhase()
  return NextResponse.json({ phase, message: 'OK' })
}
