/**
 * Reconciliation: backfill missed comment resolve/state transitions from Figma.
 * Fetches current comments from Figma API and persists any new resolve events not yet in SyncEvent.
 */

import { prisma } from '@/lib/prisma'
import { getFileComments } from '@/lib/figma/client'
import { persistEvent, toFeedbackEvent } from './normalize'
import type { CreativeWorkItem } from './contracts'

export interface ReconcileResult {
  fileKey: string
  commentsChecked: number
  resolveEventsInserted: number
  resolveEventsSkipped: number
}

/**
 * Reconcile Figma comments for a file: fetch current comments, emit resolve events for any
 * resolved comments we don't yet have in sync_events, and persist them.
 */
export async function reconcileFigmaFileComments(fileKey: string): Promise<ReconcileResult> {
  const comments = await getFileComments(fileKey)
  let resolveEventsInserted = 0
  let resolveEventsSkipped = 0

  for (const c of comments) {
    if (!c.resolved_at) continue
    const baseLink: CreativeWorkItem = {
      figmaFileKey: fileKey,
      figmaNodeId: c.client_meta?.node_id?.[0],
    }
    const resolveEvent = toFeedbackEvent('figma', c.id, c.resolved_at, 'resolve', {
      resolved: true,
      idempotencySubId: 'resolved',
      link: baseLink,
    })
    const result = await persistEvent({ payload: resolveEvent, link: baseLink })
    if (result.inserted) resolveEventsInserted++
    else resolveEventsSkipped++
  }

  return {
    fileKey,
    commentsChecked: comments.length,
    resolveEventsInserted,
    resolveEventsSkipped,
  }
}

/**
 * Reconcile all Figma files we have links for. Uses SyncLink rows with figmaFileKey set.
 */
export async function reconcileAllFigmaFiles(options?: { limit?: number }): Promise<ReconcileResult[]> {
  const links = await prisma.syncLink.findMany({
    where: { figmaFileKey: { not: null } },
    select: { figmaFileKey: true },
    distinct: ['figmaFileKey'],
    take: options?.limit ?? 50,
  })
  const fileKeys = links.map((l) => l.figmaFileKey).filter(Boolean) as string[]
  const results: ReconcileResult[] = []
  for (const fileKey of fileKeys) {
    try {
      results.push(await reconcileFigmaFileComments(fileKey))
    } catch (e) {
      console.warn(`[Sync Reconcile] Failed for file ${fileKey}:`, e)
    }
  }
  return results
}
