import { test, expect } from '@playwright/test'
import { summariseProductLibrary } from '../src/lib/cmf/product-summary'
import { CMF_PRODUCT_CATALOG } from '../src/lib/cmf/products'

/**
 * Pin the rollup contract used by the CMF library landing + product
 * strip. The components consume this output directly; if the shape or
 * grouping rules drift silently the workspace's "click product → land
 * on the right packet" UX will quietly break.
 */

function packet(args: {
  id: string
  slug: string
  cmfCode?: string | null
  updatedAt: string
  renderCount?: number
  variantSlug?: string
}) {
  const renders = Array.from({ length: args.renderCount ?? 1 }).map((_, i) => ({
    productSlug: args.slug,
    variantSlug: args.variantSlug ?? 'default',
    clownAssetId: null,
    label: `${args.slug} sku ${i + 1}`,
  }))
  return {
    id: args.id,
    name: `Packet ${args.id}`,
    cmfCode: args.cmfCode ?? null,
    status: 'draft',
    createdAt: args.updatedAt,
    updatedAt: args.updatedAt,
    renders,
  }
}

function clown(slug: string, variant = 'default'): {
  id: string
  productSlug: string
  variantSlug: string
  imageUrl: string
  label: string
} {
  return {
    id: `${slug}-${variant}`,
    productSlug: slug,
    variantSlug: variant,
    imageUrl: `https://cdn.example/${slug}-${variant}.png`,
    label: `${slug} ${variant}`,
  }
}

test('every catalog product gets a top-tier ProductSummary even with zero packets', () => {
  const rollup = summariseProductLibrary({ packets: [], clowns: [] })
  // Top-tier == catalog entries minus child cases (which are nested).
  const topTierCatalog = CMF_PRODUCT_CATALOG.filter((p) => !p.parentSlug)
  expect(rollup.products).toHaveLength(topTierCatalog.length)
  for (const product of topTierCatalog) {
    const summary = rollup.products.find((s) => s.productSlug === product.slug)
    expect(summary).toBeTruthy()
    expect(summary!.packets).toEqual([])
    expect(summary!.skuCount).toBe(0)
    expect(summary!.mostRecentPacketId).toBeNull()
  }
})

test('cases nest under their parent product and never appear top-level', () => {
  const rollup = summariseProductLibrary({
    packets: [
      packet({ id: 'p1', slug: 'aphrodite', updatedAt: '2026-05-12T10:00:00Z' }),
      packet({
        id: 'p2',
        slug: 'case-aphrodite',
        updatedAt: '2026-05-12T11:00:00Z',
      }),
    ],
    clowns: [],
  })
  // case-aphrodite shouldn't show up as a top-tier node.
  expect(rollup.products.some((p) => p.productSlug === 'case-aphrodite')).toBe(false)
  // …it should be nested under aphrodite.
  const aphrodite = rollup.products.find((p) => p.productSlug === 'aphrodite')!
  expect(aphrodite.cases.map((c) => c.productSlug)).toContain('case-aphrodite')
})

test('the generic `case` slug stays at top level (no parent)', () => {
  const rollup = summariseProductLibrary({ packets: [], clowns: [] })
  expect(rollup.products.some((p) => p.productSlug === 'case')).toBe(true)
})

test('mostRecentPacketId picks the parent\'s newest packet when one exists', () => {
  const rollup = summariseProductLibrary({
    packets: [
      packet({ id: 'old', slug: 'aphrodite', updatedAt: '2026-05-10T08:00:00Z' }),
      packet({ id: 'new', slug: 'aphrodite', updatedAt: '2026-05-12T18:00:00Z' }),
      // Even a fresher case packet must NOT win when the parent has its own.
      packet({ id: 'caseNew', slug: 'case-aphrodite', updatedAt: '2026-05-12T20:00:00Z' }),
    ],
    clowns: [],
  })
  const aphrodite = rollup.products.find((p) => p.productSlug === 'aphrodite')!
  expect(aphrodite.mostRecentPacketId).toBe('new')
})

