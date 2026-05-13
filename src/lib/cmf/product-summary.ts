/**
 * Per-product rollup used by the CMF library landing + product strip.
 *
 * The dropdown selector shipped 2026-05-12 grouped packets by product
 * but only as a tree of expandable nodes. The library + strip surface
 * the same product catalog as a scannable grid / nav rail, so we need
 * one structured snapshot per top-tier product:
 *
 *   - "How many packets, how many SKUs, how many ready / partial / blocked?"
 *   - "Where's the most recent activity (so I can land you on the
 *     packet you actually want when you click)?"
 *   - "What does the clown library look like for this product?"
 *   - "Are there any case / pouch sub-products underneath this one?"
 *
 * Pure function — no React, no hooks, no fetching. Both the library
 * cards and the strip chips read it; tests pin its behaviour without
 * spinning up the dev server.
 */

import {
  clownCoverageForPacket,
  type PacketClownCoverage,
} from './coverage'
import {
  CMF_PRODUCT_CATALOG,
  type CmfProductSpec,
} from './products'

interface SummaryRender {
  productSlug: string
  variantSlug: string
  clownAssetId?: string | null
  // Optional row fields that the workspace + products dialog read off
  // each render. Kept optional so callers can pass the minimal shape
  // (clown coverage only) when that's all they need — the products
  // dialog passes the full CmfRender row off the API.
  id?: string
  label?: string
  colorwayName?: string | null
  renderUrl?: string | null
  status?: string
  // Workbook-tab fields. The Products dialog needs the parsed Excel
  // content (componentSpecs / paletteSwatches) and the SKU
  // identifiers (productCode / ean) to render the per-SKU specs
  // alongside the approved render thumbnail. Optional because
  // smaller call sites (coverage math) don't carry them.
  productCode?: string | null
  ean?: string | null
  componentSpecs?: unknown
  paletteSwatches?: unknown
}

interface SummaryPacket {
  id: string
  name: string
  cmfCode: string | null
  status: string
  updatedAt: string
  createdAt: string
  renders: SummaryRender[]
  // PDF tab fields — present when the packet has been exported. The
  // helper itself doesn't consume them; the dialog reads them off
  // the SummaryPacket via ProductSummary.packets[].
  pdfUrl?: string | null
  generatedAt?: string | null
}

interface SummaryClown {
  id: string
  productSlug: string
  variantSlug: string
  imageUrl: string
  label: string
}

export interface ProductSummary {
  /** Catalog spec when the product is recognised. Null only for the
   *  fallback "uncatalogued" group that captures legacy slugs. */
  product: CmfProductSpec | null
  productSlug: string
  displayName: string
  category: 'earplug' | 'sensewear' | 'case' | 'other'
  /** Packets attached directly to THIS product (excludes child cases). */
  packets: SummaryPacket[]
  /** Aggregate SKU count across `packets` (does NOT include cases). */
  skuCount: number
  /** Per-status packet rollup using the same buckets as
   *  summariseWorkspaceCoverage: SKUs all matched → ready, some
   *  matched/some blocked → partial, none matched → blocked.
   *  Excludes packets with zero renders. */
  readyPackets: number
  partialPackets: number
  blockedPackets: number
  /** SKU-level rollup so the catalog can show "12 / 14 SKUs ready". */
  coverage: PacketClownCoverage
  /** ISO timestamp of the most recently-updated packet across this
   *  product AND its child cases. Used by the library card + strip
   *  chip to pick the packet to auto-open when the row is clicked. */
  latestUpdatedAt: string | null
  /** Packet to load when this product card / chip is clicked. Falls
   *  back to a child case's most recent packet when the parent has
   *  zero of its own. Null when the entire branch is empty. */
  mostRecentPacketId: string | null
  /** Up to 3 distinct clown thumbnails for this product, ordered by
   *  variantSlug for stability. The card uses these as the visual
   *  anchor; the chip uses the first one as a tiny avatar. */
  clownThumbnailUrls: string[]
  /** All clown variants we know about for this product (for the
   *  "X clown variants" line beneath the thumbnails). */
  clownVariantCount: number
  /** Cases / pouches whose `parentSlug` points at this product. Each
   *  carries its own ProductSummary so the card can render an inline
   *  "+ Carry case · 2 packets" footer. Empty for products without a
   *  case in the catalog (Cocoon, Eclipse) and for the cases
   *  themselves. */
  cases: ProductSummary[]
}

