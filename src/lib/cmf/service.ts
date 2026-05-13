/**
 * Higher-level CMF service helpers used by API routes.
 *
 * Access model (as of 2026-05-12):
 *   - READ: any authenticated profile can list and view every packet.
 *     The library is one ground-truth visible to all teammates so a
 *     designer, PM, and engineer always look at the same workbook
 *     and the same set of renders.
 *   - WRITE: scoped to admins and to the small set of profiles that
 *     have `cmfAccess = true` (granted via the admin user-management
 *     UI). This mirrors `headlessAccess` and is the chokepoint that
 *     keeps "single ground truth" safe — only the team owners of the
 *     CMF workflow can mutate it.
 *   - Owner / cmf_packet_members rows survive as audit metadata so
 *     the activity drawer can still attribute history to a person,
 *     but they no longer gate access.
 *
 * Helpers in this module never trust a packet ID without an access check.
 * `requirePacketAccess` checks read-or-write depending on `minRole`, and
 * `requireCmfWrite` is the global write guard called from every mutating
 * route handler.
 */

import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import type { CmfSkuRow, ComponentSpec, PaletteSwatch } from './schema'
import { getCmfProduct } from './products'

export class CmfNotFoundError extends Error {
  constructor(message = 'CMF resource not found') {
    super(message)
    this.name = 'CmfNotFoundError'
  }
}

export class CmfForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'CmfForbiddenError'
  }
}

export interface AuthenticatedProfile {
  userId: string
  email: string | null
  /** True when the caller can mutate CMF data (admin OR cmfAccess flag). */
  canWrite: boolean
  /** True when the caller is an admin. Admins always have canWrite. */
  isAdmin: boolean
}

export type CmfPacketRole = 'owner' | 'approver' | 'editor' | 'viewer'

const ROLE_RANK: Record<CmfPacketRole, number> = {
  viewer: 0,
  editor: 1,
  approver: 2,
  owner: 3,
}

export function roleAllows(actual: CmfPacketRole, required: CmfPacketRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required]
}

/**
 * Pure-function implementation of the CMF write decision. Extracted from
 * `requireCmfWrite` so it can be unit-tested without spinning up Supabase
 * cookies or Prisma.
 *
 *   - Admins always have write access.
 *   - Profiles with `cmfAccess === true` have write access.
 *   - Everyone else (including unknown profiles) does not.
 *
 * Mirrors the `Profile.role` enum from Prisma (`'admin' | 'user'`) but is
 * intentionally lenient on the role string so future additions don't
 * silently flip the boolean.
 */
export function profileCanWriteCmf(profile: {
  role?: string | null
  cmfAccess?: boolean | null
} | null | undefined): boolean {
  if (!profile) return false
  if (profile.role === 'admin') return true
  return profile.cmfAccess === true
}

/**
 * Same shape as `getPacketRole` but pure — given an owner ID and a
 * profile, derive the effective role under the global-library model.
 * Covered by the access-matrix spec so the gating logic stays
 * regression-safe.
 */
export function deriveEffectivePacketRole(args: {
  packetOwnerId: string
  callerUserId: string
  callerProfile: { role?: string | null; cmfAccess?: boolean | null } | null | undefined
}): CmfPacketRole {
  if (args.packetOwnerId === args.callerUserId) return 'owner'
  return profileCanWriteCmf(args.callerProfile) ? 'editor' : 'viewer'
}

export async function requireAuthenticatedProfile(): Promise<
  | { profile: AuthenticatedProfile; response: null }
  | { profile: null; response: NextResponse }