test('mostRecentPacketId falls back to a child case packet when the parent has none', () => {
  const rollup = summariseProductLibrary({
    packets: [
      packet({ id: 'caseOnly', slug: 'case-aphrodite', updatedAt: '2026-05-12T20:00:00Z' }),
    ],
    clowns: [],
  })
  const aphrodite = rollup.products.find((p) => p.productSlug === 'aphrodite')!
  expect(aphrodite.packets).toEqual([])
  // Bubbled up from the case so clicking the product card still lands somewhere.
  expect(aphrodite.mostRecentPacketId).toBe('caseOnly')
  expect(aphrodite.latestUpdatedAt).toBe('2026-05-12T20:00:00Z')
})

test('coverage rollups match per-packet sums', () => {
  // 1 ready (clown matches), 1 blocked (no clown).
  const rollup = summariseProductLibrary({
    packets: [
      packet({ id: 'matched', slug: 'switch2', updatedAt: '2026-05-11', renderCount: 2 }),
      packet({ id: 'blocked', slug: 'aphrodite', updatedAt: '2026-05-11', renderCount: 3 }),
    ],
    clowns: [clown('switch2')],
  })
  const sw = rollup.products.find((p) => p.productSlug === 'switch2')!
  expect(sw.coverage).toEqual({
    total: 2,
    matched: 2,
    blocked: 0,
    missingSlugs: [],
  })
  expect(sw.readyPackets).toBe(1)
  expect(sw.blockedPackets).toBe(0)
  const ap = rollup.products.find((p) => p.productSlug === 'aphrodite')!
  expect(ap.coverage.matched).toBe(0)
  expect(ap.coverage.blocked).toBe(3)
  expect(ap.blockedPackets).toBe(1)
})

test('clown thumbnails are stable, deduped, and capped at 3 per product', () => {
  const rollup = summariseProductLibrary({
    packets: [packet({ id: 'p1', slug: 'aphrodite', updatedAt: '2026-05-12' })],
    clowns: [
      clown('aphrodite', 'emerald'),
      clown('aphrodite', 'onyx'),
      clown('aphrodite', 'ivory'),
      clown('aphrodite', 'rose'),
      clown('switch2', 'emerald'),
    ],
  })
  const ap = rollup.products.find((p) => p.productSlug === 'aphrodite')!
  expect(ap.clownThumbnailUrls).toHaveLength(3)
  expect(ap.clownVariantCount).toBe(4)
  // Sorted by variantSlug → emerald, ivory, onyx (rose drops off).
  expect(ap.clownThumbnailUrls[0]).toContain('emerald')
  expect(ap.clownThumbnailUrls[1]).toContain('ivory')
  expect(ap.clownThumbnailUrls[2]).toContain('onyx')
})

test('packets with an unknown productSlug land in an Uncatalogued top-tier node', () => {
  const rollup = summariseProductLibrary({
    packets: [
      packet({ id: 'legacy', slug: 'never-shipped-product', updatedAt: '2026-05-12' }),
    ],
    clowns: [],
  })
  const orphan = rollup.products.find(
    (p) => p.productSlug === 'never-shipped-product'
  )
  expect(orphan).toBeTruthy()
  expect(orphan!.product).toBeNull()
  expect(orphan!.category).toBe('other')
  expect(orphan!.packets).toHaveLength(1)
})

test('totals sum across catalog products AND child cases, not just top-tier', () => {
  const rollup = summariseProductLibrary({
    packets: [
      packet({ id: 'p1', slug: 'aphrodite', updatedAt: '2026-05-12', renderCount: 3 }),
      packet({ id: 'p2', slug: 'case-aphrodite', updatedAt: '2026-05-12', renderCount: 2 }),
    ],
    clowns: [clown('aphrodite'), clown('case-aphrodite')],
  })
  expect(rollup.totals.packets).toBe(2)
  expect(rollup.totals.skus).toBe(5)
  expect(rollup.totals.productsWithPackets).toBe(2)
  expect(rollup.totals.readyPackets).toBeGreaterThan(0)
})

test('top-tier products sort by category (earplug → sensewear → case → other)', () => {
  const rollup = summariseProductLibrary({ packets: [], clowns: [] })
  const categoryOrder = rollup.products.map((p) => p.category)
  // Find first index of each category.
  const firstEarplug = categoryOrder.indexOf('earplug')
  const firstSensewear = categoryOrder.indexOf('sensewear')
  const firstCase = categoryOrder.indexOf('case')
  expect(firstEarplug).toBeGreaterThanOrEqual(0)
  expect(firstEarplug).toBeLessThan(firstSensewear)
  expect(firstSensewear).toBeLessThan(firstCase)
})
