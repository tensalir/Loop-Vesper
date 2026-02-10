/**
 * Figma webhook handler (FILE_COMMENT, FILE_UPDATE, PING).
 * Hydrates comments via Figma API when file_key present, normalizes to SyncEvent, persists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getFileComments } from '@/lib/figma/client'
import { persistEvent, persistEvents, toFeedbackEvent } from '@/lib/sync/normalize'
import type { CreativeWorkItem } from '@/lib/sync/contracts'

export const dynamic = 'force-dynamic'

interface FigmaWebhookPayload {
  event_type?: string
  file_key?: string
  file_name?: string
  timestamp?: string
  passcode?: string
  comment_id?: string
  comment?: { id?: string; message?: string; user?: { id: string } }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FigmaWebhookPayload
    const eventType = body.event_type ?? (body as unknown as Record<string, string>).event_type
    const fileKey = body.file_key ?? (body as unknown as Record<string, string>).file_key

    if (eventType === 'PING' || !eventType) {
      return NextResponse.json({ received: true })
    }

    const occurredAt =
      body.timestamp ?? (body as unknown as Record<string, string>).timestamp ?? new Date().toISOString()
    const link: CreativeWorkItem | undefined =
      fileKey ? { figmaFileKey: fileKey } : undefined

    if (eventType === 'FILE_COMMENT' && fileKey) {
      const comments = await getFileComments(fileKey)
      const inputs = comments.flatMap((c) => {
        const baseLink: CreativeWorkItem = { figmaFileKey: fileKey, figmaNodeId: c.client_meta?.node_id?.[0] }
        const events = []
        events.push(
          toFeedbackEvent(
            'figma',
            c.id,
            c.created_at,
            c.parent_id ? 'reply' : 'comment',
            {
              content: c.message,
              actorId: c.user?.id,
              actorName: c.user?.handle,
              parentId: c.parent_id ?? undefined,
              figmaNodeId: c.client_meta?.node_id?.[0],
              link: baseLink,
              payload: { order_id: c.order_id },
            }
          )
        )
        if (c.resolved_at)
          events.push(
            toFeedbackEvent('figma', c.id, c.resolved_at, 'resolve', {
              resolved: true,
              idempotencySubId: 'resolved',
              link: baseLink,
            })
          )
        return events.map((payload) => ({ payload, link: baseLink }))
      })
      const { inserted, skipped } = await persistEvents(
        inputs.map((p) => ({ payload: p.payload, link: p.link }))
      )
      console.log(`[Figma Webhook] FILE_COMMENT file=${fileKey} inserted=${inserted} skipped=${skipped}`)
      return NextResponse.json({ received: true, inserted, skipped })
    }

    if (eventType === 'FILE_UPDATE' && fileKey) {
      const { toRevisionEvent } = await import('@/lib/sync/normalize')
      const revision = toRevisionEvent(
        'figma',
        `file:${fileKey}:${occurredAt}`,
        occurredAt,
        { file_name: body.file_name, event_type: eventType },
        { link }
      )
      const result = await persistEvent({ payload: revision, link })
      console.log(`[Figma Webhook] FILE_UPDATE file=${fileKey} inserted=${result.inserted}`)
      return NextResponse.json({ received: true, inserted: result.inserted })
    }

    return NextResponse.json({ received: true })
  } catch (e) {
    console.error('[Figma Webhook] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Webhook failed' },
      { status: 500 }
    )
  }
}
