/**
 * Product Update domain types.
 *
 * `ProductUpdate.snippets` is stored as JSON in Postgres so the auto-pipeline
 * can ship richer payloads later without a migration; the runtime shape is
 * enforced here and at the API boundary.
 *
 * Snippets are the non-technical bullets users actually read in both the
 * "What's New" popup and the Updates page. They intentionally stay shallow:
 *   - `label` is the bolded headline ("Quick edit", "Reuse parameters")
 *   - `body`  is one short sentence explaining what changed for the user
 *   - `tag`   is an optional category badge ("new", "fix", "improved")
 */

export type UpdateSnippetTag = 'new' | 'improved' | 'fix' | 'note'

export interface UpdateSnippet {
  label: string
  body: string
  tag?: UpdateSnippetTag
}

export interface ProductUpdate {
  id: string
  slug: string
  title: string
  summary: string
  snippets: UpdateSnippet[]
  publishedAt: string
  /** Whether the current user has dismissed this update. Only present on
   *  authenticated reads where the API has joined the views table. */
  seen?: boolean
  significanceScore?: number | null
  source?: 'auto' | 'backfill' | 'manual'
  backfilled?: boolean
}

/** Parse the raw JSON value off `product_updates.snippets` into a strongly
 *  typed array. Tolerates bad rows by skipping malformed entries so a
 *  single broken bullet can't break the whole popup. */
export function parseSnippets(value: unknown): UpdateSnippet[] {
  if (!Array.isArray(value)) return []
  const out: UpdateSnippet[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const label = typeof e.label === 'string' ? e.label.trim() : ''
    const body = typeof e.body === 'string' ? e.body.trim() : ''
    if (!label || !body) continue
    const tag =
      e.tag === 'new' || e.tag === 'improved' || e.tag === 'fix' || e.tag === 'note'
        ? (e.tag as UpdateSnippetTag)
        : undefined
    out.push(tag ? { label, body, tag } : { label, body })
  }
  return out
}
