/**
 * Figma batch ingest: parse Figma links from stored Monday data (SyncLink),
 * fetch comments and file metadata for each file, persist feedback events.
 * Reuses reconciliation for missing resolve transitions.
 */

import { prisma } from '@/lib/prisma'
import { parseFigmaFileFeedback } from './figmaFeedbackParser'
import { persistEvent } from './normalize'
import { reconcileFigmaFileComments } from './reconcile'

export interface FigmaBatchIngestResult {
  filesProcessed: number
  eventsInserted: number
  eventsSkipped: number
  reconcileResults: Array<{ fileKey: string; resolveInserted: number; resolveSkipped: number }>
}

/**
 * Get distinct Figma file keys from SyncLink (from Monday ingest or existing links).
 */
export async function getFigmaFileKeysFromLinks(options?: { limit?: number }): Promise<string[]> {
  const rows = await prisma.syncLink.findMany({
    where: { figmaFileKey: { not: null } },
    select: { figmaFileKey: true },
    distinct: ['figmaFileKey'],
    take: options?.limit ?? 200,
  })
  return rows.map((r) => r.figmaFileKey!).filter(Boolean)
}

/**
 * Ingest Figma comments and file-level feedback for all linked files.
 * Persists feedback events and runs reconciliation for resolve transitions.
 */
export async function runFigmaBatchIngest(options?: {
  fileKeyLimit?: number
}): Promise<FigmaBatchIngestResult> {
  const fileKeys = await getFigmaFileKeysFromLinks({ limit: options?.fileKeyLimit ?? 200 })
  let eventsInserted = 0
  let eventsSkipped = 0
  const reconcileResults: Array<{ fileKey: string; resolveInserted: number; resolveSkipped: number }> = []

  for (const fileKey of fileKeys) {
    try {
      const parsed = await parseFigmaFileFeedback(fileKey)
      for (const { events, link } of parsed) {
        for (const ev of events) {
          const result = await persistEvent({ payload: ev, link })
          if (result.inserted) eventsInserted++
          else eventsSkipped++
        }
      }
      const rec = await reconcileFigmaFileComments(fileKey)
      reconcileResults.push({
        fileKey,
        resolveInserted: rec.resolveEventsInserted,
        resolveSkipped: rec.resolveEventsSkipped,
      })
    } catch (err) {
      console.warn(`[FigmaBatchIngest] ${fileKey}:`, err)
    }
  }

  return {
    filesProcessed: fileKeys.length,
    eventsInserted,
    eventsSkipped,
    reconcileResults,
  }
}