> {
  const supabase = createRouteHandlerClient({ cookies })
  const { data, error } = await supabase.auth.getUser()
  if (error || !data?.user) {
    return {
      profile: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  const profile = await prisma.profile.findUnique({
    where: { id: data.user.id },
    select: { deletedAt: true, pausedAt: true, role: true, cmfAccess: true },
  })

  if (!profile || profile.deletedAt) {
    return {
      profile: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (profile.pausedAt) {
    return {
      profile: null,
      response: NextResponse.json({ error: 'Account paused' }, { status: 403 }),
    }
  }

  const isAdmin = profile.role === 'admin'
  return {
    profile: {
      userId: data.user.id,
      email: data.user.email ?? null,
      canWrite: profileCanWriteCmf(profile),
      isAdmin,
    },
    response: null,
  }
}

/**
 * Single chokepoint for CMF WRITE routes. Resolves the calling profile,
 * verifies they have the `cmf_access` grant (admins always pass), and
 * returns either a usable profile or a ready-to-return error response.
 *
 * Use this in every POST/PATCH/DELETE handler under /api/cmf instead of
 * relying on `requirePacketAccess` with `minRole: 'editor'` — the per-
 * packet member gating is gone and the global flag is the truth.
 */
export async function requireCmfWrite(): Promise<
  | { profile: AuthenticatedProfile; response: null }
  | { profile: null; response: NextResponse }
> {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth
  if (!auth.profile.canWrite) {
    return {
      profile: null,
      response: NextResponse.json(
        {
          error: 'cmf_access_required',
          message:
            'CMF write access is required for this action. Ask an admin to grant CMF access from the user management settings.',
        },
        { status: 403 }
      ),
    }
  }
  return { profile: auth.profile, response: null }
}

/**
 * Resolve the calling user's effective role on a packet under the new
 * global-library model.
 *
 *   - The packet must exist (returns null otherwise so callers map to 404).
 *   - The original `ownerId` still wins the `'owner'` label — that's how
 *     the activity drawer keeps attributing history to the importer.
 *   - Anyone with CMF write access (admin OR `cmfAccess`) gets `'editor'`.
 *   - Everyone else (any authenticated profile) gets `'viewer'` — the
 *     library is readable by all, but they can't mutate.
 *
 * The legacy `cmf_packet_members` table is no longer consulted for gating;
 * it survives only as audit metadata on the members dialog.
 */
export async function getPacketRole(
  packetId: string,
  userId: string
): Promise<CmfPacketRole | null> {
  const [packet, profile] = await Promise.all([
    prisma.cmfPacket.findUnique({
      where: { id: packetId },
      select: { ownerId: true },
    }),
    prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true, cmfAccess: true },
    }),
  ])
  if (!packet) return null
  return deriveEffectivePacketRole({
    packetOwnerId: packet.ownerId,
    callerUserId: userId,
    callerProfile: profile,
  })
}

/**
 * Single chokepoint for packet routes. Returns the role + packet, or throws
 * a typed error the route handler can translate to 404 (no access) or 403
 * (insufficient role).
 *
 * Under the global-library model:
 *   - Reads (`minRole` omitted or `'viewer'`) always pass for any
 *     authenticated profile, provided the packet exists.
 *   - Writes (`minRole: 'editor'` or higher) require the caller to be
 *     admin or to have `cmfAccess = true`.
 */
export async function requirePacketAccess(args: {
  packetId: string
  userId: string
  minRole?: CmfPacketRole
}) {
  const role = await getPacketRole(args.packetId, args.userId)
  if (!role) throw new CmfNotFoundError('Packet not found')
  if (args.minRole && !roleAllows(role, args.minRole)) {
    throw new CmfForbiddenError(
      `Role "${role}" cannot perform this action (requires ${args.minRole})`
    )
  }
  return { role }
}

export async function assertOwnsCmfPacket(packetId: string, ownerId: string) {
  const packet = await prisma.cmfPacket.findFirst({
    where: { id: packetId, ownerId },
    select: { id: true },
  })
  if (!packet) {
    throw new CmfNotFoundError('Packet not found')
  }
}

export async function assertOwnsCmfImport(importId: string, ownerId: string) {
  const record = await prisma.cmfImport.findFirst({
    where: { id: importId, ownerId },
    select: { id: true },
  })
  if (!record) {
    throw new CmfNotFoundError('Import not found')
  }
}

/**
 * Render-level access check — wraps `requirePacketAccess` with a render
 * lookup. Routes that mutate render rows (PATCH, generate) should require
 * editor or higher.
 */
export async function requireRenderAccess(args: {
  renderId: string
  userId: string
  minRole?: CmfPacketRole
}) {
  const render = await prisma.cmfRender.findUnique({
    where: { id: args.renderId },
    select: { packetId: true },
  })
  if (!render) throw new CmfNotFoundError('Render not found')
  const access = await requirePacketAccess({
    packetId: render.packetId,
    userId: args.userId,
    minRole: args.minRole,
  })
  return { ...access, packetId: render.packetId }
}

interface CreatePacketArgs {
  ownerId: string
  importId?: string | null
  /** Explicit packet name override. When omitted, the packet name is
   * inferred per product from each row's `packetName` / `Collection`. */
  packetName?: string | null
  cmfCode?: string | null
  notes?: string | null
  rows: CmfSkuRow[]
}

/**
 * Materialise (or smart-merge) CMF packets from validated SKU rows.
 *
 * Behaviour:
 *  - Rows are split by `productSlug` so each packet contains one product
 *    family (e.g. all Switch 2 colourways in one packet). This matches
 *    how Operations reviews CMF files and keeps the PDF filename
 *    pattern honest: `{cmfCode}_{Product}_CMF_*`.
 *  - Within each product, we look for an existing packet keyed on
 *    `(productSlug, cmfCode)`. When found, we MERGE the incoming SKUs
 *    into it instead of duplicating the packet. Matching uses
 *    `productCode` first (most stable) and falls back to a normalised
 *    label match. New rows append; existing rows shallow-diff their
 *    `componentSpecs` / `paletteSwatches`. Diffs surface as
 *    `sku_updated` activity entries with full before/after metadata so
 *    a designer can scan "what changed since last time".
 *  - When no existing packet matches, a new one is created (the
 *    historic behaviour) and a `created_packet` activity is logged.
 *
 * Returns one `{ packet, renders, mergeSummary }` entry per product.
 * `mergeSummary.kind` is either `'created'` (new packet) or `'merged'`
 * (re-upload into existing). The importer UI uses this to render a
 * "5 unchanged · 1 changed · 2 added" panel and link straight to the
 * changed SKUs.
 */
type CmfPacketRow = Awaited<ReturnType<typeof prisma.cmfPacket.create>>
type CmfRenderRow = Awaited<ReturnType<typeof prisma.cmfRender.create>>

export interface CmfMergeSummary {
  kind: 'created' | 'merged'
  productSlug: string
  packetId: string
  packetName: string
  cmfCode: string | null
  added: number
  updated: number
  unchanged: number
  /** Render IDs whose component or palette specs changed on this import.
   *  The importer panel surfaces these so designers can click straight
   *  through to the affected SKU. */
  changedRenderIds: string[]
  /** Per-render summaries of what changed. Empty when nothing changed. */
  changes: Array<{
    renderId: string
    label: string
    changedRegions: string[]
    paletteChanged: boolean
  }>
}

export interface CreatedPacket {
  packet: CmfPacketRow
  renders: CmfRenderRow[]
  mergeSummary: CmfMergeSummary
}

/**
 * Stable equality for component specs. We compare on the fields that
 * actually drive the recolour pass + PDF (region, material, finish,
 * pantone, colorHex, technique, notes). `label` is derived and ignored
 * to avoid spurious diffs when the catalog rename lands.
 */
function normaliseComponent(c: ComponentSpec): Record<string, string> {
  return {
    region: (c.region ?? '').toLowerCase(),
    material: (c.material ?? '').trim().toLowerCase(),
    finish: (c.finish ?? '').trim().toLowerCase(),
    pantone: (c.pantone ?? '').trim().toUpperCase(),
    colorHex: (c.colorHex ?? '').trim().toLowerCase(),
    technique: (c.technique ?? '').trim().toLowerCase(),
    notes: (c.notes ?? '').trim(),
  }
}

export function componentsDiffer(
  existing: unknown,
  incoming: ComponentSpec[]
): { changed: boolean; changedRegions: string[] } {
  const prev = Array.isArray(existing) ? (existing as ComponentSpec[]) : []
  const prevByRegion = new Map<string, Record<string, string>>()
  for (const c of prev) {
    if (!c?.region) continue
    prevByRegion.set(c.region.toLowerCase(), normaliseComponent(c))
  }
  const changedRegions: string[] = []
  for (const c of incoming) {
    if (!c?.region) continue
    const before = prevByRegion.get(c.region.toLowerCase())
    const after = normaliseComponent(c)
    if (!before) {
      changedRegions.push(c.region)
      continue
    }
    if (
      before.material !== after.material ||
      before.finish !== after.finish ||
      before.pantone !== after.pantone ||
      before.colorHex !== after.colorHex ||
      before.technique !== after.technique ||
      before.notes !== after.notes
    ) {
      changedRegions.push(c.region)
    }
  }
  // Detect dropped regions too — a designer removing a component is a
  // meaningful change worth surfacing. We materialise the keys with
  // Array.from so the iteration target stays compatible with the
  // current tsconfig (no `--downlevelIteration` required).
  for (const region of Array.from(prevByRegion.keys())) {
    if (!incoming.some((c) => c.region?.toLowerCase() === region)) {
      changedRegions.push(region)
    }
  }
  return { changed: changedRegions.length > 0, changedRegions }
}

export function palettesDiffer(existing: unknown, incoming: PaletteSwatch[]): boolean {
  const prev = Array.isArray(existing) ? (existing as PaletteSwatch[]) : []
  if (prev.length !== incoming.length) return true
  for (let i = 0; i < incoming.length; i++) {
    const a = prev[i]
    const b = incoming[i]
    if ((a?.label ?? '').trim() !== (b?.label ?? '').trim()) return true
    if ((a?.pantone ?? '').trim().toUpperCase() !== (b?.pantone ?? '').trim().toUpperCase()) return true
    if ((a?.colorHex ?? '').trim().toLowerCase() !== (b?.colorHex ?? '').trim().toLowerCase()) return true
  }
  return false
}

function normaliseLabelKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * Stable signature for a packet's "row identity" — the sorted set of its
 * SKU keys, where each key prefers `productCode` (most stable) and falls
 * back to a normalised label. Used as the merge key when a workbook is
 * re-uploaded WITHOUT a `cmfCode` so we still avoid duplicating the
 * exact same set of SKUs.
 *
 * This is intentionally specific:
 *   - Same SKUs in any order   → same signature → merge.
 *   - Even one SKU added/removed/renamed → different signature → new packet.
 * That's the right conservatism for null-cmfCode rows: we'd rather
 * occasionally fail to merge a renamed-SKU re-upload than collapse two
 * actually-distinct launches.
 */
export function packetRowSignature(
  rows: Array<{ productCode?: string | null; label?: string | null }>
): string {
  const keys = rows
    .map((r) => (r.productCode ?? r.label ?? '').toLowerCase().trim())
    .filter(Boolean)
    .map(normaliseLabelKey)
    .sort()
  return keys.join('|')
}

function rendersToSignature(
  rows: Array<{ productCode: string | null; label: string }>
): string {
  return packetRowSignature(rows)
}

/**
 * Bucket validated SKU rows by their `productSlug`, preserving workbook
 * order in the returned array. Pure (no DB, no I/O) so tests can
 * exercise it directly. The shape — `Array<{ productSlug, rows }>`
 * instead of a `Map` — matches what the orchestrator iterates over
 * without forcing a `Map` iteration target.
 */
export function groupRowsByProductSlug(
  rows: CmfSkuRow[]
): Array<{ productSlug: string; rows: CmfSkuRow[] }> {
  const buckets: Record<string, CmfSkuRow[]> = {}
  const order: string[] = []
  for (const row of rows) {
    if (!buckets[row.productSlug]) {
      buckets[row.productSlug] = []
      order.push(row.productSlug)
    }
    buckets[row.productSlug].push(row)
  }
  return order.map((slug) => ({ productSlug: slug, rows: buckets[slug] }))
}

/**
 * Transaction-scoped Prisma client passed into the merge/create
 * helpers. Defined inline (instead of `Prisma.TransactionClient`) so
 * we don't pull the heavy generated namespace into modules that only
 * need the call signature; the orchestrator passes `tx` straight from
 * `prisma.$transaction` and TypeScript infers the rest.
 */
type CmfTransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

/**
 * Smart-merge lookup. Returns the existing packet to merge into, or
 * `null` when the rows should produce a fresh packet. Two strategies:
 *
 *   1. `(productSlug, cmfCode)` exact match — for production workbooks
 *      that carry a CMF code. Cmf code alone could collide across
 *      products so we additionally require at least one render to
 *      share the productSlug.
 *
 *   2. SKU signature match — for null-cmfCode packets (typical for
 *      the dev iteration loop). The first packet whose SKU set
 *      (productCode preferred, normalised label as fallback) matches
 *      the incoming rows wins.
 *
 * In both cases we prefer the OLDEST matching packet so edits,
 * comments, and activity stay anchored to the canonical record.
 */
async function findExistingPacketForMerge(
  tx: CmfTransactionClient,
  productSlug: string,
  inferredCmf: string | null,
  rows: CmfSkuRow[]
) {
  if (inferredCmf) {
    const byCode = await tx.cmfPacket.findFirst({
      where: {
        cmfCode: inferredCmf,
        renders: { some: { productSlug } },
      },
      orderBy: { createdAt: 'asc' },
      include: { renders: { orderBy: { sortOrder: 'asc' } } },
    })
    if (byCode) return byCode
  }
  // Signature fallback. We intentionally span owners — under the
  // global-library model anyone re-uploading the same workbook should
  // land on the canonical record. Cardinality is small (tens of
  // packets per product at most), so loading + signature-comparing in
  // JS is cheaper than building a generated-column index.
  if (!inferredCmf) {
    const incomingSig = packetRowSignature(rows)
    if (!incomingSig) return null
    const candidates = await tx.cmfPacket.findMany({
      where: {
        cmfCode: null,
        renders: { some: { productSlug } },
      },
      orderBy: { createdAt: 'asc' },
      include: { renders: { orderBy: { sortOrder: 'asc' } } },
    })
    for (const candidate of candidates) {
      const sig = rendersToSignature(
        candidate.renders.map((r) => ({
          productCode: r.productCode,
          label: r.label,
        }))
      )
      if (sig === incomingSig) return candidate
    }
  }
  return null
}

interface PacketWriteContext {
  ownerId: string
  importId: string | null
  productSlug: string
  inferredCmf: string | null
  /** Catalog spec (defaultModelId etc.). May be null for uncatalogued slugs. */
  product: ReturnType<typeof getCmfProduct>
}

/**
 * Merge incoming rows into an existing packet. Per row we try to find
 * a matching render by `productCode` (preferred) or normalised label;
 * matched renders are diffed and either updated or marked unchanged;
 * unmatched rows are appended. Activity rows are emitted for each
 * `sku_added` / `sku_updated` plus one `packet_merged` umbrella event.
 *
 * Caller is responsible for ensuring `existingPacket` is one of the
 * packets returned by `findExistingPacketForMerge` so the type matches
 * (it includes `renders`).
 */
async function mergeRowsIntoPacket(
  tx: CmfTransactionClient,
  existingPacket: NonNullable<Awaited<ReturnType<typeof findExistingPacketForMerge>>>,
  rows: CmfSkuRow[],
  ctx: PacketWriteContext
): Promise<CreatedPacket> {
  const { ownerId, importId, productSlug, inferredCmf, product } = ctx
  const renderRows: CmfRenderRow[] = []
  const changes: CmfMergeSummary['changes'] = []
  const changedRenderIds: string[] = []
  let added = 0
  let updated = 0
  let unchanged = 0

  // Index existing renders by productCode (preferred) and by normalised
  // label so we can match incoming rows even when one identifier is
  // missing.
  const byProductCode = new Map<string, (typeof existingPacket.renders)[number]>()
  const byLabel = new Map<string, (typeof existingPacket.renders)[number]>()
  for (const r of existingPacket.renders) {
    if (r.productCode) byProductCode.set(r.productCode.toLowerCase(), r)
    byLabel.set(normaliseLabelKey(r.label), r)
  }

  let nextSortOrder = existingPacket.renders.reduce(
    (m, r) => Math.max(m, r.sortOrder + 1),
    0
  )

  for (const row of rows) {
    const match =
      (row.productCode && byProductCode.get(row.productCode.toLowerCase())) ||
      byLabel.get(normaliseLabelKey(row.label))

    if (match) {
      const componentDiff = componentsDiffer(match.componentSpecs, row.components)
      const paletteChanged = palettesDiffer(match.paletteSwatches, row.palette ?? [])
      if (componentDiff.changed || paletteChanged) {
        const updatedRender = await tx.cmfRender.update({
          where: { id: match.id },
          data: {
            // Refresh the human-readable fields too so workbook
            // renames flow through to the gallery.
            label: row.label,
            productCode: row.productCode ?? match.productCode,
            ean: row.ean ?? match.ean,
            variantSlug: row.variantSlug ?? match.variantSlug,
            colorwayName: row.colorwayName ?? match.colorwayName,
            componentSpecs: row.components,
            paletteSwatches: row.palette ?? [],
            modelId: row.modelId ?? match.modelId,
          },
        })
        renderRows.push(updatedRender)
        updated++
        changedRenderIds.push(updatedRender.id)
        changes.push({
          renderId: updatedRender.id,
          label: updatedRender.label,
          changedRegions: componentDiff.changedRegions,
          paletteChanged,
        })

        await tx.cmfActivity.create({
          data: {
            packetId: existingPacket.id,
            userId: ownerId,
            action: 'sku_updated',
            targetId: updatedRender.id,
            metadata: {
              label: updatedRender.label,
              productCode: updatedRender.productCode,
              changedRegions: componentDiff.changedRegions,
              paletteChanged,
              importId: importId ?? null,
              before: {
                componentSpecs: match.componentSpecs,
                paletteSwatches: match.paletteSwatches,
              },
              after: {
                componentSpecs: row.components,
                paletteSwatches: row.palette ?? [],
              },
            },
          },
        })
      } else {
        renderRows.push(match)
        unchanged++
      }
    } else {
      // Brand-new SKU for this packet — append.
      const created = await tx.cmfRender.create({
        data: {
          packetId: existingPacket.id,
          ownerId,
          label: row.label,
          productCode: row.productCode ?? null,
          ean: row.ean ?? null,
          productSlug: row.productSlug,
          variantSlug: row.variantSlug ?? 'default',
          colorwayName: row.colorwayName ?? null,
          componentSpecs: row.components,
          paletteSwatches: row.palette ?? [],
          modelId: row.modelId ?? product?.defaultModelId ?? null,
          sortOrder: nextSortOrder++,
          status: 'draft',
        },
      })
      renderRows.push(created)
      added++

      await tx.cmfActivity.create({
        data: {
          packetId: existingPacket.id,
          userId: ownerId,
          action: 'sku_added',
          targetId: created.id,
          metadata: {
            label: created.label,
            productCode: created.productCode,
            productSlug,
            importId: importId ?? null,
          },
        },
      })
    }
  }

  // One umbrella activity per merge so the timeline gives a quick
  // "this import touched the packet" signal even if zero SKUs moved.
  await tx.cmfActivity.create({
    data: {
      packetId: existingPacket.id,
      userId: ownerId,
      action: 'packet_merged',
      metadata: {
        productSlug,
        cmfCode: inferredCmf,
        importId: importId ?? null,
        added,
        updated,
        unchanged,
        changedRenderIds,
      },
    },
  })

  // Refresh the packet's `updatedAt` timestamp so the dropdown's
  // sort-by-recency surfaces freshly-merged packets.
  const refreshedPacket = await tx.cmfPacket.update({
    where: { id: existingPacket.id },
    data: {
      // Keep notes / name as-is; merging is additive, not a rename.
      updatedAt: new Date(),
    },
  })

  return {
    packet: refreshedPacket,
    renders: renderRows,
    mergeSummary: {
      kind: 'merged',
      productSlug,
      packetId: refreshedPacket.id,
      packetName: refreshedPacket.name,
      cmfCode: refreshedPacket.cmfCode,
      added,
      updated,
      unchanged,
      changedRenderIds,
      changes,
    },
  }
}

/**
 * Create a fresh packet plus one render per row. The historic create
 * path. Activity rows: one `created_packet` event for the whole
 * packet (per-render `sku_added` events would just duplicate the
 * "you just imported this" signal).
 */
async function createPacketWithRenders(
  tx: CmfTransactionClient,
  rows: CmfSkuRow[],
  packetName: string,
  notes: string | null,
  ctx: PacketWriteContext
): Promise<CreatedPacket> {
  const { ownerId, importId, productSlug, inferredCmf, product } = ctx
  const packet = await tx.cmfPacket.create({
    data: {
      ownerId,
      importId: importId ?? null,
      name: packetName,
      cmfCode: inferredCmf,
      notes: notes ?? null,
      status: 'draft',
    },
  })

  const renders = await Promise.all(
    rows.map((row: CmfSkuRow, index: number) =>
      tx.cmfRender.create({
        data: {
          packetId: packet.id,
          ownerId,
          label: row.label,
          productCode: row.productCode ?? null,
          ean: row.ean ?? null,
          productSlug: row.productSlug,
          variantSlug: row.variantSlug ?? 'default',
          colorwayName: row.colorwayName ?? null,
          componentSpecs: row.components,
          paletteSwatches: row.palette ?? [],
          modelId: row.modelId ?? product?.defaultModelId ?? null,
          sortOrder: index,
          status: 'draft',
        },
      })
    )
  )

  await tx.cmfActivity.create({
    data: {
      packetId: packet.id,
      userId: ownerId,
      action: 'created_packet',
      metadata: {
        rows: rows.length,
        productSlug,
        importId: importId ?? null,
      },
    },
  })

  return {
    packet,
    renders,
    mergeSummary: {
      kind: 'created',
      productSlug,
      packetId: packet.id,
      packetName: packet.name,
      cmfCode: packet.cmfCode,
      added: renders.length,
      updated: 0,
      unchanged: 0,
      changedRenderIds: [],
      changes: [],
    },
  }
}

/**
 * Resolve the per-product packet name. Prefers an explicit caller-supplied
 * name (suffixed with the product display name so multi-product imports
 * stay distinguishable), then the workbook `Collection` (carried on each
 * row as `packetName`), and finally the product display name.
 */
function resolvePacketName(
  rows: CmfSkuRow[],
  productSlug: string,
  explicit: string | null | undefined
): string {
  const product = getCmfProduct(productSlug)
  const productName = product?.name ?? productSlug
  if (explicit) return `${explicit} · ${productName}`
  const collection = rows
    .map((r: CmfSkuRow) => r.packetName)
    .find((p: string | undefined) => Boolean(p))
  return collection ?? productName
}

export async function createPacketFromRows(
  args: CreatePacketArgs
): Promise<{ packets: CreatedPacket[] }> {
  if (args.rows.length === 0) return { packets: [] }
  const buckets = groupRowsByProductSlug(args.rows)

  return prisma.$transaction(async (tx) => {
    const out: CreatedPacket[] = []
    for (const { productSlug, rows } of buckets) {
      const inferredCmf =
        args.cmfCode ??
        rows
          .map((r: CmfSkuRow) => r.cmfCode)
          .find((c: string | undefined) => Boolean(c)) ??
        null
      const ctx: PacketWriteContext = {
        ownerId: args.ownerId,
        importId: args.importId ?? null,
        productSlug,
        inferredCmf,
        product: getCmfProduct(productSlug),
      }
      const existing = await findExistingPacketForMerge(tx, productSlug, inferredCmf, rows)
      if (existing) {
        out.push(await mergeRowsIntoPacket(tx, existing, rows, ctx))
      } else {
        const packetName = resolvePacketName(rows, productSlug, args.packetName)
        out.push(
          await createPacketWithRenders(tx, rows, packetName, args.notes ?? null, ctx)
        )
      }
    }
    return { packets: out }
  })
}

/**
 * Load a packet for any authenticated caller. Under the global-library
 * model the caller doesn't need to be the owner or a member — every
 * teammate sees every packet — so the only check is "does this packet
 * exist?". Mutating routes layer `requireCmfWrite` on top.
 */
export async function findAccessiblePacket(packetId: string, _userId: string) {
  return prisma.cmfPacket.findUnique({
    where: { id: packetId },
    include: {
      renders: {
        orderBy: { sortOrder: 'asc' },
        include: {
          // Newest attempts first so the gallery defaults to the latest
          // attempt while still letting designers see history.
          renderAttempts: {
            orderBy: { attemptNumber: 'desc' },
          },
        },
      },
    },
  })
}

/**
 * List every packet in the workspace, sorted by recency. The library is
 * a single ground-truth visible to every authenticated profile.
 *
 * Each packet carries a derived `role`:
 *   - `'owner'` when the caller imported the packet (used by the activity
 *     drawer to label "you created this")
 *   - `'editor'` when the caller has CMF write access (admin OR
 *     `cmfAccess` flag)
 *   - `'viewer'` for everyone else — they can browse but UI surfaces
 *     should hide write affordances.
 */
export async function listAccessiblePackets(userId: string) {
  const [packets, profile] = await Promise.all([
    prisma.cmfPacket.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        renders: {
          // Wider per-render projection than the original "global
          // library list" needed because the Products dialog now
          // shows per-SKU specs in the Workbook tab. The extra
          // JSONB fields (componentSpecs, paletteSwatches) add
          // ~200KB across the full catalog at current size — fine
          // since react-query caches the response for 15s and the
          // alternative was N+1 packet detail fetches when the
          // dialog opens.
          select: {
            id: true,
            label: true,
            status: true,
            renderUrl: true,
            colorwayName: true,
            productSlug: true,
            variantSlug: true,
            productCode: true,
            ean: true,
            componentSpecs: true,
            paletteSwatches: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    }),
    prisma.profile.findUnique({
      where: { id: userId },
      select: { role: true, cmfAccess: true },
    }),
  ])

  return packets.map((p) => ({
    ...p,
    role: deriveEffectivePacketRole({
      packetOwnerId: p.ownerId,
      callerUserId: userId,
      callerProfile: profile,
    }),
  }))
}

/* ─── Activity log ──────────────────────────────────────────────────────── */

export type CmfActivityAction =
  | 'created_packet'
  | 'imported_workbook'
  | 'edited_sku'
  | 'rendered_sku'
  | 'render_failed'
  | 'pdf_generated'
  | 'pdf_failed'
  | 'commented'
  | 'comment_resolved'
  | 'invited_member'
  | 'role_changed'
  | 'removed_member'
  | 'attempt_approved'
  | 'attempt_archived'
  | 'attempt_restored'
  | 'document_draft_saved'
  // Smart-import actions: emitted when a re-upload merges into an
  // existing (productSlug, cmfCode) packet rather than creating a
  // duplicate. The activity drawer renders these with before/after
  // diffs so a designer can see exactly what changed in a SKU.
  | 'sku_added'
  | 'sku_updated'
  | 'packet_merged'
  // Iterative refinement (added 2026-05-13). Distinguishes a
  // designer-driven correction ("make black more holographic" →
  // new attempt) from a fresh dice-roll attempt. The metadata
  // carries `parentAttemptId` + a truncated `refinementPrompt`
  // so the timeline reads as a conversation.
  | 'attempt_refined'
  // Destructive / additive operations that previously slipped past
  // the activity timeline. Packet deletion is intentionally NOT in
  // this list — the activity rows cascade-delete with the packet,
  // so a "deleted_packet" event would vanish the moment it landed.
  // Clown uploads are also out: the clown library is a global
  // surface with no parent packet to anchor the activity row to.
  | 'deleted_render'
  | 'deleted_comment'
  | 'comment_edited'
  | 'uploaded_references'

/**
 * Append an activity row. Designed to be best-effort — never block the
 * primary action on failure to log.
 */
export async function logCmfActivity(args: {
  packetId: string
  userId: string
  action: CmfActivityAction
  targetId?: string | null
  metadata?: Record<string, unknown>
}) {
  try {
    await prisma.cmfActivity.create({
      data: {
        packetId: args.packetId,
        userId: args.userId,
        action: args.action,
        targetId: args.targetId ?? null,
        metadata: args.metadata ? (args.metadata as object) : undefined,
      },
    })
  } catch (err) {
    console.warn('[cmf/activity] failed to log activity', err)
  }
}
