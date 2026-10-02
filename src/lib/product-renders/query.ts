/**
 * Reads a request for product pictures the way a colleague says it: "Aphrodite in the ear", "the
 * Loop Live Pro box in black", "Live Pro case". The product is found inside the phrase (its name,
 * its codename, with or without the brand), and a colourway or a kind of picture named beside it is
 * read too. Added 2026-10-02: a natural request for Live Pro found nothing, because the whole phrase
 * was searched as a product name.
 */

import { PRODUCT_NAME_ALIASES, canonicalProductName, type RenderType } from './types'

export interface CatalogEntry {
  name: string
  colorway: string | null
}

export interface RenderQuery {
  /** A product name from the library, or the phrase itself when no product was recognised. */
  name?: string
  colorway?: string
  renderType?: RenderType
  /** True when the product was recognised inside the phrase rather than taken as it came. */
  recognised: boolean
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** The words a colleague uses for each kind of picture, most specific first. */
const TYPE_WORDS: Array<[RenderType, string[]]> = [
  ['in-ear', ['in ear', 'in the ear', 'in her ear', 'in his ear', 'in their ear', 'in an ear', 'worn', 'wearing', 'on a person', 'on someone']],
  ['packaging', ['packaging', 'package', 'retail box', 'box', 'boxes', 'pack shot of the box']],
  ['case', ['charging case', 'case']],
  ['pair', ['pair', 'both earplugs', 'both earbuds', 'both buds']],
  ['single', ['single earplug', 'single earbud', 'one earplug', 'one earbud', 'single']],
]

function contains(haystack: string, needle: string): boolean {
  return needle.length > 0 && ` ${haystack} `.includes(` ${needle} `)
}

/**
 * The product, colourway and kind of picture a phrase asks for, against the names and colourways
 * the library holds. When no product is recognised the phrase comes back as the name to search,
 * the brand dropped and a codename resolved, as before.
 */
export function interpretRenderQuery(query: string, catalog: CatalogEntry[]): RenderQuery {
  const q = norm(query)
  const compact = q.replace(/ /g, '')

  let name: string | undefined
  for (const [alias, target] of Object.entries(PRODUCT_NAME_ALIASES)) {
    if (contains(q, norm(alias))) {
      name = target
      break
    }
  }
  if (!name) {
    const names = Array.from(new Set(catalog.map((c) => c.name))).sort((a, b) => norm(b).length - norm(a).length)
    name = names.find((n) => {
      const nn = norm(n)
      // A name of more than one word also matches written as one ("LivePro", "live-pro").
      return contains(q, nn) || (nn.includes(' ') && compact.includes(nn.replace(/ /g, '')))
    })
  }

  const colourways = Array.from(
    new Set(catalog.filter((c) => !name || c.name === name).map((c) => c.colorway).filter((c): c is string => !!c))
  ).sort((a, b) => norm(b).length - norm(a).length)
  const colorway = colourways.find((c) => contains(q, norm(c)))

  let renderType: RenderType | undefined
  for (const [type, words] of TYPE_WORDS) {
    if (words.some((w) => contains(q, w))) {
      renderType = type
      break
    }
  }

  if (!name) return { name: canonicalProductName(query), recognised: false }
  return { name, ...(colorway ? { colorway } : {}), ...(renderType ? { renderType } : {}), recognised: true }
}

/** One line saying how a phrase was read, for the agent to repeat or correct. */
export function describeQuery(phrase: string, read: RenderQuery): string | null {
  if (!read.recognised) return null
  const parts = [read.name, read.colorway, read.renderType].filter(Boolean)
  return `Read "${phrase}" as ${parts.join(', ')}.`
}
