/**
 * CMF packet PDF builder (server-side, pdf-lib, no Node-only deps).
 *
 * The layout mirrors Damien's source template (Loop CMF deck). Each SKU
 * produces two pages so the exported PDF drops straight into the existing
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
 * Page 2 is the part breakdown grid (component label + swatch chip per
 * cell). For multi-SKU packets a final overview page lists every colourway
 * in the pack so reviewers see the family at a glance.
 *
 * Why pdf-lib: pure JS, no Node addons, safe in Vercel Edge/Node runtimes.
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { CmfRender } from '@prisma/client'
import { getCmfProduct } from './products'
import type { ComponentSpec, PaletteSwatch } from './schema'

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

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
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
      page.drawText(cell.value || '—', {
        x,
        y: y - 10,
        size: 9,
        font: fonts.regular,
        color: COLOURS.ink,
        maxWidth: cellW - 8,
      })
    }
  }

  // Page label (right-aligned, primary colour — "CMF Page 1" / "Part Break
  // Down Page 2" / "Pack Overview" in Damien's deck).
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
  x: number
  y: number
  width: number
}): number {
  const { page, fonts, components, x, width } = args
  let cursor = args.y

  for (const comp of components) {
    if (cursor < FOOTER_H + 50) break

    const swatch = hexToRgb01(comp.colorHex ?? null)
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
    x: MARGIN,
    y: imageBoxY - 18,
    width: PAGE_W - MARGIN * 2,
  })

  drawFooter({ page, fonts, pageIndex, totalPages, notes: packetNotes })
}

/* ── Page 2 (Part break down grid) ──────────────────────────────────────── */

