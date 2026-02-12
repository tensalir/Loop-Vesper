/**
 * Admin sync status: link/event counts, replay backlog, rollout phase.
 * GET: return status + January batch metrics (matched, unmatched, Figma-readable, approved canonical).
 * POST: optional replay trigger and phase override.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getSyncRolloutPhase, setSyncRolloutPhase } from '@/lib/sync/metrics'
import type { RolloutPhase, SyncBatchMetrics } from '@/lib/sync/metrics'
import { PAID_SOCIAL_BOARD_ID } from '@/lib/sync/mondayBatchIngest'

export const dynamic = 'force-dynamic'

async function getBatchMetrics(): Promise<SyncBatchMetrics> {
  const mondayLinks = await prisma.syncLink.findMany({
    where: { mondayBoardId: PAID_SOCIAL_BOARD_ID, mondayItemId: { not: null } },
    select: { id: true, figmaFileKey: true, frontifyAssetId: true },
  })
  const mondayLinkCount = mondayLinks.length
  const figmaReadableCount = mondayLinks.filter((l) => l.figmaFileKey != null).length
  const approvedCanonicalCount = mondayLinks.filter((l) => l.frontifyAssetId != null).length

  const matchEvents = await prisma.syncEvent.findMany({
    where: { kind: 'match', linkId: { in: mondayLinks.map((l) => l.id) } },
    select: { linkId: true, payload: true },
  })
  const matchedLinkIds = new Set<string>()
  for (const e of matchEvents) {
    if (!e.linkId) continue
    const p = e.payload as { matchConfidence?: number; matchedFrontifyAssetId?: string }
    const confidence = p?.matchConfidence ?? 0
    const hasMatch = (p?.matchedFrontifyAssetId != null && p.matchedFrontifyAssetId !== '') && confidence > 0
    if (hasMatch) matchedLinkIds.add(e.linkId)
  }
  const matchedCount = matchedLinkIds.size
  const unmatchedCount = Math.max(0, mondayLinkCount - matchedCount)

  return {
    mondayLinkCount,
    figmaReadableCount,
    approvedCanonicalCount,
    matchedCount,
    unmatchedCount,
  }
}

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [linkCount, eventCount, eventBySource, oldestEvent, batchMetrics] = await Promise.all([
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
    getBatchMetrics(),
  ])

  const phase = getSyncRolloutPhase()
  return NextResponse.json({
    phase,
    links: linkCount,
    events: eventCount,
    eventsBySource: Object.fromEntries(eventBySource.map((s) => [s.source, s._count.id])),
    oldestEventAt: oldestEvent?.occurredAt ?? null,
    batchMetrics,
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
