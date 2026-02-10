/**
 * Canonical sync contracts for Monday–Figma–Frontify integration.
 * Normalized entities, idempotency keys, and authority/conflict policy for hybrid model.
 */

/** Cross-system key map for a single creative work item. */
export interface CreativeWorkItem {
  /** Monday item id (pulse id). */
  mondayItemId?: string
  /** Monday board id. */
  mondayBoardId?: string
  /** Figma file key. */
  figmaFileKey?: string
  /** Figma node id (frame or component). */
  figmaNodeId?: string
  /** Frontify asset id (approved final). */
  frontifyAssetId?: string
  /** Our internal link id once persisted. */
  linkId?: string
}

/** Source system for an event. */
export type EventSource = 'monday' | 'figma' | 'frontify'

/** Revision event: version, source, actor, timestamp. */
export interface RevisionEvent {
  /** Deterministic idempotency key: source:externalId or source:externalId:subId. */
  idempotencyKey: string
  source: EventSource
  /** External id from source (e.g. Monday update id, Figma comment id). */
  externalId: string
  /** Version / sequence hint for ordering (e.g. timestamp or version number). */
  version: string
  /** Actor id or handle from source. */
  actorId?: string
  actorName?: string
  /** ISO timestamp from source when available. */
  occurredAt: string
  /** Payload type for routing. */
  kind: 'revision'
  /** Optional link id this event belongs to. */
  linkId?: string
  /** Opaque payload for revision details. */
  payload?: Record<string, unknown>
}

/** Feedback types: comment, reply, resolve, frame_text, frame_note. */
export type FeedbackKind = 'comment' | 'reply' | 'resolve' | 'frame_text' | 'frame_note'

/** Feedback event: comment, reply, resolve, or structured frame text/note. */
export interface FeedbackEvent {
  idempotencyKey: string
  source: EventSource
  externalId: string
  version: string
  actorId?: string
  actorName?: string
  occurredAt: string
  kind: 'feedback'
  feedbackKind: FeedbackKind
  /** Parent comment id for replies; thread id for resolve. */
  parentId?: string
  /** Resolved state when feedbackKind is resolve. */
  resolved?: boolean
  /** Plain text content. */
  content?: string
  /** For frame_text/frame_note: optional language tag (e.g. en, de). */
  languageTag?: string
  /** Figma node id if attached to a node. */
  figmaNodeId?: string
  linkId?: string
  payload?: Record<string, unknown>
}

/** Approval event: Frontify approved/live. */
export interface ApprovalEvent {
  idempotencyKey: string
  source: 'frontify'
  externalId: string
  version: string
  occurredAt: string
  kind: 'approval'
  /** Frontify asset id. */
  frontifyAssetId: string
  /** Approved/live status. */
  status: 'approved' | 'live'
  linkId?: string
  payload?: Record<string, unknown>
}

export type SyncEventPayload = RevisionEvent | FeedbackEvent | ApprovalEvent

/** Authority domain for conflict policy: Monday = workflow/status, Figma = creative/localization. */
export type AuthorityDomain = 'monday_workflow' | 'figma_creative'

/** Conflict policy: last-write-wins within same domain; cross-domain goes to reconciliation queue. */
export const AUTHORITY_BY_SOURCE: Record<EventSource, AuthorityDomain> = {
  monday: 'monday_workflow',
  figma: 'figma_creative',
  frontify: 'figma_creative', // approved assets treated as creative lineage
}

export function getAuthorityDomain(source: EventSource): AuthorityDomain {
  return AUTHORITY_BY_SOURCE[source]
}

/**
 * Build deterministic idempotency key for dedupe.
 * Format: source:externalId or source:externalId:subId
 */
export function buildIdempotencyKey(
  source: EventSource,
  externalId: string,
  subId?: string
): string {
  if (subId) return `${source}:${externalId}:${subId}`
  return `${source}:${externalId}`
}

/**
 * Parse idempotency key back to components.
 */
export function parseIdempotencyKey(
  key: string
): { source: EventSource; externalId: string; subId?: string } {
  const parts = key.split(':')
  const source = parts[0] as EventSource
  const externalId = parts[1] ?? ''
  const subId = parts[2]
  return { source, externalId, subId }
}
