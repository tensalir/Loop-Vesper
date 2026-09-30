/**
 * CMF packet PDF builder (server-side, pdf-lib, no Node-only deps).
 *
 * The layout mirrors Damien's source template (Loop CMF deck). Each SKU
 * produces one render/spec page, and the packet closes with a single shared
 * part-breakdown page, so the exported PDF drops straight into the existing
 * approval / spec workflow without the team having to re-author it.
 *
 * Geometry: A4 portrait (595 × 842 pt). The previous landscape 16:9 layout
 * was rebuilding the document instead of preserving Damien's template, so
 * approved exports lost their familiar shape. We preserve the template
 * structure here:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  CMF number  │  Collection   │  Product name                │
 *   │  Product code│  EAN code     │  Edit date                   │
 *   │  Drawn       │  Checked      │  Checked                     │
 *   ├─────────────────────────────────────────────────────────────┤
 *   │                                       CMF Page 1            │
 *   │  Product render                                              │
 *   │  ┌─────────────────────────────────┐                         │
 *   │  │                                 │                         │
 *   │  │      generated render image      │   Component spec list  │
 *   │  │                                 │                         │
 *   │  └─────────────────────────────────┘                         │
 *   │                                                              │
 *   │  POM RING                                                    │
 *   │    Material   POM                                            │
 *   │    Finish     Matte                                          │
 *   │    Colour     Pantone 7720C                                  │
 *   │    Artwork    —                                              │
 *   │  …                                                           │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The final page is the part breakdown: clown reference render + colour
 * legend on top, then the breakdown grid (component label + legend-matched
 * swatch per cell). It applies to every SKU of the product, so it appears
 * exactly once at the end of the packet (Damien, 2026-07-06: no per-SKU
 * repeats, no pack-overview page, no Pantone on the breakdown).
 *
 * Why pdf-lib: pure JS, no Node addons, safe in Vercel Edge/Node runtimes.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { CmfRender } from '@prisma/client'
import { resolveSwatchHex, type SwatchContext } from './clown-legend'
import { getCmfProduct } from './products'
import type { ComponentSpec, PaletteSwatch } from './schema'
import { fetchStored } from '@/lib/storage/access'

// A4 portrait, matching Damien's source deck. Page-size constants live here
// rather than imported from `document.ts` because that module still describes
// the (legacy) 16:9 HTML preview; the PDF is the canonical surface for the
// designer-facing template and must own its own geometry.
const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 36
const HEADER_H = 96
const FOOTER_H = 44

const COLOURS = {
  ink: rgb(0.07, 0.07, 0.08),
  muted: rgb(0.42, 0.42, 0.48),
  faint: rgb(0.86, 0.86, 0.9),
  hairline: rgb(0.72, 0.72, 0.78),
  primary: rgb(0.36, 0.24, 0.74),
  swatchBorder: rgb(0.78, 0.78, 0.82),
  headerBg: rgb(0.97, 0.96, 0.93),
  panelBg: rgb(0.97, 0.97, 0.98),
  draft: rgb(0.95, 0.62, 0.18),
}

interface PdfFontPair {
  regular: PDFFont
  bold: PDFFont
  mono: PDFFont
}

function hexToRgb01(hex?: string | null) {
  if (!hex) return null
  const cleaned = hex.replace('#', '').trim()
  if (cleaned.length !== 6) return null
  const num = parseInt(cleaned, 16)
  if (Number.isNaN(num)) return null
  return rgb(((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255)
}

function swatchContextForRender(render: RenderProjection): SwatchContext {
  const product = getCmfProduct(render.productSlug)
  return {
    hasClown: !!render.clown,
    clownComponents: render.clown?.components ?? null,
    productSlug: render.productSlug,
    catalogRegions: product?.components.map((c) => c.region),
  }
}

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetchStored(url)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

async function embedRenderImage(pdf: PDFDocument, url: string | null) {
  if (!url) return null
  const bytes = await fetchImageBytes(url)
  if (!bytes) return null
  try {
    return await pdf.embedPng(bytes)
  } catch {
    try {
      return await pdf.embedJpg(bytes)
    } catch {
      return null
    }
  }
}

interface DrawTextArgs {
  page: PDFPage
  text: string
  x: number
  y: number
  size: number
  font: PDFFont
  color?: ReturnType<typeof rgb>
  maxWidth?: number
}

function drawWrappedText({
  page,
  text,
  x,
  y,
  size,
  font,
  color = COLOURS.ink,
  maxWidth,
}: DrawTextArgs): number {
  if (!text) return y
  if (!maxWidth) {
    page.drawText(text, { x, y, size, font, color })
    return y - size * 1.2
  }
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    const width = font.widthOfTextAtSize(candidate, size)
    if (width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  let cursor = y
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, size, font, color })
    cursor -= size * 1.25
  }
  return cursor
}

/**
 * Meta-header cells sit on a fixed ~25pt row grid, so a value must never
 * wrap — pdf-lib's `maxWidth` wrapping is what let long "Product name ·
 * colourway" strings spill onto the Edit date row below them. Fit on a
 * single line instead: shrink from 9pt down to 6.5pt, then ellipsis-truncate
 * as a last resort. Exported for tests.
 */
