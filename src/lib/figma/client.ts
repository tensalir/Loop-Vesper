/**
 * Figma REST API client.
 * Supports comments (for sync feedback) and LayoutSpec export (stub).
 */

import type { LayoutSpec } from '@/lib/sigil/schema/layoutSpec'

const FIGMA_API_BASE = 'https://api.figma.com/v1'

function getFigmaToken(): string | null {
  return process.env.FIGMA_ACCESS_TOKEN ?? null
}

export interface FigmaComment {
  id: string
  message: string
  created_at: string
  resolved_at?: string | null
  parent_id?: string | null
  user: { id: string; handle?: string; img_url?: string }
  client_meta?: { node_id?: string[] }
  order_id?: string
}

export interface FigmaCommentsResponse {
  comments: FigmaComment[]
}

/**
 * Get all comments for a file. Requires FIGMA_ACCESS_TOKEN and file_comments:read scope.
 */
export async function getFileComments(fileKey: string): Promise<FigmaComment[]> {
  const token = getFigmaToken()
  if (!token) {
    console.warn('[Figma] FIGMA_ACCESS_TOKEN not set')
    return []
  }
  const res = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/comments`, {
    headers: { 'X-Figma-Token': token },
  })
  if (!res.ok) {
    if (res.status === 403 || res.status === 404) return []
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as FigmaCommentsResponse
  return data.comments ?? []
}

/**
 * Post a comment on a Figma file. Used to mirror Monday status into Figma.
 */
export async function postComment(
  fileKey: string,
  message: string,
  options?: { nodeId?: string }
): Promise<FigmaComment | null> {
  const token = getFigmaToken()
  if (!token) return null
  const body: { message: string; client_meta?: { node_id?: string } } = { message }
  if (options?.nodeId) body.client_meta = { node_id: options.nodeId }
  const res = await fetch(`${FIGMA_API_BASE}/files/${fileKey}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Figma-Token': token,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const data = (await res.json()) as FigmaComment
  return data
}

/**
 * Get file document (nodes). Requires file key; optional depth.
 * Used to resolve node names for frame feedback (e.g. FBK: or language tags).
 */
export async function getFile(
  fileKey: string,
  options?: { depth?: number }
): Promise<{ name: string; document?: Record<string, unknown> }> {
  const token = getFigmaToken()
  if (!token) {
    console.warn('[Figma] FIGMA_ACCESS_TOKEN not set')
    return { name: '' }
  }
  const url = new URL(`${FIGMA_API_BASE}/files/${fileKey}`)
  if (options?.depth != null) url.searchParams.set('depth', String(options.depth))
  const res = await fetch(url.toString(), { headers: { 'X-Figma-Token': token } })
  if (!res.ok) {
    if (res.status === 403 || res.status === 404)
      return { name: '' }
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as { name?: string; document?: Record<string, unknown> }
  return { name: data.name ?? '', document: data.document }
}

export interface FigmaExportResult {
  ok: boolean
  fileKey?: string
  nodeId?: string
  message?: string
}

/**
 * Export a LayoutSpec to Figma as editable frames with text layers.
 * Stub: returns success and message; real implementation will use Figma REST API.
 */
export async function exportLayoutSpecToFigma(
  _spec: LayoutSpec,
  _options?: { fileKey?: string; parentNodeId?: string }
): Promise<FigmaExportResult> {
  return {
    ok: true,
    message: 'Figma export deferred. LayoutSpec is ready for manual export or future API integration.',
  }
}
