/**
 * Monday batch ingest for Paid Social Experiments board (Main tab).
 * Paginated read of board 9147622374; normalizes columns and persists SyncEvent + SyncLink (read-only).
 */

import { fetchAllBoardItems, type MondayItem } from '@/lib/monday/client'
import type { CreativeWorkItem } from './contracts'
import { toRevisionEvent } from './normalize'
import { persistEvent } from './normalize'

export const PAID_SOCIAL_BOARD_ID = '9147622374'

/** Column key = title lowercase, spaces -> underscores */
function columnMap(item: MondayItem): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {}
  for (const col of item.column_values ?? []) {
    const key = col.title ? col.title.toLowerCase().replace(/\s+/g, '_') : col.id
    if (col.text != null) out[key] = col.text
    else if (col.value != null) {
      try {
        const parsed = JSON.parse(col.value)
        if (typeof parsed === 'object' && parsed !== null && 'text' in parsed) out[key] = parsed.text
        else if (typeof parsed === 'string') out[key] = parsed
        else if (typeof parsed === 'number') out[key] = parsed
        else out[key] = col.value
      } catch {
        out[key] = col.value
      }
    }
  }
  return out
}

/** Extract Figma file key from URL (e.g. figma.com/file/ABC123/... -> ABC123). */
function figmaFileKeyFromUrl(url: string | null | undefined): string | undefined {
  if (!url || typeof url !== 'string') return undefined
  const match = url.match(/figma\.com\/file\/([A-Za-z0-9]+)/)
  return match?.[1]
}

/** Get string value from column map with optional title variants. */
function getCol(col: Record<string, string | number | null>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = col[k]
    if (v != null && String(v).trim() !== '') return String(v).trim()
  }
  return null
}

/** Derive month string (YYYY-MM) from a date column value if present. */
function monthFromCol(col: Record<string, string | number | null>): string | null {
  const deadline = getCol(
    col,
    'deadline_final_assets',
    'deadline',
    'date',
    'final_assets_deadline'
  )
  if (!deadline) return null
  const d = new Date(deadline)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export interface MondayBatchIngestResult {
  processed: number
  inserted: number
  skipped: number
}

/**
 * Ingest all items from Paid Social Experiments board (Main tab).
 * Uses paginated fetch; includes active items (archived require known IDs per Monday API).
 * Persists one RevisionEvent per item with normalized batch/month/link data.
 */
export async function runMondayBatchIngest(
  options?: { pageSize?: number; maxItems?: number }
): Promise<MondayBatchIngestResult> {
  const items = await fetchAllBoardItems(PAID_SOCIAL_BOARD_ID, {
    pageSize: options?.pageSize ?? 100,
    maxItems: options?.maxItems ?? 10_000,
  })
  let inserted = 0
  let skipped = 0
  const occurredAt = new Date().toISOString()

  for (const item of items) {
    const col = columnMap(item)
    const batch = getCol(col, 'batch', 'batch_name')
    const linkForReview = getCol(col, 'link_for_review', 'figma_link', 'link for review')
    const finalLink = getCol(col, 'final_link', 'final_link_url', 'final link', 'link_final')
    const month = monthFromCol(col) ?? undefined
    const figmaFileKey = figmaFileKeyFromUrl(linkForReview) ?? undefined

    const payload: Record<string, unknown> = {
      batch: batch ?? undefined,
      month,
      link_for_review: linkForReview ?? undefined,
      final_link: finalLink ?? undefined,
      name: item.name,
      figma_file_key: figmaFileKey,
    }

    const link: CreativeWorkItem = {
      mondayItemId: item.id,
      mondayBoardId: PAID_SOCIAL_BOARD_ID,
      figmaFileKey: figmaFileKey || undefined,
    }

    const revision = toRevisionEvent('monday', item.id, occurredAt, payload, { link })
    const result = await persistEvent({ payload: revision, link })
    if (result.inserted) inserted++
    else skipped++
  }

  return { processed: items.length, inserted, skipped }
}
