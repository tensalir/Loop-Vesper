/**
 * Shared clown-coverage helpers.
 *
 * Both the packet selector and the workspace need to know "given the
 * current shared clown library, which SKUs in this packet would the
 * render service actually be able to generate right now?". The answer
 * mirrors `runCmfRender`'s three-tier reference resolution:
 *
 *   1. The render row has an explicit `clownAssetId`  → resolved
 *   2. Library has an exact (productSlug, variantSlug) match → resolved
 *   3. Library has *any* clown for the productSlug → resolved (variant fallback)
 *
 * Anything else is genuinely blocked: the bulk burst will fail on those
 * SKUs with category `reference` until a clown lands in the library.
 *
 * Kept in `src/lib/cmf/` rather than `src/hooks/` so server code (e.g.
 * future readiness columns surfaced through the API) can use the same
 * function without dragging React Query along for the ride.
 */

interface CoverageRender {
  productSlug: string
  variantSlug: string
  clownAssetId?: string | null
}

interface CoverageClown {
  productSlug: string
  variantSlug: string
}

export interface PacketClownCoverage {
  total: number
  /** SKUs the render service can resolve a clown for right now. */
  matched: number
  /** SKUs with no matching clown via any of the three tiers. */
  blocked: number
  /** Product slugs that have at least one blocked SKU (deduped, stable order). */
  missingSlugs: string[]
}

export function clownCoverageForPacket(
  packet: { renders: CoverageRender[] } | null | undefined,
  clowns: CoverageClown[] | null | undefined
): PacketClownCoverage {
  if (!packet) return { total: 0, matched: 0, blocked: 0, missingSlugs: [] }

  const library = clowns ?? []
  const exact = new Set<string>()
  const anyForProduct = new Set<string>()
  for (const c of library) {
    exact.add(`${c.productSlug}:${c.variantSlug}`)
    anyForProduct.add(c.productSlug)
  }

  let matched = 0
  let blocked = 0
  const missingSet = new Set<string>()
  const missingOrder: string[] = []

  for (const render of packet.renders) {
    const hasClown =
      !!render.clownAssetId ||
      exact.has(`${render.productSlug}:${render.variantSlug}`) ||
      anyForProduct.has(render.productSlug)
    if (hasClown) {
      matched += 1
    } else {
      blocked += 1
      if (!missingSet.has(render.productSlug)) {
        missingSet.add(render.productSlug)
        missingOrder.push(render.productSlug)
      }
    }
  }

  return {
    total: packet.renders.length,
    matched,
    blocked,
    missingSlugs: missingOrder,
  }
}

/**
 * Roll a list of per-packet coverage summaries into a workspace-level
 * snapshot — used by the packet selector to print "4 ready · 3 need clowns"
 * at the top of the dropdown.
 */
export function summariseWorkspaceCoverage(
  packets: Array<{ renders: CoverageRender[] }>,
  clowns: CoverageClown[] | null | undefined
): {
  totalPackets: number
  readyPackets: number
  partialPackets: number
  blockedPackets: number
} {
  let ready = 0
  let partial = 0
  let blocked = 0
  for (const p of packets) {
    const coverage = clownCoverageForPacket(p, clowns)
    if (coverage.total === 0) continue
    if (coverage.blocked === 0) ready += 1
    else if (coverage.matched > 0) partial += 1
    else blocked += 1
  }
  return {
    totalPackets: packets.length,
    readyPackets: ready,
    partialPackets: partial,
    blockedPackets: blocked,
  }
}
