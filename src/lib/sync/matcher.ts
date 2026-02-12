/**
 * Deterministic matching: Monday ↔ Figma ↔ Frontify.
 * Priority: 1. Explicit final link columns 2. Figma file key 3. Naming normalization.
 * Persists match events with confidence and rationale for auditing.
 */

import { prisma } from '@/lib/prisma'
import { persistEvent, toMatchEvent } from './normalize'
import type { CreativeWorkItem } from './contracts'

const MATCH_FINAL_LINK = 'final_link'
const MATCH_FIGMA_KEY = 'figma_file_key'
const MATCH_NAMING = 'naming'

/** Normalize string for fuzzy match: lowercase, collapse spaces, remove non-alphanumeric. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

/** Simple similarity: share of words in common (word set overlap). */
function nameSimilarity(a: string, b: string): number {
  const wordsA = normalizeName(a).split(/\s+/).filter(Boolean)
  const wordsB = normalizeName(b).split(/\s+/).filter(Boolean)
  const wb = new Set(wordsB)
  if (wordsA.length === 0 || wb.size === 0) return 0
  let hit = 0
  wordsA.forEach((w) => {
    if (wb.has(w)) hit++
  })
  return hit / Math.max(wordsA.length, wb.size)
}

export interface MatcherResult {
  linksProcessed: number
  matchesInserted: number
  matchesSkipped: number
}

/**
 * Run matching: for each Monday link (with latest revision payload), try to find a Frontify link
 * by final_link, figma_file_key, or naming; persist match event with confidence and rationale.
 */
export async function runMatcher(): Promise<MatcherResult> {
  const mondayLinks = await prisma.syncLink.findMany({
    where: { mondayItemId: { not: null }, mondayBoardId: { not: null } },
    select: { id: true, mondayItemId: true, mondayBoardId: true },
  })

  const frontifyByAssetId = new Map<string, { linkId: string; title?: string; downloadUrl?: string }>()
  const approvalEvents = await prisma.syncEvent.findMany({
    where: { kind: 'approval', source: 'frontify' },
    select: { linkId: true, payload: true },
  })
  for (const ev of approvalEvents) {
    const p = ev.payload as { frontifyAssetId?: string; externalId?: string; payload?: { title?: string; downloadUrl?: string } }
    const assetId = p?.frontifyAssetId ?? p?.externalId
    const inner = p?.payload
    const title = typeof inner?.title === 'string' ? inner.title : undefined
    const downloadUrl = typeof inner?.downloadUrl === 'string' ? inner.downloadUrl : undefined
    if (assetId && ev.linkId) {
      frontifyByAssetId.set(assetId, { linkId: ev.linkId, title, downloadUrl })
    }
  }
  const frontifyLinks = await prisma.syncLink.findMany({
    where: { frontifyAssetId: { not: null } },
    select: { id: true, frontifyAssetId: true },
  })
  for (const link of frontifyLinks) {
    if (link.frontifyAssetId && !frontifyByAssetId.has(link.frontifyAssetId)) {
      frontifyByAssetId.set(link.frontifyAssetId, { linkId: link.id })
    }
  }

  const frontifyTitles = Array.from(frontifyByAssetId.entries()).map(([assetId, v]) => ({
    assetId,
    linkId: v.linkId,
    title: (v.title ?? '').toLowerCase(),
  }))

  let matchesInserted = 0
  let matchesSkipped = 0
  const now = new Date().toISOString()

  for (const link of mondayLinks) {
    const mondayItemId = link.mondayItemId!
    const mondayBoardId = link.mondayBoardId!

    const revEvent = await prisma.syncEvent.findFirst({
      where: { linkId: link.id, kind: 'revision', source: 'monday' },
      orderBy: { occurredAt: 'desc' },
      select: { payload: true },
    })
    const payload = (revEvent?.payload ?? {}) as Record<string, unknown>
    const finalLink = typeof payload.final_link === 'string' ? payload.final_link.trim() : ''
    const name = typeof payload.name === 'string' ? payload.name : ''
    const figmaFileKey = typeof payload.figma_file_key === 'string' ? payload.figma_file_key : ''

    let matchedAssetId: string | undefined
    let confidence = 0
    let rationale = ''

    if (finalLink) {
      for (const [assetId, v] of frontifyByAssetId) {
        if (v.downloadUrl && v.downloadUrl.trim() === finalLink) {
          matchedAssetId = assetId
          confidence = 1
          rationale = MATCH_FINAL_LINK
          break
        }
      }
      if (!matchedAssetId && finalLink) {
        const normalizedFinal = finalLink.toLowerCase()
        for (const [assetId, v] of frontifyByAssetId) {
          if (v.downloadUrl && v.downloadUrl.toLowerCase() === normalizedFinal) {
            matchedAssetId = assetId
            confidence = 0.98
            rationale = MATCH_FINAL_LINK
            break
          }
        }
      }
    }

    if (!matchedAssetId && figmaFileKey) {
      for (const { assetId } of frontifyTitles) {
        const approvalPayload = await prisma.syncEvent
          .findFirst({
            where: { kind: 'approval', source: 'frontify', linkId: frontifyByAssetId.get(assetId)?.linkId },
            select: { payload: true },
          })
          .then((e) => (e?.payload as Record<string, unknown>)?.payload as Record<string, unknown> | undefined)
        const assetFigmaKey = approvalPayload?.figma_file_key ?? approvalPayload?.figmaFileKey
        if (typeof assetFigmaKey === 'string' && assetFigmaKey === figmaFileKey) {
          matchedAssetId = assetId
          confidence = 0.9
          rationale = MATCH_FIGMA_KEY
          break
        }
      }
    }

    if (!matchedAssetId && name) {
      let best = 0
      for (const { assetId, title } of frontifyTitles) {
        const sim = nameSimilarity(name, title)
        if (sim > best && sim >= 0.5) {
          best = sim
          matchedAssetId = assetId
          confidence = Math.min(0.5 + sim * 0.4, 0.85)
          rationale = MATCH_NAMING
        }
      }
    }

    const matchPayload = toMatchEvent(link.id, mondayItemId, now, {
      matchedFrontifyAssetId: matchedAssetId,
      matchConfidence: confidence,
      matchRationale: rationale || 'none',
      payload: { final_link: finalLink || undefined, name: name || undefined, figma_file_key: figmaFileKey || undefined },
    })
    const creativeLink: CreativeWorkItem = { mondayItemId, mondayBoardId }
    const result = await persistEvent({ payload: matchPayload, link: creativeLink })
    if (result.inserted) matchesInserted++
    else matchesSkipped++
  }

  return {
    linksProcessed: mondayLinks.length,
    matchesInserted,
    matchesSkipped,
  }
}
