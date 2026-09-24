/**
 * The products the kit carries, found by slug or by an alias a colleague uses.
 *
 * Only a product whose status is `pilot` or `live` is served; a `scaffold`
 * one is shown to admins, who are the ones building it. `retired` is never served.
 */

import type { Kit, KitProduct } from './kit-schema'

export const SERVED_STATUSES = ['pilot', 'live'] as const

export interface ResolvedProduct {
  slug: string
  product: KitProduct
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function isServed(product: KitProduct, opts: { isAdmin?: boolean } = {}): boolean {
  if ((SERVED_STATUSES as readonly string[]).includes(product.status)) return true
  return product.status === 'scaffold' && opts.isAdmin === true
}

/** Every product the caller may use, in the kit's order. */
export function servedProducts(kit: Kit, opts: { isAdmin?: boolean } = {}): ResolvedProduct[] {
  return Object.entries(kit.products)
    .filter(([, p]) => isServed(p, opts))
    .map(([slug, product]) => ({ slug, product }))
}

/**
 * A product by slug, skill name or alias, case and punctuation ignored.
 * Throws a message that names what the kit does carry.
 */
export function resolveProduct(kit: Kit, query: string, opts: { isAdmin?: boolean } = {}): ResolvedProduct {
  const q = norm(query)
  const served = servedProducts(kit, opts)
  const hit = served.find(
    ({ slug, product }) =>
      norm(slug) === q || norm(product.skill) === q || norm(product.name) === q || product.aliases.some((a) => norm(a) === q)
  )
  if (hit) return hit
  const unserved = Object.entries(kit.products).find(([slug]) => norm(slug) === q)
  if (unserved) {
    throw new Error(`${unserved[1].name} is ${unserved[1].status} in the kit, so Vesper does not serve it yet.`)
  }
  const names = served.map(({ slug, product }) => `${product.name} (${slug})`).join(', ')
  throw new Error(`No Loop product called '${query}' in the creative kit. It carries: ${names || 'nothing yet'}.`)
}
