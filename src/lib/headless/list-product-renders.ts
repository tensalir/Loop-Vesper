/**
 * `list_product_renders` MCP tool implementation + the `resolveProductRenders`
 * helper used by `generate_asset` to turn a list of UUIDs into the actual
 * Loop product imagery to feed into the model adapter.
 *
 * Source of truth: the `product_renders` Supabase table (Prisma model
 * `productRender`). Same rows that power the web app's "Product Renders"
 * browser. We deliberately do NOT call Frontify live from MCP; anything
 * already synced into the table (rows with `frontifyId` set) is visible,
 * Frontify-only assets are not. Live Frontify is a Phase 2 concern.
 *
 * Why not reuse `/api/product-renders`?
 *   - That route is auth'd via Supabase cookies, not headless bearer.
 *   - It does extra work (Frontify fetch, OAuth fallback, dedupe) we
 *     don't need on the MCP path.
 *   - Sharing the legacy list keeps coupling minimal — we only mirror the
 *     `DEPRECATED_PRODUCTS` filter so MCP shows the same product set as
 *     the web app.
 */

import { prisma } from '@/lib/prisma'

/**
 * Loop product names that are no longer surfaced in the web app's render
 * browser. Mirrors the list in `src/app/api/product-renders/route.ts` so
 * MCP and the web app agree on what's "current". The v1 products
 * (Engage/Experience/Quiet/Switch) were superseded by their `... 2`
 * successors; the Dream Carry variants are now `Dream` rows with
 * `renderType: 'case'`.
 */
const DEPRECATED_PRODUCTS = [
  'Engage',
  'Experience',
  'Quiet',
  'Switch',
  'Dream Carry',
  'Dream Lilac Carry',
  'Dream Peach Carry',
]

/** Compact shape Claude can scan and round-trip back as a productRenderId. */
export interface ProductRenderForMcp {
  id: string
  name: string
  colorway: string | null
  angle: string | null
  renderType: string | null
  imageUrl: string
}

export interface ListProductRendersInput {
  name?: string
  colorway?: string
  renderType?: string
}

/**
 * List product renders from the Supabase `product_renders` table.
 *
 * All filters are case-insensitive partial matches except `renderType`,
 * which is an enum-ish field and gets matched exactly so callers can
 * pre-filter to "single", "pair", or "case" without worrying about
 * unintended substring hits.
 */
export async function listProductRenders(
  input: ListProductRendersInput = {}
): Promise<ProductRenderForMcp[]> {
  const where: Record<string, unknown> = {}

  if (input.name) {
    where.name = { contains: input.name, mode: 'insensitive' }
  }
  if (input.colorway) {
    where.colorway = { contains: input.colorway, mode: 'insensitive' }
  }
  if (input.renderType) {
    where.renderType = input.renderType
  }

  const rows = await prisma.productRender.findMany({
    where,
    orderBy: [
      { name: 'asc' },
      { colorway: 'asc' },
      { sortOrder: 'asc' },
    ],
    select: {
      id: true,
      name: true,
      colorway: true,
      angle: true,
      renderType: true,
      imageUrl: true,
    },
  })

  return rows.filter((r) => !DEPRECATED_PRODUCTS.includes(r.name))
}

/**
 * Resolve a set of product render UUIDs into rows. Throws if any ID is
 * unknown so callers (notably `generate_asset`) can surface a clear,
 * actionable error to the agent rather than silently dropping IDs.
 *
 * Empty `ids` resolves to `[]` rather than throwing — callers should
 * gate on that before calling.
 */
export async function resolveProductRenders(
  ids: string[]
): Promise<ProductRenderForMcp[]> {
  if (ids.length === 0) return []

  const rows = await prisma.productRender.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      colorway: true,
      angle: true,
      renderType: true,
      imageUrl: true,
    },
  })

  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => r.id))
    const missing = ids.filter((id) => !found.has(id))
    throw new Error(
      `Unknown productRenderIds: ${missing.join(', ')}. Use list_product_renders to discover valid IDs.`
    )
  }

  // Preserve caller order so multi-image references go in the order the
  // agent intended.
  const byId = new Map(rows.map((r) => [r.id, r]))
  return ids.map((id) => byId.get(id)!)
}
