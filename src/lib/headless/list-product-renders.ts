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
import { interpretRenderQuery, type RenderQuery } from '@/lib/product-renders/query'

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

function whereOf(name?: string, colorway?: string, renderType?: string): Record<string, unknown> {
  const where: Record<string, unknown> = {}
  if (name) where.name = { contains: name, mode: 'insensitive' }
  if (colorway) where.colorway = { contains: colorway, mode: 'insensitive' }
  if (renderType) where.renderType = renderType
  return where
}

/**
 * List product renders from the Supabase `product_renders` table.
 *
 * All filters are case-insensitive partial matches except `renderType`,
 * which is an enum-ish field and gets matched exactly so callers can
 * pre-filter to one kind of picture (`RENDER_TYPES`) without worrying about
 * unintended substring hits.
 */
export async function listProductRenders(
  input: ListProductRendersInput = {}
): Promise<ProductRenderForMcp[]> {
  return (await searchProductRenders(input)).renders
}

/**
 * The renders a request asks for, read the way a colleague says it. `name` may be a whole phrase
 * ("Aphrodite in the ear", "the Loop Live Pro box in black"): the product is found inside it, and a
 * colourway or kind of picture named beside it narrows the list unless the caller passed one. When
 * those extra words narrow it to nothing, the product's whole list comes back instead.
 */
export async function searchProductRenders(
  input: ListProductRendersInput = {}
): Promise<{ renders: ProductRenderForMcp[]; read: RenderQuery | null; widened: boolean }> {
  let read: RenderQuery | null = null
  let name = input.name
  let colorway = input.colorway
  let renderType = input.renderType
  if (input.name) {
    const catalog = await prisma.productRender.findMany({
      distinct: ['name', 'colorway'],
      select: { name: true, colorway: true },
    })
    read = interpretRenderQuery(input.name, catalog)
    name = read.name
    if (read.recognised) {
      colorway = colorway ?? read.colorway
      renderType = renderType ?? read.renderType
    }
  }
  let renders = await findRenders(whereOf(name, colorway, renderType))
  let widened = false
  if (renders.length === 0 && read?.recognised && (colorway !== input.colorway || renderType !== input.renderType)) {
    renders = await findRenders(whereOf(name, input.colorway, input.renderType))
    widened = true
  }
  return { renders, read, widened }
}

async function findRenders(where: Record<string, unknown>): Promise<ProductRenderForMcp[]> {
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