export function fitHeaderValue(
  text: string,
  font: PDFFont,
  maxWidth: number
): { text: string; size: number } {
  const MAX_SIZE = 9
  const MIN_SIZE = 6.5
  for (let size = MAX_SIZE; size >= MIN_SIZE; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size }
  }
  let truncated = text
  while (
    truncated.length > 1 &&
    font.widthOfTextAtSize(`${truncated.trimEnd()}…`, MIN_SIZE) > maxWidth
  ) {
    truncated = truncated.slice(0, -1)
  }
  return { text: `${truncated.trimEnd()}…`, size: MIN_SIZE }
}

/* ── Source-template meta header (3×3 grid) ─────────────────────────────── */

interface MetaField {
  label: string
  value: string
}

interface DrawHeaderArgs {
  page: PDFPage
  fonts: PdfFontPair
  fields: MetaField[]
  pageLabel: string
  showDraftBadge?: boolean
}

/**
 * Damien's template uses a top strip with nine identity fields arranged in
 * a 3×3 grid (CMF number / Collection / Product name on top, then Product
 * code / EAN / Edit date, then Drawn / Checked / Checked). We keep that
 * shape so reviewers can scan it the same way they do in the source deck.
 */
function drawSourceHeader({ page, fonts, fields, pageLabel, showDraftBadge }: DrawHeaderArgs) {
  // Background band
  page.drawRectangle({
    x: 0,
    y: PAGE_H - HEADER_H,
    width: PAGE_W,
    height: HEADER_H,
    color: COLOURS.headerBg,
  })
  page.drawRectangle({
    x: 0,
    y: PAGE_H - HEADER_H - 1,
    width: PAGE_W,
    height: 1,
    color: COLOURS.hairline,
  })

  const gridX = MARGIN
  const gridY = PAGE_H - 18
  const cellW = (PAGE_W - MARGIN * 2) / 3
  const rowH = (HEADER_H - 20) / 3

  // Pad to exactly 9 cells so an under-filled packet still renders the grid
  // (empty values land as em-dashes).
  const padded = fields.slice(0, 9)
  while (padded.length < 9) padded.push({ label: '', value: '' })

  for (let i = 0; i < 9; i++) {
    const row = Math.floor(i / 3)
    const col = i % 3
    const x = gridX + col * cellW
    const y = gridY - row * rowH

    const cell = padded[i]
    if (cell.label) {
      page.drawText(cell.label.toUpperCase(), {
        x,
        y,
        size: 6,
        font: fonts.bold,
        color: COLOURS.muted,
      })
    }
    if (cell.label || cell.value) {
      const fitted = fitHeaderValue(cell.value || '—', fonts.regular, cellW - 8)
      page.drawText(fitted.text, {
        x,
        y: y - 10,
        size: fitted.size,
        font: fonts.regular,
        color: COLOURS.ink,
      })
    }
  }

  // Page label (right-aligned, primary colour — "CMF Page 1" / "Part Break
  // Down" in Damien's deck).
  const labelWidth = fonts.bold.widthOfTextAtSize(pageLabel, 11)
  page.drawText(pageLabel, {
    x: PAGE_W - MARGIN - labelWidth,
    y: PAGE_H - HEADER_H + 8,
    size: 11,
    font: fonts.bold,
    color: COLOURS.primary,
  })

  if (showDraftBadge) {
    const draftText = 'DRAFT'
    const draftWidth = fonts.bold.widthOfTextAtSize(draftText, 9)
    page.drawRectangle({
      x: PAGE_W - MARGIN - labelWidth - draftWidth - 14,
      y: PAGE_H - HEADER_H + 5,
      width: draftWidth + 10,
      height: 16,
      color: COLOURS.draft,
    })
    page.drawText(draftText, {
      x: PAGE_W - MARGIN - labelWidth - draftWidth - 9,
      y: PAGE_H - HEADER_H + 8,
      size: 9,
      font: fonts.bold,
      color: rgb(1, 1, 1),
    })
  }
}

