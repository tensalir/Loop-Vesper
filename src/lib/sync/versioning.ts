/**
 * Event ordering and versioning rules for sync timeline.
 * Ensures chronological, queryable timeline across Monday/Figma/Frontify.
 */

import type { SyncEventPayload } from './contracts'

/** Composite sort key: occurredAt (ISO) then idempotencyKey for tie-break. */
export function eventSortKey(payload: SyncEventPayload): string {
  return `${payload.occurredAt}\t${payload.idempotencyKey}`
}

/** Compare two events for chronological order. */
export function compareEvents(a: SyncEventPayload, b: SyncEventPayload): number {
  const ta = a.occurredAt
  const tb = b.occurredAt
  if (ta !== tb) return ta.localeCompare(tb)
  return a.idempotencyKey.localeCompare(b.idempotencyKey)
}

/** Validate occurredAt is ISO-like and use as canonical time. */
export function normalizeOccurredAt(occurredAt: string | undefined): string {
  if (!occurredAt) return new Date().toISOString()
  const d = new Date(occurredAt)
  if (Number.isNaN(d.getTime())) return new Date().toISOString()
  return d.toISOString()
}

/** Version string for ordering: ISO timestamp preferred. */
export function nextVersion(previousVersion?: string): string {
  const now = new Date().toISOString()
  if (!previousVersion) return now
  if (previousVersion >= now) return `${now}-${Math.random().toString(36).slice(2, 8)}`
  return now
}
