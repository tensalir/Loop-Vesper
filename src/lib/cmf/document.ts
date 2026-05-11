/**
 * CMF document model — the bridge between approved attempts, the HTML
 * preview, and the PDF exporter.
 *
 * The skill's `references/document-template.md` carries the LOCK rules.
 * This module is the type-safe surface where those rules live in code:
 *
 *  - The 16:9 page geometry is fixed (1280×720 PDF coordinates).
 *  - Banner identity, spec table, palette, footer slots are static.
 *  - A small set of editable overrides lives on the packet's
 *    `documentDraft` JSON column — labels, ordering, palette additions,
 *    packet-level notes — so designers can tweak in preview without
 *    touching the workbook source of truth.
 *
 * Everything else (component specs, materials, finishes, Pantone tokens)
 * is read-only here. To change those, edit the workbook and re-import.
 */

import { z } from 'zod'
import type { CmfPacket, CmfRender, CmfRenderAttempt } from '@prisma/client'
import { PaletteSwatchSchema, type ComponentSpec, type PaletteSwatch } from './schema'
import { getCmfProduct } from './products'

/* ── Page geometry (LOCK) ────────────────────────────────────────────────── */

export const PAGE_W = 1280
export const PAGE_H = 720
export const MARGIN = 48
export const BANNER_H = 80
export const FOOTER_H = 110

/* ── Editable draft schema ───────────────────────────────────────────────── */

export const SkuOverrideSchema = z.object({
  renderId: z.string().uuid(),
  /** Override the colourway label printed in the banner. */
  colorwayLabel: z.string().trim().max(160).optional(),
  /** Override the SKU subtitle (under colourway). */
  subtitle: z.string().trim().max(240).optional(),
  /** Additional notes to show under the spec table. */
  notes: z.string().trim().max(2000).optional(),
  /**
   * "approved" → use the SKU's approved attempt (default).
   * "draft"    → show `draftAttemptId` instead, regardless of approval.
   * Designers occasionally want to preview a non-approved attempt before
   * committing to approval. Exports that fall through with a draft override
   * receive a DRAFT watermark.
   */
  imageSource: z.enum(['approved', 'draft']).default('approved').optional(),
  draftAttemptId: z.string().uuid().nullable().optional(),
})

export type SkuOverride = z.infer<typeof SkuOverrideSchema>

export const CmfDocumentDraftSchema = z.object({
  /** Override packet display name in the banner. */
  packetName: z.string().trim().max(160).optional(),
  /** Override CMF code printed top-left. */
  cmfCode: z.string().trim().max(80).optional(),
  /** Override packet notes shown in the footer. */
  notes: z.string().trim().max(2000).optional(),
  /** Display order of SKUs by renderId. SKUs missing from the array fall to the end in `sortOrder`. */
  order: z.array(z.string().uuid()).max(100).optional(),
  /** Per-SKU overrides (label, notes, draft attempt). */
  skuOverrides: z.array(SkuOverrideSchema).max(100).optional(),
  /** Additional palette swatches the designer adds (alongside component-derived ones). */
  paletteOverrides: z.array(PaletteSwatchSchema).max(40).optional(),
})

export type CmfDocumentDraft = z.infer<typeof CmfDocumentDraftSchema>

/* ── Resolved document model (consumed by HTML preview + PDF) ───────────── */

export interface ResolvedDocument {
  packetId: string
  cmfCode: string
  packetName: string
  notes: string | null
  generatedAt: Date
  pages: ResolvedSkuPage[]
  paletteOverrides: PaletteSwatch[]
  isDraft: boolean
}

export interface ResolvedSkuPage {
  renderId: string
  productSlug: string
  productName: string
  colorwayLabel: string
  subtitle: string | null
  productCode: string | null
  ean: string | null
  notes: string | null
  components: ComponentSpec[]
  palette: PaletteSwatch[]
  imageUrl: string | null
  imageWidth: number | null
  imageHeight: number | null
  /** True when the page shows a non-approved attempt (DRAFT watermark). */
  isDraft: boolean
  /** True when the SKU has no approved attempt and no draft override. */
  isPlaceholder: boolean
}

export interface PacketForDocument {
  id: string
  name: string
  cmfCode: string | null
  notes: string | null
  generatedAt: Date | null
  documentDraft: unknown
  renders: Array<CmfRender & { renderAttempts: CmfRenderAttempt[] }>
}

/**
 * Materialise the document model from a packet + its renders + their
 * attempts. The same function feeds the HTML preview component and the
 * server-side PDF generator, so the two surfaces never drift.
 */