function metaFieldsForRender(args: {
  cmfCode: string
  packetName: string
  productLabel: string
  productCode: string | null
  ean: string | null
  generatedAt: Date
  drawn?: string | null
}): MetaField[] {
  return [
    { label: 'CMF number', value: args.cmfCode },
    { label: 'Collection', value: args.packetName },
    { label: 'Product name', value: args.productLabel },
    { label: 'Product code', value: args.productCode ?? '—' },
    { label: 'EAN code', value: args.ean ?? '—' },
    { label: 'Edit date', value: args.generatedAt.toISOString().slice(0, 10) },
    { label: 'Drawn', value: args.drawn ?? '' },
    { label: 'Checked', value: '' },
    { label: 'Checked', value: '' },
  ]
}

/* ── Per-component vertical spec list (Damien's "Material / Finish /
 *    Colour / Artwork" stack per component) ────────────────────────────── */

function drawComponentSpecList(args: {
  page: PDFPage
  fonts: PdfFontPair
  components: ComponentSpec[]
  swatchContext: SwatchContext
  x: number
  y: number
  width: number
}): number {
  const { page, fonts, components, swatchContext, x, width } = args
  let cursor = args.y

  for (const comp of components) {
    if (cursor < FOOTER_H + 50) break

    const swatch = hexToRgb01(resolveSwatchHex(comp, swatchContext))
    if (swatch) {
      page.drawRectangle({
        x,
        y: cursor - 1,
        width: 10,
        height: 10,
        color: swatch,
        borderColor: COLOURS.swatchBorder,
        borderWidth: 0.5,
      })
    }
    page.drawText(comp.label.toUpperCase(), {
      x: x + (swatch ? 16 : 0),
      y: cursor,
      size: 9,
      font: fonts.bold,
      color: COLOURS.ink,
      maxWidth: width - (swatch ? 16 : 0),
    })
    cursor -= 14

    const rows: Array<[string, string]> = [
      ['Material', comp.material ?? '—'],
      ['Finish', comp.finish ?? '—'],
      ['Colour', comp.pantone ?? comp.colorHex ?? '—'],
      ['Artwork', comp.technique ?? comp.notes ?? '—'],
    ]
    for (const [k, v] of rows) {
      page.drawText(k, {
        x: x + 10,
        y: cursor,
        size: 8,
        font: fonts.regular,
        color: COLOURS.muted,
      })
      drawWrappedText({
        page,
        text: v,
        x: x + 70,
        y: cursor,
        size: 8,
        font: fonts.regular,
        color: COLOURS.ink,
        maxWidth: width - 80,
      })
      cursor -= 11
    }
    cursor -= 6 // gap between components
  }

  return cursor
}

function drawFooter(args: {
  page: PDFPage
  fonts: PdfFontPair
  pageIndex: number
  totalPages: number
  notes?: string | null
}) {
  const { page, fonts, pageIndex, totalPages, notes } = args
  page.drawRectangle({
    x: 0,
    y: FOOTER_H - 1,
    width: PAGE_W,
    height: 1,
    color: COLOURS.faint,
  })

  if (notes) {
    drawWrappedText({
      page,
      text: notes,
      x: MARGIN,
      y: FOOTER_H - 14,
      size: 7,
      font: fonts.regular,
      color: COLOURS.muted,
      maxWidth: PAGE_W - MARGIN * 2 - 80,
    })
  }

  const pageLabel = `-- ${pageIndex} of ${totalPages} --`
  const w = fonts.mono.widthOfTextAtSize(pageLabel, 8)
  page.drawText(pageLabel, {
    x: PAGE_W - MARGIN - w,
    y: FOOTER_H - 18,
    size: 8,
    font: fonts.mono,
    color: COLOURS.muted,
  })
}

/* ── Page 1 (CMF spec + product render) ─────────────────────────────────── */

interface SkuPageArgs {
  pdf: PDFDocument
  fonts: PdfFontPair
  render: RenderProjection
  meta: MetaField[]
  pageIndex: number
  totalPages: number
  packetNotes: string | null
  isDraft: boolean
}

