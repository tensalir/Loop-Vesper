/**
 * The CMF part of the creative kit, read as the CMF tools need it. Pure: the kit and the files it
 * names come in; nothing here reaches the network.
 *
 * What the kit carries for CMF (the plugin repository's `tools/kit.py`, `cmf_entry`):
 *   keys      every clown key: its clown (id, sha256, size), whether it is a draft (a zone names no
 *             component) and whether Damien confirmed it
 *   specs     every tab's parsed spec, by path and sha256
 *   payloads  every tab × column × key the committed files can build a prompt for, written by
 *             `scripts/prompt_build.py --all`: ready (the payload file by path and sha256, its
 *             prompt's sha256) or refused (the reasons, word for word)
 *   template  Damien's template block and its sha256
 *   grading_prompt.parts_file   `kit/cmf-grading.json`: THE ROW for every in-scope tab and column,
 *             THE KEY for every tab × column × key of that tab's product
 */

import type { Kit, KitProduct } from '../kit-schema'

export class CmfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CmfError'
  }
}

export interface CmfKey {
  path: string
  sha256: string
  product: string | null
  variant: string | null
  clown: { id: string; sha256: string; width?: number; height?: number } | null
  draft: boolean
  confirmed: boolean
}

export interface CmfSpec {
  path: string
  sha256: string
  tab: string | null
  vesper_product: string | null
}

export interface CmfPayloadEntry {
  tab: string
  spec: string
  column: string
  sku_name: string | null
  key: string
  status: 'ready' | 'refused' | string
  path?: string
  sha256?: string
  prompt_sha256?: string
  key_confirmed?: boolean
  reasons?: string[]
}

export interface CmfKit {
  slug: string
  product: KitProduct
  keys: Record<string, CmfKey>
  specs: Record<string, CmfSpec>
  payloads: Record<string, CmfPayloadEntry>
  template: { path: string; sha256: string; block: string; block_sha256: string } | null
}

export interface CmfGradingParts {
  rows: Record<string, { spec: string; tab: string; column: string; sku_name: string | null; row_lines: string[] }>
  keys: Record<string, { key: string; draft: boolean; key_lines: string[] }>
  no_key_lines: string[]
}

/** The kit's CMF product, or a refusal when the kit carries none. */
export function cmfKit(kit: Kit): CmfKit {
  const found = Object.entries(kit.products).find(([, p]) => p.kind === 'cmf')
  if (!found) throw new CmfError(`the creative kit ${kit.version} carries no CMF product`)
  const [slug, product] = found
  const raw = product as Record<string, unknown>
  return {
    slug,
    product,
    keys: (raw.keys ?? {}) as Record<string, CmfKey>,
    specs: (raw.specs ?? {}) as Record<string, CmfSpec>,
    payloads: (raw.payloads ?? {}) as Record<string, CmfPayloadEntry>,
    template: (raw.template ?? null) as CmfKit['template'],
  }
}

const fold = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** A tab by its spec slug (`experience-2-cc`) or its sheet name (`Experience 2 CC`). */
export function resolveTab(cmf: CmfKit, query: string): { slug: string; spec: CmfSpec } {
  const q = fold(query)
  for (const [slug, spec] of Object.entries(cmf.specs)) {
    if (fold(slug) === q || (spec.tab && fold(spec.tab) === q)) return { slug, spec }
  }
  const names = Object.entries(cmf.specs).map(([slug, s]) => `${s.tab ?? slug} (${slug})`)
  throw new CmfError(`no CMF tab '${query}'; the kit has ${names.join(', ')}`)
}

/** The keys of a tab's product (the clown table's product slug the tab maps to). */
export function keysForTab(cmf: CmfKit, spec: CmfSpec): Array<[string, CmfKey]> {
  return Object.entries(cmf.keys).filter(([, k]) => !!spec.vesper_product && k.product === spec.vesper_product)
}

export function payloadId(specSlug: string, column: string, key: string): string {
  return `${specSlug}--${column.toUpperCase()}--${key}`
}

/** A key by its id, or a refusal naming the tab's keys. */
export function resolveKey(cmf: CmfKit, spec: CmfSpec, keyId: string): CmfKey {
  const key = cmf.keys[keyId]
  if (!key) {
    const theirs = keysForTab(cmf, spec).map(([id]) => id)
    throw new CmfError(`no clown key '${keyId}' in the kit${theirs.length ? `; ${spec.tab}'s keys: ${theirs.join(', ')}` : ''}`)
  }
  if (spec.vesper_product && key.product && key.product !== spec.vesper_product) {
    throw new CmfError(`the clown key '${keyId}' is for ${key.product}; ${spec.tab} is ${spec.vesper_product}`)
  }
  return key
}

/**
 * The payload of a tab, column and key, or a refusal: word for word what `prompt_build.py`
 * refused, or why there is none (a draft key, a column out of scope).
 */
export function payloadFor(cmf: CmfKit, specSlug: string, column: string, keyId: string): CmfPayloadEntry {
  const spec = cmf.specs[specSlug]
  const key = resolveKey(cmf, spec, keyId)
  const id = payloadId(specSlug, column, keyId)
  const entry = cmf.payloads[id]
  if (entry) return entry
  if (key.draft) {
    throw new CmfError(
      `the clown key '${keyId}' is a draft: a zone names no component yet. Damien names the zones (the chips page), then the payload is built. No prompt is sent from a draft key.`
    )
  }
  throw new CmfError(
    `no payload for ${spec.tab} column ${column.toUpperCase()} through '${keyId}': the column is not in scope, or the kit was built before it was; cmf_list names what is ready`
  )
}

/** Every in-scope column of a tab, from the grading parts (the SKUs whose Product Name is filled). */
export function inScopeColumns(parts: CmfGradingParts, specSlug: string): Array<{ column: string; sku_name: string | null }> {
  return Object.values(parts.rows)
    .filter((r) => r.spec === specSlug)
    .map((r) => ({ column: r.column, sku_name: r.sku_name }))
    .sort((a, b) => a.column.localeCompare(b.column))
}