export function resolveCmfDocument(packet: PacketForDocument): ResolvedDocument {
  const draft = parseDocumentDraft(packet.documentDraft)
  const overrideByRender = new Map<string, SkuOverride>()
  for (const o of draft.skuOverrides ?? []) {
    overrideByRender.set(o.renderId, o)
  }

  const ordered = orderRenders(packet.renders, draft.order)

  const pages = ordered.map((render) =>
    resolveSkuPage(render, overrideByRender.get(render.id))
  )

  return {
    packetId: packet.id,
    cmfCode: draft.cmfCode ?? packet.cmfCode ?? 'CMF-DRAFT',
    packetName: draft.packetName ?? packet.name,
    notes: draft.notes ?? packet.notes ?? null,
    generatedAt: packet.generatedAt ?? new Date(),
    pages,
    paletteOverrides: draft.paletteOverrides ?? [],
    isDraft: pages.some((p) => p.isDraft),
  }
}

function resolveSkuPage(
  render: CmfRender & { renderAttempts: CmfRenderAttempt[] },
  override: SkuOverride | undefined
): ResolvedSkuPage {
  const components = (render.componentSpecs as unknown as ComponentSpec[]) ?? []
  const palette = (render.paletteSwatches as unknown as PaletteSwatch[]) ?? []
  const product = getCmfProduct(render.productSlug)

  // Image selection: approved attempt by default, draft override if set.
  let image: CmfRenderAttempt | null = null
  let isDraft = false
  if (override?.imageSource === 'draft' && override.draftAttemptId) {
    image =
      render.renderAttempts.find((a) => a.id === override.draftAttemptId) ?? null
    isDraft = !!image && image.approvalStatus !== 'approved'
  } else {
    image =
      render.renderAttempts.find((a) => a.approvalStatus === 'approved') ?? null
    // If no approval, fall back to the most-recent ready attempt so the
    // preview still has something to show — but mark it draft so export
    // gates correctly.
    if (!image) {
      image =
        render.renderAttempts
          .filter((a) => a.status === 'ready' && a.approvalStatus !== 'archived')
          .sort(
            (a, b) =>
              (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
          )[0] ?? null
      isDraft = !!image
    }
  }

  return {
    renderId: render.id,
    productSlug: render.productSlug,
    productName: product?.name ?? render.productSlug,
    colorwayLabel:
      override?.colorwayLabel ??
      render.colorwayName ??
      render.label,
    subtitle: override?.subtitle ?? null,
    productCode: render.productCode ?? null,
    ean: render.ean ?? null,
    notes: override?.notes ?? null,
    components,
    palette,
    imageUrl: image?.imageUrl ?? render.renderUrl ?? null,
    imageWidth: image?.imageWidth ?? render.renderWidth ?? null,
    imageHeight: image?.imageHeight ?? render.renderHeight ?? null,
    isDraft,
    isPlaceholder: !image && !render.renderUrl,
  }
}

function orderRenders<R extends { id: string; sortOrder: number }>(
  renders: R[],
  order: string[] | undefined
): R[] {
  if (!order || order.length === 0) {
    return [...renders].sort((a, b) => a.sortOrder - b.sortOrder)
  }
  const index = new Map<string, number>()
  order.forEach((id, i) => index.set(id, i))
  return [...renders].sort((a, b) => {
    const ai = index.has(a.id) ? index.get(a.id)! : 1000 + a.sortOrder
    const bi = index.has(b.id) ? index.get(b.id)! : 1000 + b.sortOrder
    return ai - bi
  })
}

export function parseDocumentDraft(value: unknown): CmfDocumentDraft {
  if (!value || typeof value !== 'object') return {}
  const parsed = CmfDocumentDraftSchema.safeParse(value)
  return parsed.success ? parsed.data : {}
}

/**
 * Returns true when every page has an approved attempt and the document is
 * safe to export as a clean (non-draft) PDF. The route handler should refuse
 * export when this returns false, unless the caller explicitly opts in.
 */
export function isDocumentReadyForExport(doc: ResolvedDocument): boolean {
  return doc.pages.every((p) => !p.isPlaceholder && !p.isDraft)
}

/**
 * Render-level helper exposed to the workspace UI so it can grey out the
 * export action without rebuilding the entire document.
 */
export function summarisePacketReadiness(packet: PacketForDocument): {
  total: number
  approved: number
  draftOnly: number
  missing: number
} {
  let approved = 0
  let draftOnly = 0
  let missing = 0
  for (const render of packet.renders) {
    const hasApproved = render.renderAttempts.some((a) => a.approvalStatus === 'approved')
    if (hasApproved) {
      approved += 1
      continue
    }
    const hasReady = render.renderAttempts.some((a) => a.status === 'ready' && a.approvalStatus !== 'archived')
    if (hasReady) {
      draftOnly += 1
    } else {
      missing += 1
    }
  }
  return { total: packet.renders.length, approved, draftOnly, missing }
}