interface RenderProjection {
  id: string
  label: string
  colorwayName: string | null
  productSlug: string
  productCode: string | null
  ean: string | null
  componentSpecs: unknown
  paletteSwatches: unknown
  renderUrl: string | null
  enhancedPrompt: string | null
  status: string
  /** Resolved clown reference for this SKU — image + legend on the final
   * part-breakdown page. */
  clown?: ClownProjection | null
}

export interface ClownProjection {
  imageUrl: string
  label: string
  /** Per-region colour metadata, used for the legend on the clown page. */
  components: Array<{ region: string; label: string; colorHex?: string | null }>
}

async function drawProductRenderPage(args: SkuPageArgs) {
  const { pdf, fonts, render, meta, pageIndex, totalPages, packetNotes, isDraft } = args
  const page = pdf.addPage([PAGE_W, PAGE_H])

  drawSourceHeader({
    page,
    fonts,
    fields: meta,
    pageLabel: 'CMF Page 1',
    showDraftBadge: isDraft,
  })

  // "Product render" section title
  const sectionY = PAGE_H - HEADER_H - 20
  page.drawText('Product render', {
    x: MARGIN,
    y: sectionY,
    size: 11,
    font: fonts.bold,
    color: COLOURS.ink,
  })

  // Hero plate for the render image (left two-thirds, ~50% of page height
  // so the spec list always has room below it).
  const imageBoxX = MARGIN
  const imageBoxW = PAGE_W - MARGIN * 2
  const imageBoxH = (PAGE_H - HEADER_H - FOOTER_H) * 0.45
  const imageBoxY = sectionY - 12 - imageBoxH

  page.drawRectangle({
    x: imageBoxX,
    y: imageBoxY,
    width: imageBoxW,
    height: imageBoxH,
    color: COLOURS.panelBg,
    borderColor: COLOURS.faint,
    borderWidth: 0.5,
  })

  const embedded = await embedRenderImage(pdf, render.renderUrl)
  if (embedded) {
    const aspect = embedded.width / embedded.height
    let drawW = imageBoxW - 16
    let drawH = drawW / aspect
    if (drawH > imageBoxH - 16) {
      drawH = imageBoxH - 16
      drawW = drawH * aspect
    }
    page.drawImage(embedded, {
      x: imageBoxX + (imageBoxW - drawW) / 2,
      y: imageBoxY + (imageBoxH - drawH) / 2,
      width: drawW,
      height: drawH,
    })
  } else {
    const placeholder =
      render.status === 'ready' ? 'Render not available' : 'Render not generated yet'
    const w = fonts.regular.widthOfTextAtSize(placeholder, 10)
    page.drawText(placeholder, {
      x: imageBoxX + (imageBoxW - w) / 2,
      y: imageBoxY + imageBoxH / 2,
      size: 10,
      font: fonts.regular,
      color: COLOURS.muted,
    })
  }

  // Component spec list (vertical stack, one block per component) below the
  // render plate. Damien's template keeps Material / Finish / Colour /
  // Artwork in a labelled key/value column so the factory sheet stays
  // readable when printed.
  const components = (render.componentSpecs as ComponentSpec[] | undefined) ?? []
  drawComponentSpecList({
    page,
    fonts,
    components,
    swatchContext: swatchContextForRender(render),
    x: MARGIN,
    y: imageBoxY - 18,
    width: PAGE_W - MARGIN * 2,
  })

  drawFooter({ page, fonts, pageIndex, totalPages, notes: packetNotes })
}

/* ── Colour legend (clown region markers) ───────────────────────────────── */

