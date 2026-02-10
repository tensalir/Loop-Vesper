/**
 * Monday.com webhook handler.
 * Verification: respond with { challenge } when challenge is present.
 * Events: enrich via Monday API read-back, normalize to SyncEvent, persist.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMondayItem } from '@/lib/monday/client'
import { persistEvent, toRevisionEvent } from '@/lib/sync/normalize'
import type { CreativeWorkItem } from '@/lib/sync/contracts'

export const dynamic = 'force-dynamic'

/** Monday webhook verification payload. */
interface MondayChallengePayload {
  challenge?: string
}

/** Monday event payload (common pattern: event type + pulse/board). */
interface MondayEventPayload {
  event?: { type?: string }
  pulseId?: string
  boardId?: string
  userId?: string
  timestamp?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as MondayChallengePayload & MondayEventPayload

    if (body.challenge != null) {
      return NextResponse.json({ challenge: body.challenge })
    }

    const boardId = body.boardId ?? (body as unknown as Record<string, string>).board_id
    const itemId = body.pulseId ?? (body as unknown as Record<string, string>).pulse_id ?? (body as unknown as Record<string, string>).item_id
    if (!boardId || !itemId) {
      console.warn('[Monday Webhook] Missing boardId or itemId in payload')
      return NextResponse.json({ received: true })
    }

    const item = await getMondayItem(boardId, itemId)
    const occurredAt =
      (body as unknown as Record<string, string>).timestamp ?? new Date().toISOString()
    const externalId = `item:${itemId}:${occurredAt}`
    const link: CreativeWorkItem = {
      mondayItemId: String(itemId),
      mondayBoardId: String(boardId),
    }

    const revision = toRevisionEvent(
      'monday',
      externalId,
      occurredAt,
      {
        eventType: body.event?.type,
        itemName: item?.name,
        columnValues: item ? undefined : null,
      },
      { link }
    )
    revision.linkId = undefined
    const result = await persistEvent({ payload: revision, link })
    console.log(
      `[Monday Webhook] ${result.inserted ? 'Inserted' : 'Skipped'} event for item ${itemId}`
    )
    return NextResponse.json({ received: true, inserted: result.inserted })
  } catch (e) {
    console.error('[Monday Webhook] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Webhook failed' },
      { status: 500 }
    )
  }
}
