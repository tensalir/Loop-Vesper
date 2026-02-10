/**
 * Normalize incoming webhook/poll payloads into SyncEvent records with dedupe.
 * Resolves or creates SyncLink; persists immutable SyncEvent by idempotency key.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type {
  SyncEventPayload,
  RevisionEvent,
  FeedbackEvent,
  ApprovalEvent,
  CreativeWorkItem,
  EventSource,
} from './contracts'
import { buildIdempotencyKey } from './contracts'
import { normalizeOccurredAt } from './versioning'

export interface PersistEventInput {
  payload: SyncEventPayload
  /** Optional link identifiers to resolve or create SyncLink. */
  link?: CreativeWorkItem
}

export interface ResolveOrCreateLinkResult {
  linkId: string | null
  created: boolean
}

/**
 * Resolve or create a SyncLink from partial identifiers.
 * Returns linkId and whether the link was just created.
 */
export async function resolveOrCreateLink(link: CreativeWorkItem | undefined): Promise<ResolveOrCreateLinkResult> {
  if (!link) return { linkId: null, created: false }

  const existing = await prisma.syncLink.findFirst({
    where: {
      OR: [
        ...(link.mondayItemId && link.mondayBoardId
          ? [{ mondayItemId: link.mondayItemId, mondayBoardId: link.mondayBoardId }]
          : []),
        ...(link.figmaFileKey && link.figmaNodeId
          ? [{ figmaFileKey: link.figmaFileKey, figmaNodeId: link.figmaNodeId }]
          : []),
        ...(link.frontifyAssetId ? [{ frontifyAssetId: link.frontifyAssetId }] : []),
      ].filter(Boolean),
    },
    select: { id: true },
  })

  if (existing) return { linkId: existing.id, created: false }

  const hasKey =
    (link.mondayItemId && link.mondayBoardId) ||
    (link.figmaFileKey && link.figmaNodeId) ||
    link.frontifyAssetId
  if (!hasKey) return { linkId: null, created: false }

  const created = await prisma.syncLink.create({
    data: {
      mondayItemId: link.mondayItemId ?? undefined,
      mondayBoardId: link.mondayBoardId ?? undefined,
      figmaFileKey: link.figmaFileKey ?? undefined,
      figmaNodeId: link.figmaNodeId ?? undefined,
      frontifyAssetId: link.frontifyAssetId ?? undefined,
    },
    select: { id: true },
  })
  return { linkId: created.id, created: true }
}

/**
 * Persist a single normalized event. Dedupe by idempotencyKey (ignore if already exists).
 */
export async function persistEvent(input: PersistEventInput): Promise<{ id: string; inserted: boolean }> {
  const { payload, link } = input
  const { linkId } = await resolveOrCreateLink(link)

  const existing = await prisma.syncEvent.findUnique({
    where: { idempotencyKey: payload.idempotencyKey },
    select: { id: true },
  })
  if (existing) return { id: existing.id, inserted: false }

  const occurredAt = new Date(normalizeOccurredAt(payload.occurredAt))
  const created = await prisma.syncEvent.create({
    data: {
      idempotencyKey: payload.idempotencyKey,
      linkId: linkId ?? undefined,
      source: payload.source,
      externalId: payload.externalId,
      version: payload.version,
      occurredAt,
      kind: payload.kind,
      payload: payload as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  return { id: created.id, inserted: true }
}

/**
 * Persist multiple events; skips duplicates. Returns count inserted.
 */
export async function persistEvents(
  inputs: PersistEventInput[]
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0
  let skipped = 0
  for (const input of inputs) {
    const result = await persistEvent(input)
    if (result.inserted) inserted++
    else skipped++
  }
  return { inserted, skipped }
}

/** Build a RevisionEvent from Monday/Figma/Frontify raw data. */
export function toRevisionEvent(
  source: EventSource,
  externalId: string,
  occurredAt: string,
  payload: Record<string, unknown>,
  options?: { actorId?: string; actorName?: string; link?: CreativeWorkItem }
): RevisionEvent {
  return {
    idempotencyKey: buildIdempotencyKey(source, externalId),
    source,
    externalId,
    version: normalizeOccurredAt(occurredAt),
    actorId: options?.actorId,
    actorName: options?.actorName,
    occurredAt: normalizeOccurredAt(occurredAt),
    kind: 'revision',
    linkId: undefined,
    payload,
  }
}

/** Build a FeedbackEvent (comment/reply/resolve/frame_text/frame_note). */
export function toFeedbackEvent(
  source: EventSource,
  externalId: string,
  occurredAt: string,
  feedbackKind: FeedbackEvent['feedbackKind'],
  options: {
    parentId?: string
    resolved?: boolean
    content?: string
    languageTag?: string
    figmaNodeId?: string
    actorId?: string
    actorName?: string
    /** Optional subId for idempotency key (e.g. 'resolved' for resolve events). */
    idempotencySubId?: string
    link?: CreativeWorkItem
    payload?: Record<string, unknown>
  }
): FeedbackEvent {
  const subId = options.idempotencySubId ?? (options.parentId ? `${options.parentId}` : undefined)
  const idempotencyKey = subId != null
    ? buildIdempotencyKey(source, externalId, subId)
    : buildIdempotencyKey(source, externalId)
  return {
    idempotencyKey,
    source,
    externalId,
    version: normalizeOccurredAt(occurredAt),
    actorId: options.actorId,
    actorName: options.actorName,
    occurredAt: normalizeOccurredAt(occurredAt),
    kind: 'feedback',
    feedbackKind,
    parentId: options.parentId,
    resolved: options.resolved,
    content: options.content,
    languageTag: options.languageTag,
    figmaNodeId: options.figmaNodeId,
    payload: options.payload,
  }
}

/** Build an ApprovalEvent (Frontify approved/live). */
export function toApprovalEvent(
  frontifyAssetId: string,
  status: 'approved' | 'live',
  occurredAt: string,
  options?: { link?: CreativeWorkItem; payload?: Record<string, unknown> }
): ApprovalEvent {
  const externalId = frontifyAssetId
  return {
    idempotencyKey: buildIdempotencyKey('frontify', externalId),
    source: 'frontify',
    externalId,
    version: normalizeOccurredAt(occurredAt),
    occurredAt: normalizeOccurredAt(occurredAt),
    kind: 'approval',
    frontifyAssetId,
    status,
    payload: options?.payload,
  }
}