export interface LibraryRollup {
  /** Top-tier products (every catalog entry without a parentSlug,
   *  plus a synthetic "Uncatalogued" group when packets reference an
   *  unknown slug). Cases are nested under their parent in `cases[]`,
   *  not promoted to the top tier. */
  products: ProductSummary[]
  /** Workspace counters for the library hero strip. */
  totals: {
    products: number
    productsWithPackets: number
    packets: number
    skus: number
    readyPackets: number
    partialPackets: number
    blockedPackets: number
  }
}

const CATEGORY_ORDER: Record<ProductSummary['category'], number> = {
  earplug: 0,
  sensewear: 1,
  case: 2,
  other: 3,
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

/**
 * Build a per-product `ProductSummary` for one slug, given the packets
 * attached to it and the global clown library. Used as the inner loop
 * for `summariseProductLibrary` and (when needed) for one-off lookups
 * by the product strip.
 */
function buildProductSummary(args: {
  product: CmfProductSpec | null
  productSlug: string
  displayName: string
  category: ProductSummary['category']
  packets: SummaryPacket[]
  clowns: SummaryClown[]
}): ProductSummary {
  const { product, productSlug, displayName, category, packets, clowns } = args

  // Coverage: aggregate per-packet results into a single SKU-level
  // matched/blocked tally, plus packet-level ready/partial/blocked
  // buckets that mirror summariseWorkspaceCoverage.
  let skuCount = 0
  let matched = 0
  let blocked = 0
  let ready = 0
  let partial = 0
  let blockedPackets = 0
  const missingSet = new Set<string>()
  const missingOrder: string[] = []
  let mostRecentPacketId: string | null = null
  let mostRecentUpdatedAt: string | null = null
  let latestUpdatedAt: string | null = null

  for (const packet of packets) {
    skuCount += packet.renders.length
    if (packet.updatedAt > (latestUpdatedAt ?? '')) {
      latestUpdatedAt = packet.updatedAt
    }
    if (packet.updatedAt > (mostRecentUpdatedAt ?? '')) {
      mostRecentUpdatedAt = packet.updatedAt
      mostRecentPacketId = packet.id
    }
    const cov = clownCoverageForPacket(packet, clowns)
    matched += cov.matched
    blocked += cov.blocked
    for (const slug of cov.missingSlugs) {
      if (!missingSet.has(slug)) {
        missingSet.add(slug)
        missingOrder.push(slug)
      }
    }
    if (cov.total === 0) continue
    if (cov.blocked === 0) ready += 1
    else if (cov.matched > 0) partial += 1
    else blockedPackets += 1
  }

  // Clown thumbnails: stable ordering by variantSlug so the same 1–3
  // images show every render (no flicker as React re-keys).
  const productClowns = clowns
    .filter((c) => c.productSlug === productSlug)
    .sort((a, b) => a.variantSlug.localeCompare(b.variantSlug))

  return {
    product,
    productSlug,
    displayName,
    category,
    packets,
    skuCount,
    readyPackets: ready,
    partialPackets: partial,
    blockedPackets,
    coverage: { total: skuCount, matched, blocked, missingSlugs: missingOrder },
    latestUpdatedAt,
    mostRecentPacketId,
    clownThumbnailUrls: productClowns.slice(0, 3).map((c) => c.imageUrl),
    clownVariantCount: productClowns.length,
    cases: [],
  }
}

/**
 * Build the full library rollup. Designed to be cheap to call on every
 * render — the inputs are already in memory via React Query, and the
 * loops here are O(packets × clowns) which is small (tens of each).
 */
export function summariseProductLibrary(args: {
  packets: SummaryPacket[] | null | undefined
  clowns: SummaryClown[] | null | undefined
  /** Optional override for the catalog (used by tests). Defaults to
   *  the live `CMF_PRODUCT_CATALOG`. */
  catalog?: CmfProductSpec[]
}): LibraryRollup {
  const packets = args.packets ?? []
  const clowns = args.clowns ?? []
  const catalog = args.catalog ?? CMF_PRODUCT_CATALOG

  // Bucket packets by their primary productSlug (the slug of the first
  // render — that's how the rest of the codebase identifies a
  // packet's "owning" product, same convention used by the smart-merge
  // in createPacketFromRows and the packet selector strip).
  const packetsBySlug = new Map<string, SummaryPacket[]>()
  for (const packet of packets) {
    const slug = packet.renders[0]?.productSlug
    if (!slug) continue
    const bucket = packetsBySlug.get(slug) ?? []
    bucket.push(packet)
    packetsBySlug.set(slug, bucket)
  }

  // First pass: build a ProductSummary for every catalog entry (so
  // products with zero packets still appear in the library) AND for
  // every legacy slug that doesn't have a catalog spec.
  const summariesBySlug = new Map<string, ProductSummary>()
  for (const product of catalog) {
    summariesBySlug.set(
      product.slug,
      buildProductSummary({
        product,
        productSlug: product.slug,
        displayName: product.name,
        category: product.category,
        packets: packetsBySlug.get(product.slug) ?? [],
        clowns,
      })
    )
  }
  for (const [slug, slugPackets] of Array.from(packetsBySlug.entries())) {
    if (summariesBySlug.has(slug)) continue
    summariesBySlug.set(
      slug,
      buildProductSummary({
        product: null,
        productSlug: slug,
        displayName: slug,
        category: 'other',
        packets: slugPackets,
        clowns,
      })
    )
  }

  // Second pass: nest cases / pouches under their parent product (and
  // bubble the case's most-recent packet up so a parent with zero
  // direct packets still has a sensible click target).
  const childSlugs = new Set<string>()
  for (const summary of Array.from(summariesBySlug.values())) {
    const parentSlug = summary.product?.parentSlug
    if (!parentSlug) continue
    const parent = summariesBySlug.get(parentSlug)
    if (!parent) continue
    parent.cases.push(summary)
    childSlugs.add(summary.productSlug)
    parent.latestUpdatedAt = maxIso(
      parent.latestUpdatedAt,
      summary.latestUpdatedAt
    )
    if (
      !parent.mostRecentPacketId ||
      (summary.latestUpdatedAt &&
        (!parent.latestUpdatedAt ||
          summary.latestUpdatedAt > parent.latestUpdatedAt))
    ) {
      // Only fall back to a case packet when the parent has no packets
      // of its own; otherwise the parent's own most-recent wins.
      if (parent.packets.length === 0 && summary.mostRecentPacketId) {
        parent.mostRecentPacketId = summary.mostRecentPacketId
      }
    }
  }
  // Sort cases inside each parent for deterministic UI ordering.
  for (const summary of Array.from(summariesBySlug.values())) {
    if (summary.cases.length > 1) {
      summary.cases.sort((a, b) => a.displayName.localeCompare(b.displayName))
    }
  }

  // Drop child summaries from the top-tier list (they live inside
  // their parent's `cases[]` now). The generic `case` slug stays at
  // top-level — it has no parent — so legacy data remains reachable.
  const topTier = Array.from(summariesBySlug.values())
    .filter((s) => !childSlugs.has(s.productSlug))
    .sort((a, b) => {
      const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
      if (cat !== 0) return cat
      return a.displayName.localeCompare(b.displayName)
    })

  // Workspace counters — sum across the whole library, INCLUDING child
  // cases since they're real packets a designer might be tracking.
  let totalPackets = 0
  let totalSkus = 0
  let totalReady = 0
  let totalPartial = 0
  let totalBlocked = 0
  let productsWithPackets = 0
  for (const summary of Array.from(summariesBySlug.values())) {
    totalPackets += summary.packets.length
    totalSkus += summary.skuCount
    totalReady += summary.readyPackets
    totalPartial += summary.partialPackets
    totalBlocked += summary.blockedPackets
    if (summary.packets.length > 0) productsWithPackets++
  }

  return {
    products: topTier,
    totals: {
      products: topTier.length,
      productsWithPackets,
      packets: totalPackets,
      skus: totalSkus,
      readyPackets: totalReady,
      partialPackets: totalPartial,
      blockedPackets: totalBlocked,
    },
  }
}
