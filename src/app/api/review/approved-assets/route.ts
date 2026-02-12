/**
 * GET /api/review/approved-assets
 * Unified approved records from sync timeline (Monday + Figma + Frontify).
 * Query: month, batch, source, matchStatus
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { PAID_SOCIAL_BOARD_ID } from '@/lib/sync/mondayBatchIngest'

export const dynamic = 'force-dynamic'

export interface ApprovedAssetRecord {
  linkId: string
  mondayItemId: string | null
  name: string
  month: string | null
  batch: string | null
  final_link: string | null
  link_for_review: string | null
  figma_file_key: string | null
  matchStatus: 'matched' | 'unmatched'
  matchConfidence: number | null
  matchRationale: string | null
  matchedFrontifyAssetId: string | null
  hasApproval: boolean
}

export async function GET(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') ?? undefined
  const batch = searchParams.get('batch') ?? undefined
  const matchStatus = searchParams.get('matchStatus') ?? undefined

  try {
    const mondayLinks = await prisma.syncLink.findMany({
      where: {
        mondayBoardId: PAID_SOCIAL_BOARD_ID,
        mondayItemId: { not: null },
      },
      select: { id: true, mondayItemId: true, frontifyAssetId: true },
    })

    const linkIds = mondayLinks.map((l) => l.id)
    const revisionEvents = await prisma.syncEvent.findMany({
      where: { linkId: { in: linkIds }, kind: 'revision', source: 'monday' },
      select: { linkId: true, payload: true },
      orderBy: { occurredAt: 'desc' },
    })
    const revByLink = new Map<string, Record<string, unknown>>()
    for (const e of revisionEvents) {
      if (e.linkId && !revByLink.has(e.linkId)) revByLink.set(e.linkId, (e.payload as Record<string, unknown>) ?? {})
    }

    const matchEvents = await prisma.syncEvent.findMany({
      where: { linkId: { in: linkIds }, kind: 'match' },
      select: { linkId: true, payload: true },
    })
    const matchByLink = new Map(
      matchEvents.map((e) => [
        e.linkId,
        e.payload as {
          matchConfidence?: number
          matchRationale?: string
          matchedFrontifyAssetId?: string
        },
      ])
    )

    const approvalLinkIds = new Set(
      (await prisma.syncEvent.findMany({
        where: { linkId: { in: linkIds }, kind: 'approval', source: 'frontify' },
        select: { linkId: true },
      }))
        .map((e) => e.linkId)
        .filter(Boolean)
    )

    const records: ApprovedAssetRecord[] = []
    for (const link of mondayLinks) {
      const rev = revByLink.get(link.id) ?? {}
      const revMonth = typeof rev.month === 'string' ? rev.month : null
      const revBatch = typeof rev.batch === 'string' ? rev.batch : null
      if (month && revMonth !== month) continue
      if (batch && revBatch !== batch) continue

      const match = matchByLink.get(link.id)
      const matchedFrontifyAssetId =
        typeof match?.matchedFrontifyAssetId === 'string' ? match.matchedFrontifyAssetId : null
      const matchConfidence = typeof match?.matchConfidence === 'number' ? match.matchConfidence : null
      const matchRationale = typeof match?.matchRationale === 'string' ? match.matchRationale : null
      const status: 'matched' | 'unmatched' = matchedFrontifyAssetId && (matchConfidence ?? 0) > 0 ? 'matched' : 'unmatched'
      if (matchStatus && status !== matchStatus) continue

      records.push({
        linkId: link.id,
        mondayItemId: link.mondayItemId,
        name: typeof rev.name === 'string' ? rev.name : '—',
        month: revMonth,
        batch: revBatch,
        final_link: typeof rev.final_link === 'string' ? rev.final_link : null,
        link_for_review: typeof rev.link_for_review === 'string' ? rev.link_for_review : null,
        figma_file_key: typeof rev.figma_file_key === 'string' ? rev.figma_file_key : null,
        matchStatus: status,
        matchConfidence,
        matchRationale,
        matchedFrontifyAssetId,
        hasApproval: link.frontifyAssetId != null || approvalLinkIds.has(link.id),
      })
    }

    return NextResponse.json(records)
  } catch (err) {
    console.error('[review/approved-assets]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch approved assets' },
      { status: 500 }
    )
  }
}
