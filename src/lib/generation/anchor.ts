/**
 * Iterating on a Loop product draw re-attaches the product, not the draw.
 *
 * The graded rounds showed that editing from the previous draw compounds its
 * errors: each generation copies the last one's mistakes about the product.
 * A draw made from a product render or a CMF clown carries
 * `parameters.anchor` (written by the MCP tools). When someone iterates on it
 * in the web app, the worker attaches the anchor as the only reference,
 * leaves the previous draw out, skips the model rewrite of the prompt, and
 * sends the anchored draw's own prompt followed by the requested change.
 *
 * Web generations without an anchor anywhere in their lineage are unchanged.
 */

export interface GenerationAnchor {
  kind: 'product-render' | 'clown'
  url: string
  id?: string | null
  sha256?: string | null
}

export function readAnchor(parameters: unknown): GenerationAnchor | null {
  if (!parameters || typeof parameters !== 'object') return null
  const raw = (parameters as Record<string, unknown>).anchor
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  if (a.kind !== 'product-render' && a.kind !== 'clown') return null
  if (typeof a.url !== 'string' || !/^https:\/\//i.test(a.url)) return null
  return {
    kind: a.kind,
    url: a.url,
    id: typeof a.id === 'string' ? a.id : null,
    sha256: typeof a.sha256 === 'string' ? a.sha256 : null,
  }
}

export interface LineageLookup {
  /** The generation that produced an output: its prompt and parameters. */
  generationForOutput(outputId: string): Promise<{ prompt: string; parameters: unknown } | null>
}

export interface ResolvedAnchor {
  anchor: GenerationAnchor
  /** The prompt of the anchored draw, carried forward so the scene survives. */
  anchorPrompt: string
}

/**
 * Walk the iteration lineage (`sourceRootOutputId`) up to `maxHops` draws
 * looking for an anchor. A hop that already carries `anchor` and
 * `anchorPrompt` (written on an earlier re-anchored iteration) ends the walk.
 */
export async function resolveLineageAnchor(
  parameters: unknown,
  lookup: LineageLookup,
  maxHops = 5
): Promise<ResolvedAnchor | null> {
  let outputId =
    parameters && typeof parameters === 'object'
      ? (parameters as Record<string, unknown>).sourceRootOutputId
      : undefined
  const seen = new Set<string>()
  for (let hop = 0; hop < maxHops && typeof outputId === 'string' && outputId && !seen.has(outputId); hop++) {
    seen.add(outputId)
    const gen = await lookup.generationForOutput(outputId)
    if (!gen) return null
    const anchor = readAnchor(gen.parameters)
    if (anchor) {
      const params = (gen.parameters ?? {}) as Record<string, unknown>
      const anchorPrompt = typeof params.anchorPrompt === 'string' ? params.anchorPrompt : gen.prompt
      return { anchor, anchorPrompt }
    }
    outputId =
      gen.parameters && typeof gen.parameters === 'object'
        ? (gen.parameters as Record<string, unknown>).sourceRootOutputId
        : undefined
  }
  return null
}

/** The anchored draw's prompt, then the one change asked for. */
export function composeAnchoredPrompt(anchorPrompt: string, editPrompt: string): string {
  const base = anchorPrompt.trim()
  const edit = editPrompt.trim()
  if (!base) return edit
  if (!edit || edit === base || edit.includes(base)) return edit || base
  return `${base}\n\nApply this one change: ${edit}`
}
