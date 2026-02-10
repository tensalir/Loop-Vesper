/**
 * Parse Figma comments and on-canvas structured nodes into unified FeedbackEvent payloads.
 * Conventions: frame names prefixed with FBK: for feedback; language tags e.g. [de] or :de for localization.
 */

import type { FigmaComment } from '@/lib/figma/client'
import { getFileComments, getFile } from '@/lib/figma/client'
import type { FeedbackEvent } from './contracts'
import type { CreativeWorkItem } from './contracts'
import { toFeedbackEvent } from './normalize'

const FBK_PREFIX = 'FBK:'
const LANG_TAG_REGEX = /\[([a-z]{2})\]$|:([a-z]{2})$/

export interface ParsedFigmaFeedback {
  events: FeedbackEvent[]
  link: CreativeWorkItem
}

/**
 * Extract language tag from frame name (e.g. "Caption [de]" or "Note:de").
 */
export function parseLanguageTag(name: string): string | undefined {
  const m = name.match(LANG_TAG_REGEX)
  return m ? (m[1] ?? m[2]) : undefined
}

/**
 * Check if node name indicates feedback frame (FBK: prefix).
 */
export function isFeedbackFrameName(name: string): boolean {
  return name.trim().toUpperCase().startsWith(FBK_PREFIX.toUpperCase())
}

/**
 * Recursively collect text from Figma document nodes. Node shape from GET file: { id, name, type, characters?, children? }.
 */
function collectTextNodes(
  node: Record<string, unknown>,
  out: Array<{ nodeId: string; name: string; characters: string; languageTag?: string }>
): void {
  const id = node.id as string
  const name = (node.name as string) ?? ''
  const type = node.type as string

  if (type === 'TEXT' && typeof node.characters === 'string') {
    const languageTag = parseLanguageTag(name)
    out.push({ nodeId: id, name, characters: node.characters as string, languageTag })
  }

  const children = node.children as Record<string, unknown>[] | undefined
  if (Array.isArray(children))
    children.forEach((child) => collectTextNodes(child as Record<string, unknown>, out))
}

/**
 * Parse document for feedback frames (name starts with FBK:) and collect their text as frame_text or frame_note.
 */
export function parseDocumentForFeedbackFrames(
  document: Record<string, unknown> | undefined,
  fileKey: string
): Array<{ nodeId: string; name: string; text: string; languageTag?: string; kind: 'frame_text' | 'frame_note' }> {
  const out: Array<{ nodeId: string; name: string; text: string; languageTag?: string; kind: 'frame_text' | 'frame_note' }> = []
  if (!document) return out
  const id = document.id as string
  const name = (document.name as string) ?? ''
  const children = document.children as Record<string, unknown>[] | undefined

  if (Array.isArray(children)) {
    for (const child of children) {
      const c = child as Record<string, unknown>
      const childName = (c.name as string) ?? ''
      if (!isFeedbackFrameName(childName)) continue
      const textNodes: Array<{ nodeId: string; name: string; characters: string; languageTag?: string }> = []
      collectTextNodes(c, textNodes)
      const languageTag = parseLanguageTag(childName)
      for (const t of textNodes) {
        out.push({
          nodeId: t.nodeId,
          name: t.name,
          text: t.characters,
          languageTag: t.languageTag ?? languageTag,
          kind: childName.toUpperCase().includes('NOTE') ? 'frame_note' : 'frame_text',
        })
      }
    }
  }
  return out
}

/**
 * Parse all feedback from a Figma file: comments (and replies/resolves) + structured FBK: frame text.
 */
export async function parseFigmaFileFeedback(fileKey: string): Promise<ParsedFigmaFeedback[]> {
  const link: CreativeWorkItem = { figmaFileKey: fileKey }
  const results: ParsedFigmaFeedback[] = []

  const comments = await getFileComments(fileKey)
  const events: FeedbackEvent[] = []
  for (const c of comments) {
    const baseLink: CreativeWorkItem = {
      figmaFileKey: fileKey,
      figmaNodeId: c.client_meta?.node_id?.[0],
    }
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
          figmaNodeId: baseLink.figmaNodeId,
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
  }
  if (events.length) results.push({ events, link: { figmaFileKey: fileKey } })

  const { document } = await getFile(fileKey, { depth: 2 })
  const frameFeedbacks = parseDocumentForFeedbackFrames(document, fileKey)
  const now = new Date().toISOString()
  for (const f of frameFeedbacks) {
    const nodeLink: CreativeWorkItem = { figmaFileKey: fileKey, figmaNodeId: f.nodeId }
    const ev = toFeedbackEvent(
      'figma',
      f.nodeId,
      now,
      f.kind,
      {
        content: f.text,
        languageTag: f.languageTag,
        figmaNodeId: f.nodeId,
        idempotencySubId: f.kind,
        link: nodeLink,
        payload: { frameName: f.name },
      }
    )
    results.push({ events: [ev], link: nodeLink })
  }

  return results
}
