/**
 * Two kits, one list of Loop products.
 *
 * Since 2026-09-29 CMF is Loop Product Design's (`tensalir/loop-product-plugins`, the product kit)
 * and everything else is Loop Studio Design's (`tensalir/loop-ai-studio`, the creative kit). A tool
 * that takes a product by name finds it here, in the kit that serves it:
 *
 *   the creative kit   every product but CMF; a CMF entry it still carries (studio-design 0.3.x)
 *                      is never served
 *   the product kit    CMF only
 *
 * The creative kit is asked first and the product kit only when the creative kit does not serve
 * the name, so an Eclipse or packaging call never waits on the product kit. When the product kit
 * cannot be read, a CMF name gets that reason (where CMF is read from), never the creative kit's
 * old CMF.
 *
 * Pure but for the two loaders, which are injected.
 */

import type { LoadedKit } from './kit'
import type { AnyKit, Kit, KitProduct, ProductKit } from './kit-schema'
import { findProduct, namesProduct, resolveProduct, servedProducts } from './products'
import { kitPins, type PinSpec } from './pins'

export interface KitSetLoaders {
  studio(): Promise<LoadedKit<Kit>>
  product(): Promise<LoadedKit<ProductKit>>
}

export type KitHit =
  | { source: 'studio'; loaded: LoadedKit<Kit>; slug: string; product: KitProduct }
  | { source: 'product'; loaded: LoadedKit<ProductKit>; slug: string; product: KitProduct }

/** Whether Vesper serves this product from this kit: CMF from the product kit, the rest from the creative kit. */
export function servesFrom(kit: Pick<AnyKit, 'plugin'>, product: Pick<KitProduct, 'kind'>): boolean {
  return kit.plugin === 'product-design' ? product.kind === 'cmf' : product.kind !== 'cmf'
}

/** The kit as Vesper serves it: only the products it serves from that kit. */
export function servedView<K extends AnyKit>(loaded: LoadedKit<K>): LoadedKit<K> {
  const products = Object.fromEntries(Object.entries(loaded.kit.products).filter(([, p]) => servesFrom(loaded.kit, p)))
  if (Object.keys(products).length === Object.keys(loaded.kit.products).length) return loaded
  return { ...loaded, kit: { ...loaded.kit, products } }
}

const CMF_WORDS = /\bcmf\b|\bclown\b/i

async function settle<T>(p: () => Promise<T>): Promise<{ value: T | null; error: Error | null }> {
  try {
    return { value: await p(), error: null }
  } catch (err) {
    return { value: null, error: err instanceof Error ? err : new Error(String(err)) }
  }
}

/** A product by slug, skill name, name or alias, in the kit that serves it; a readable error when none does. */
export async function resolveInKits(loaders: KitSetLoaders, query: string, opts: { isAdmin?: boolean } = {}): Promise<KitHit> {
  const studioRaw = await settle(loaders.studio)
  const studio = studioRaw.value ? servedView(studioRaw.value) : null
  if (studio) {
    const hit = findProduct(studio.kit, query, opts)
    if (hit) return { source: 'studio', loaded: studio, ...hit }
    if (namesProduct(studio.kit, query)) resolveProduct(studio.kit, query, opts) // throws why it is not served
  }
  const productRaw = await settle(loaders.product)
  const product = productRaw.value ? servedView(productRaw.value) : null
  if (product) {
    const hit = findProduct(product.kit, query, opts)
    if (hit) return { source: 'product', loaded: product, ...hit }
    if (namesProduct(product.kit, query)) resolveProduct(product.kit, query, opts)
  }
  const namesCmf = CMF_WORDS.test(query) || (!!studioRaw.value && namesProduct(studioRaw.value.kit, query, 'cmf'))
  if (productRaw.error && namesCmf) throw productRaw.error
  if (studioRaw.error && !product) throw studioRaw.error
  if (studioRaw.error && !namesCmf) throw studioRaw.error
  const names = [...(studio ? servedProducts(studio.kit, opts) : []), ...(product ? servedProducts(product.kit, opts) : [])]
    .map(({ slug, product: p }) => `${p.name} (${slug})`)
    .join(', ')
  throw new Error(
    `No Loop product called '${query}' in Vesper's kits. They carry: ${names || 'nothing yet'}.` +
      (productRaw.error ? ` (Loop Product Design's kit, which holds CMF, could not be read: ${productRaw.error.message})` : '')
  )
}

export interface KitSetState {
  studio: LoadedKit<Kit> | null
  studioError: Error | null
  product: LoadedKit<ProductKit> | null
  productError: Error | null
}

/** Both kits as served, each with the error that kept it away; throws only when neither can be read. */
export async function loadKitSet(loaders: KitSetLoaders): Promise<KitSetState> {
  const [s, p] = await Promise.all([settle(loaders.studio), settle(loaders.product)])
  if (!s.value && !p.value) throw s.error ?? p.error ?? new Error('No kit is available')
  return {
    studio: s.value ? servedView(s.value) : null,
    studioError: s.error,
    product: p.value ? servedView(p.value) : null,
    productError: p.error,
  }
}

/** Every pin the served kits name, once per product, id and sha256: the creative kit's, then CMF's clowns. */
export function kitSetPins(state: { studio?: LoadedKit<AnyKit> | null; product?: LoadedKit<AnyKit> | null }): PinSpec[] {
  const out: PinSpec[] = []
  const seen = new Set<string>()
  for (const loaded of [state.studio, state.product]) {
    if (!loaded) continue
    for (const p of kitPins(loaded.kit)) {
      const key = `${p.product}:${p.pinId}@${p.sha256}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out
}
