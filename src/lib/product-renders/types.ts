/**
 * What the product render library holds, shared by the web browser, the admin
 * settings, the API's validation and the MCP tool, so that a new kind of picture
 * is added in one place.
 *
 * `single`, `pair` and `case` are the studio's renders. `packaging` (the retail
 * box) and `in-ear` (a photograph of the product worn) arrived with the Live Pro
 * photographs on 2026-10-02.
 */

export const RENDER_TYPES = ['single', 'pair', 'case', 'packaging', 'in-ear'] as const

export type RenderType = (typeof RENDER_TYPES)[number]

export const RENDER_TYPE_LABELS: Record<RenderType, string> = {
  single: 'Single',
  pair: 'Pair',
  case: 'Case',
  packaging: 'Packaging',
  'in-ear': 'In ear',
}

/**
 * Names colleagues use for a product, mapped to the name its rows are filed
 * under. Live Pro was codenamed Aphrodite, and its first render was filed under
 * that name.
 */
export const PRODUCT_NAME_ALIASES: Record<string, string> = {
  aphrodite: 'Live Pro',
}

/**
 * The name to search the library for: the brand dropped ("Loop Live Pro" is
 * filed as "Live Pro", "Loop Dream" as "Dream") and a codename resolved to the
 * product's name. Anything else comes back trimmed and otherwise unchanged.
 */
export function canonicalProductName(query: string): string {
  const trimmed = query.trim().replace(/\s+/g, ' ')
  const withoutBrand = trimmed.replace(/^loop\s+/i, '')
  const name = withoutBrand || trimmed
  return PRODUCT_NAME_ALIASES[name.toLowerCase()] ?? name
}