function drawColourLegend(args: {
  page: PDFPage
  fonts: PdfFontPair
  components: ComponentSpec[]
  swatchContext: SwatchContext
  x: number
  y: number
  width: number
  maxHeight: number
}) {
  const { page, fonts, components, swatchContext, x, y, width, maxHeight } = args
  page.drawText('Colour legend', {
    x,
    y,
    size: 8,
    font: fonts.bold,
    color: COLOURS.muted,
  })

  const entries = components
    .map((comp) => ({
      region: comp.region,
      label: comp.label,
      colorHex: resolveSwatchHex(comp, swatchContext),
    }))
    .filter((e) => e.colorHex)

  if (entries.length === 0) {
    page.drawText('No legend colours resolved for this SKU.', {
      x,
      y: y - 14,
      size: 9,
      font: fonts.regular,
      color: COLOURS.muted,
      maxWidth: width,
    })
    return
  }

  const cols = 2
  const colW = (width - 12 * (cols - 1)) / cols
  const rowH = 16
  let legendBottom = y - 14

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const lx = x + col * (colW + 12)
    const ly = y - 14 - row * rowH
    if (ly - rowH < y - maxHeight) break

    const swatch = hexToRgb01(entry.colorHex ?? null)
    page.drawRectangle({
      x: lx,
      y: ly - 9,
      width: 12,
      height: 12,
      color: swatch ?? rgb(0.92, 0.92, 0.94),
      borderColor: COLOURS.swatchBorder,
      borderWidth: 0.5,
    })
    page.drawText(entry.label, {
      x: lx + 18,
      y: ly,
      size: 9,
      font: fonts.regular,
      color: COLOURS.ink,
      maxWidth: colW - 24,
    })
    legendBottom = ly - rowH
  }
  return legendBottom
}

/* ── Final page (Clown reference + part break down, once per product) ───── */

/**
 * Damien's reference deck keeps the clown render, colour legend, and part
 * breakdown on one page so reviewers can map painted regions to components
 * without flipping back. The clown image sits top-left; legend top-right;
 * the 2-column breakdown grid fills the lower band.
 *
 * The page describes the product's parts — not a colourway — so it is drawn
 * once at the end of the packet and carries no per-SKU colour data: no
 * Pantone rows, and region swatches only when a clown legend anchors them.
 */