async function drawPartBreakdownPage(args: SkuPageArgs) {
  const { pdf, fonts, render, meta, pageIndex, totalPages, packetNotes, isDraft } = args
  const page = pdf.addPage([PAGE_W, PAGE_H])

  drawSourceHeader({
    page,
    fonts,
    fields: meta,
    pageLabel: 'Part Break Down Page 2',
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
  if (components.length === 0) {
    page.drawText('No components recorded for this SKU.', {
      x: MARGIN,
      y: sectionY - 24,
      size: 10,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    drawFooter({ page, fonts, pageIndex, totalPages, notes: packetNotes })
    return
  }

  // 2-column grid; each cell shows component name, swatch, Pantone, material
  // and finish. Two columns keep cells big enough for printing without
  // requiring a designer to squint.
  const gridX = MARGIN
  const gridY = sectionY - 18
  const cols = 2
  const gridW = PAGE_W - MARGIN * 2
  const cellW = (gridW - 16 * (cols - 1)) / cols
  const cellH = 130

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

    // Component name banner
    page.drawText(comp.label.toUpperCase(), {
      x: x + 10,
      y: y - 16,
      size: 9,
      font: fonts.bold,
      color: COLOURS.primary,
      maxWidth: cellW - 20,
    })

    // Swatch block on the right side
    const swatch = hexToRgb01(comp.colorHex ?? null)
    const swatchSize = 38
    page.drawRectangle({
      x: x + cellW - swatchSize - 10,
      y: y - swatchSize - 14,
      width: swatchSize,
      height: swatchSize,
      color: swatch ?? rgb(0.92, 0.92, 0.94),
      borderColor: COLOURS.swatchBorder,
      borderWidth: 0.5,
    })

    // Key/value lines on the left
    let textY = y - 32
    const rows: Array<[string, string]> = [
      ['Pantone', comp.pantone ?? comp.colorHex ?? '—'],
      ['Material', comp.material ?? '—'],
      ['Finish', comp.finish ?? '—'],
      ['Technique', comp.technique ?? '—'],
    ]
    const textW = cellW - swatchSize - 30
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

/* ── Optional pack-overview page (multi-SKU only) ───────────────────────── */

async function drawPackOverviewPage(args: {
  pdf: PDFDocument
  fonts: PdfFontPair
  renders: RenderProjection[]
  baseMeta: MetaField[]
  pageIndex: number
  totalPages: number
  packetName: string
  packetNotes: string | null
  cmfCode: string
  generatedAt: Date
}) {
  const {
    pdf,
    fonts,
    renders,
    baseMeta,
    pageIndex,
    totalPages,
    packetName,
    packetNotes,
    cmfCode,
    generatedAt,
  } = args
  const page = pdf.addPage([PAGE_W, PAGE_H])

  drawSourceHeader({
    page,
    fonts,
    fields: [
      { label: 'CMF number', value: cmfCode },
      { label: 'Collection', value: packetName },
      { label: 'Pack size', value: `${renders.length} SKUs` },
      ...baseMeta.slice(3, 9),
    ],
    pageLabel: 'Pack overview',
  })

  page.drawText('Pack breakdown', {
    x: MARGIN,
    y: PAGE_H - HEADER_H - 20,
    size: 11,
    font: fonts.bold,
    color: COLOURS.ink,
  })

  // SKU cards: colourway title, product slug, mini swatch row.
  const colCount = Math.min(renders.length, 2)
  const gridW = PAGE_W - MARGIN * 2
  const cellW = (gridW - 16 * (colCount - 1)) / colCount
  const cellH = 110
  let cellX = MARGIN
  let cellY = PAGE_H - HEADER_H - 40

  renders.forEach((render, idx) => {
    const components = (render.componentSpecs as ComponentSpec[] | undefined) ?? []
    page.drawRectangle({
      x: cellX,
      y: cellY - cellH,
      width: cellW,
      height: cellH,
      color: COLOURS.panelBg,
      borderColor: COLOURS.faint,
      borderWidth: 0.5,
    })

    page.drawText((render.colorwayName ?? render.label).toUpperCase(), {
      x: cellX + 10,
      y: cellY - 16,
      size: 11,
      font: fonts.bold,
      color: COLOURS.primary,
      maxWidth: cellW - 20,
    })
    page.drawText(render.productSlug, {
      x: cellX + 10,
      y: cellY - 30,
      size: 8,
      font: fonts.mono,
      color: COLOURS.muted,
    })
    if (render.productCode) {
      page.drawText(render.productCode, {
        x: cellX + 10,
        y: cellY - 42,
        size: 7,
        font: fonts.mono,
        color: COLOURS.muted,
      })
    }

    // Mini swatch row
    let swatchX = cellX + 10
    const swatchY = cellY - 70
    for (const comp of components.slice(0, 6)) {
      const colour = hexToRgb01(comp.colorHex ?? null)
      page.drawRectangle({
        x: swatchX,
        y: swatchY,
        width: 18,
        height: 18,
        color: colour ?? rgb(0.92, 0.92, 0.94),
        borderColor: COLOURS.swatchBorder,
        borderWidth: 0.5,
      })
      swatchX += 24
    }

    // Advance grid cursor
    if ((idx + 1) % colCount === 0) {
      cellX = MARGIN
      cellY -= cellH + 16
    } else {
      cellX += cellW + 16
    }
  })

  drawFooter({ page, fonts, pageIndex, totalPages, notes: packetNotes })
}

/* ── Public ─────────────────────────────────────────────────────────────── */

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
  renders: Array<Pick<CmfRender,
    'id' |
    'label' |
    'colorwayName' |
    'productSlug' |
    'productCode' |
    'ean' |
    'componentSpecs' |
    'paletteSwatches' |
    'renderUrl' |
    'enhancedPrompt' |
    'status'
  >>
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

  const includesOverview = args.renders.length > 1
  // 2 pages per SKU + optional overview page when multi-SKU.
  const totalPages = args.renders.length * 2 + (includesOverview ? 1 : 0)

  let pageIndex = 1
  const baseMetaFor = (render: BuildPdfArgs['renders'][number]): MetaField[] => {
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

  for (const render of args.renders) {
    const meta = baseMetaFor(render)
    const projection: RenderProjection = {
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
    }

    await drawProductRenderPage({
      pdf,
      fonts,
      render: projection,
      meta,
      pageIndex,
      totalPages,
      packetNotes: args.notes,
      isDraft: !!args.isDraft,
    })
    pageIndex += 1

    await drawPartBreakdownPage({
      pdf,
      fonts,
      render: projection,
      meta,
      pageIndex,
      totalPages,
      packetNotes: args.notes,
      isDraft: !!args.isDraft,
    })
    pageIndex += 1
  }

  if (includesOverview) {
    await drawPackOverviewPage({
      pdf,
      fonts,
      renders: args.renders.map((render) => ({
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
      })),
      baseMeta: baseMetaFor(args.renders[0]),
      pageIndex,
      totalPages,
      packetName: args.packetName,
      packetNotes: args.notes,
      cmfCode,
      generatedAt,
    })
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