async function drawPartBreakdownPage(args: SkuPageArgs) {
  const { pdf, fonts, render, meta, pageIndex, totalPages, packetNotes, isDraft } = args
  const page = pdf.addPage([PAGE_W, PAGE_H])

  drawSourceHeader({
    page,
    fonts,
    fields: meta,
    pageLabel: 'Part Break Down',
    showDraftBadge: isDraft,
  })

  const sectionY = PAGE_H - HEADER_H - 20
  page.drawText('Part break down', {
    x: MARGIN,
    y: sectionY,
    size: 11,
    font: fonts.bold,
    color: COLOURS.ink,
  })

  const components = (render.componentSpecs as ComponentSpec[] | undefined) ?? []
  const clown = render.clown ?? null
  const swatchCtx = swatchContextForRender(render)
  const bodyH = PAGE_H - HEADER_H - FOOTER_H
  let gridY = sectionY - 18

  if (clown) {
    page.drawText(clown.label, {
      x: MARGIN,
      y: sectionY - 14,
      size: 8,
      font: fonts.mono,
      color: COLOURS.muted,
      maxWidth: PAGE_W - MARGIN * 2,
    })

    const clownBandH = bodyH * 0.32
    const bandTop = sectionY - 28
    const bandBottom = bandTop - clownBandH
    const imageW = (PAGE_W - MARGIN * 2) * 0.55
    const legendX = MARGIN + imageW + 16
    const legendW = PAGE_W - MARGIN - legendX

    page.drawRectangle({
      x: MARGIN,
      y: bandBottom,
      width: imageW,
      height: clownBandH,
      color: COLOURS.panelBg,
      borderColor: COLOURS.faint,
      borderWidth: 0.5,
    })

    const embedded = await embedRenderImage(pdf, clown.imageUrl)
    if (embedded) {
      const aspect = embedded.width / embedded.height
      let drawW = imageW - 12
      let drawH = drawW / aspect
      if (drawH > clownBandH - 12) {
        drawH = clownBandH - 12
        drawW = drawH * aspect
      }
      page.drawImage(embedded, {
        x: MARGIN + (imageW - drawW) / 2,
        y: bandBottom + (clownBandH - drawH) / 2,
        width: drawW,
        height: drawH,
      })
    } else {
      const placeholder = 'Clown reference image not available'
      const w = fonts.regular.widthOfTextAtSize(placeholder, 9)
      page.drawText(placeholder, {
        x: MARGIN + (imageW - w) / 2,
        y: bandBottom + clownBandH / 2,
        size: 9,
        font: fonts.regular,
        color: COLOURS.muted,
      })
    }

    drawColourLegend({
      page,
      fonts,
      components,
      swatchContext: swatchCtx,
      x: legendX,
      y: bandTop,
      width: legendW,
      maxHeight: clownBandH,
    })

    gridY = bandBottom - 14
  }

  if (components.length === 0) {
    page.drawText('No components recorded for this SKU.', {
      x: MARGIN,
      y: gridY - 24,
      size: 10,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    drawFooter({ page, fonts, pageIndex, totalPages, notes: packetNotes })
    return
  }

  const gridX = MARGIN
  const cols = 2
  const gridW = PAGE_W - MARGIN * 2
  const cellW = (gridW - 16 * (cols - 1)) / cols
  // Label band (32pt) + three 25pt key/value rows + bottom padding.
  const cellH = 112

  for (let i = 0; i < components.length; i++) {
    const comp = components[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = gridX + col * (cellW + 16)
    const y = gridY - row * (cellH + 16)
    const cellBottom = y - cellH

    if (cellBottom < FOOTER_H + 16) break

    page.drawRectangle({
      x,
      y: cellBottom,
      width: cellW,
      height: cellH,
      color: COLOURS.panelBg,
      borderColor: COLOURS.faint,
      borderWidth: 0.5,
    })

    page.drawText(comp.label.toUpperCase(), {
      x: x + 10,
      y: y - 16,
      size: 9,
      font: fonts.bold,
      color: COLOURS.primary,
      maxWidth: cellW - 20,
    })

    // Region swatch only when a clown legend anchors it — without a clown,
    // resolveSwatchHex falls back to the SKU's workbook colour, which would
    // smuggle per-colourway data onto this shared page.
    const swatchSize = 38
    if (clown) {
      const swatch = hexToRgb01(resolveSwatchHex(comp, swatchCtx))
      page.drawRectangle({
        x: x + cellW - swatchSize - 10,
        y: y - swatchSize - 14,
        width: swatchSize,
        height: swatchSize,
        color: swatch ?? rgb(0.92, 0.92, 0.94),
        borderColor: COLOURS.swatchBorder,
        borderWidth: 0.5,
      })
    }

    let textY = y - 32
    // Material and finishing references only — the breakdown applies to all
    // SKUs, so per-colourway Pantone values stay off this page.
    const rows: Array<[string, string]> = [
      ['Material', comp.material ?? '—'],
      ['Finish', comp.finish ?? '—'],
      ['Technique', comp.technique ?? '—'],
    ]
    const textW = clown ? cellW - swatchSize - 30 : cellW - 20
    for (const [k, v] of rows) {
      page.drawText(k.toUpperCase(), {
        x: x + 10,
        y: textY,
        size: 6,
        font: fonts.bold,
        color: COLOURS.muted,
      })
      textY -= 9
      drawWrappedText({
        page,
        text: v,
        x: x + 10,
        y: textY,
        size: 8,
        font: fonts.regular,
        color: COLOURS.ink,
        maxWidth: textW,
      })
      textY -= 16
    }
  }

  drawFooter({ page, fonts, pageIndex, totalPages, notes: packetNotes })
}

/* ── Public ─────────────────────────────────────────────────────────────── */

export interface CmfPagePlanEntry {
  type: 'render' | 'breakdown'
  /** Index into the packet's renders array that feeds this page. */
  renderIndex: number
}

/**
 * Page plan for a packet: one render/spec page per SKU (packet order), then
 * a single shared part-breakdown page per distinct product — normally
 * exactly one. The breakdown is sourced from the product's first render
 * that carries a clown reference (falling back to its first render) so the
 * clown band shows whenever one exists.
 *
 * Pure and exported: pdf-lib cannot read text back out of generated bytes,
 * so tests assert page order on the plan instead.
 */
export function planCmfPages(
  renders: Array<{ productSlug: string; clown?: ClownProjection | null }>
): CmfPagePlanEntry[] {
  const plan: CmfPagePlanEntry[] = renders.map((_, i) => ({
    type: 'render',
    renderIndex: i,
  }))
  const seenProducts: string[] = []
  for (const render of renders) {
    if (!seenProducts.includes(render.productSlug)) seenProducts.push(render.productSlug)
  }
  for (const slug of seenProducts) {
    const withClown = renders.findIndex((r) => r.productSlug === slug && r.clown)
    const first = renders.findIndex((r) => r.productSlug === slug)
    plan.push({ type: 'breakdown', renderIndex: withClown >= 0 ? withClown : first })
  }
  return plan
}

interface BuildPdfArgs {
  packetName: string
  cmfCode: string | null
  notes: string | null
  generatedAt?: Date
  /** Optional designer name to fill the "Drawn:" cell in the meta header. */
  drawnBy?: string | null
  /** When true, every page receives a DRAFT badge so the export is visibly
   * marked as a non-approved deliverable. */
  isDraft?: boolean
  renders: Array<
    Pick<
      CmfRender,
      | 'id'
      | 'label'
      | 'colorwayName'
      | 'productSlug'
      | 'productCode'
      | 'ean'
      | 'componentSpecs'
      | 'paletteSwatches'
      | 'renderUrl'
      | 'enhancedPrompt'
      | 'status'
    > & {
      /** Optional clown reference — image + legend on the final
       * part-breakdown page. */
      clown?: ClownProjection | null
    }
  >
}

export async function buildCmfPacketPdf(args: BuildPdfArgs): Promise<Uint8Array> {
  const generatedAt = args.generatedAt ?? new Date()
  const cmfCode = args.cmfCode ?? 'CMF-DRAFT'
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${cmfCode} · ${args.packetName}`)
  pdf.setProducer('Loop Vesper · CMF Studio')
  pdf.setCreator('Loop Vesper · CMF Studio')

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const courier = await pdf.embedFont(StandardFonts.Courier)
  const fonts: PdfFontPair = { regular: helvetica, bold: helveticaBold, mono: courier }

  // One render page per SKU, then one shared part-breakdown page per
  // distinct product (normally exactly one) at the end of the packet.
  const plan = planCmfPages(args.renders)
  const totalPages = plan.length

  const renderMetaFor = (render: BuildPdfArgs['renders'][number]): MetaField[] => {
    const product = getCmfProduct(render.productSlug)
    const productLabel = render.colorwayName
      ? `${product?.name ?? render.productSlug} · ${render.colorwayName}`
      : product?.name ?? render.label
    return metaFieldsForRender({
      cmfCode,
      packetName: args.packetName,
      productLabel,
      productCode: render.productCode,
      ean: render.ean,
      generatedAt,
      drawn: args.drawnBy ?? null,
    })
  }

  // The shared breakdown page applies to every SKU of the product, so its
  // header drops the colourway and keeps code/EAN only when the whole group
  // agrees on a single value.
  const breakdownMetaFor = (render: BuildPdfArgs['renders'][number]): MetaField[] => {
    const product = getCmfProduct(render.productSlug)
    const group = args.renders.filter((r) => r.productSlug === render.productSlug)
    const shared = (pick: (r: BuildPdfArgs['renders'][number]) => string | null) => {
      const values = new Set(group.map(pick))
      return values.size === 1 ? pick(group[0]) : null
    }
    return metaFieldsForRender({
      cmfCode,
      packetName: args.packetName,
      productLabel: product?.name ?? render.productSlug,
      productCode: shared((r) => r.productCode),
      ean: shared((r) => r.ean),
      generatedAt,
      drawn: args.drawnBy ?? null,
    })
  }

  const projectionFor = (render: BuildPdfArgs['renders'][number]): RenderProjection => ({
    id: render.id,
    label: render.label,
    colorwayName: render.colorwayName,
    productSlug: render.productSlug,
    productCode: render.productCode,
    ean: render.ean,
    componentSpecs: render.componentSpecs,
    paletteSwatches: render.paletteSwatches,
    renderUrl: render.renderUrl,
    enhancedPrompt: render.enhancedPrompt,
    status: render.status,
    clown: render.clown ?? null,
  })

  let pageIndex = 1
  for (const entry of plan) {
    const render = args.renders[entry.renderIndex]
    if (entry.type === 'render') {
      await drawProductRenderPage({
        pdf,
        fonts,
        render: projectionFor(render),
        meta: renderMetaFor(render),
        pageIndex,
        totalPages,
        packetNotes: args.notes,
        isDraft: !!args.isDraft,
      })
    } else {
      await drawPartBreakdownPage({
        pdf,
        fonts,
        render: projectionFor(render),
        meta: breakdownMetaFor(render),
        pageIndex,
        totalPages,
        packetNotes: args.notes,
        isDraft: !!args.isDraft,
      })
    }
    pageIndex += 1
  }

  return pdf.save()
}

/* ── Page geometry exports (consumers that need to mirror layout) ───────── */

export const CMF_PDF_GEOMETRY = {
  PAGE_W,
  PAGE_H,
  HEADER_H,
  FOOTER_H,
  MARGIN,
} as const
