/**
 * CMF packet PDF builder (server-side, pdf-lib, no Node-only deps).
 *
 * Layout per page (16:9 page geometry, 1280×720 pt) — same proportions as the
 * source PowerPoint deck:
 *   ┌──────────────────────────── BANNER ────────────────────────────┐
 *   │  CMF code · Product · Date         Loop                       │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │                            │                                   │
 *   │   Generated render image   │   Component spec table            │
 *   │   (left half)              │   Region · Pantone · Material    │
 *   │                            │                                   │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │  Palette swatches                              Notes           │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Final page is a shared breakdown summarising every SKU in the packet
 * (palette grid + component matrix). For single-SKU packets the breakdown
 * page is omitted to keep the deliverable compact.
 *
 * Why pdf-lib: pure JS, no Node addons, safe in Vercel Edge/Node runtimes.
 */

import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib'
import type { CmfRender } from '@prisma/client'
import { getCmfProduct } from './products'
import type { ComponentSpec, PaletteSwatch } from './schema'

const PAGE_W = 1280
const PAGE_H = 720
const MARGIN = 48
const BANNER_H = 80
const FOOTER_H = 110

// Loop-ish palette (purple primary in light mode, charcoal text), tuned to
// stay legible on white pages.
const COLOURS = {
  ink: rgb(0.07, 0.07, 0.08),
  muted: rgb(0.42, 0.42, 0.48),
  faint: rgb(0.86, 0.86, 0.9),
  primary: rgb(0.36, 0.24, 0.74),
  swatchBorder: rgb(0.78, 0.78, 0.82),
  bannerBg: rgb(0.96, 0.95, 0.92),
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
  // Try PNG first, fall back to JPG. pdf-lib will throw if the format does not match.
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
  page: ReturnType<PDFDocument['addPage']>
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

interface DrawBannerArgs {
  page: ReturnType<PDFDocument['addPage']>
  fonts: PdfFontPair
  cmfCode: string
  productName: string
  colorwayName: string
  generatedAt: Date
}

function drawBanner({ page, fonts, cmfCode, productName, colorwayName, generatedAt }: DrawBannerArgs) {
  page.drawRectangle({
    x: 0,
    y: PAGE_H - BANNER_H,
    width: PAGE_W,
    height: BANNER_H,
    color: COLOURS.bannerBg,
  })
  page.drawRectangle({
    x: 0,
    y: PAGE_H - BANNER_H - 1,
    width: PAGE_W,
    height: 1,
    color: COLOURS.faint,
  })

  page.drawText(cmfCode, {
    x: MARGIN,
    y: PAGE_H - 38,
    size: 14,
    font: fonts.bold,
    color: COLOURS.ink,
  })
  page.drawText(productName, {
    x: MARGIN,
    y: PAGE_H - 60,
    size: 11,
    font: fonts.regular,
    color: COLOURS.muted,
  })

  const colourwayLabel = colorwayName.toUpperCase()
  const colourwayWidth = fonts.bold.widthOfTextAtSize(colourwayLabel, 16)
  page.drawText(colourwayLabel, {
    x: PAGE_W / 2 - colourwayWidth / 2,
    y: PAGE_H - 45,
    size: 16,
    font: fonts.bold,
    color: COLOURS.primary,
  })

  const dateText = generatedAt.toISOString().slice(0, 10)
  const dateWidth = fonts.mono.widthOfTextAtSize(dateText, 10)
  page.drawText(dateText, {
    x: PAGE_W - MARGIN - dateWidth,
    y: PAGE_H - 38,
    size: 10,
    font: fonts.mono,
    color: COLOURS.muted,
  })

  page.drawText('Loop · CMF', {
    x: PAGE_W - MARGIN - fonts.bold.widthOfTextAtSize('Loop · CMF', 11),
    y: PAGE_H - 60,
    size: 11,
    font: fonts.bold,
    color: COLOURS.ink,
  })
}

function drawComponentTable(args: {
  page: ReturnType<PDFDocument['addPage']>
  fonts: PdfFontPair
  components: ComponentSpec[]
  x: number
  y: number
  width: number
}) {
  const { page, fonts, components, x, y, width } = args
  const headerSize = 9
  const rowSize = 11
  const rowHeight = 22

  const headers = ['Component', 'Pantone / Hex', 'Material', 'Finish', 'Technique']
  const colWidths = [width * 0.22, width * 0.22, width * 0.18, width * 0.18, width * 0.2]

  let cursor = y
  let cx = x
  for (let i = 0; i < headers.length; i++) {
    page.drawText(headers[i].toUpperCase(), {
      x: cx,
      y: cursor,
      size: headerSize,
      font: fonts.bold,
      color: COLOURS.muted,
    })
    cx += colWidths[i]
  }
  cursor -= 8
  page.drawRectangle({
    x,
    y: cursor,
    width,
    height: 1,
    color: COLOURS.faint,
  })
  cursor -= rowHeight - 4

  for (const comp of components) {
    cx = x
    const colour = comp.colorHex || null
    const swatch = colour ? hexToRgb01(colour) : null
    if (swatch) {
      page.drawRectangle({
        x: cx,
        y: cursor - 4,
        width: 12,
        height: 12,
        color: swatch,
        borderColor: COLOURS.swatchBorder,
        borderWidth: 0.5,
      })
    }
    page.drawText(comp.label, {
      x: cx + (swatch ? 18 : 0),
      y: cursor,
      size: rowSize,
      font: fonts.bold,
      color: COLOURS.ink,
    })
    cx += colWidths[0]

    const pantoneText = comp.pantone || comp.colorHex || '—'
    page.drawText(pantoneText.slice(0, 28), {
      x: cx,
      y: cursor,
      size: rowSize,
      font: fonts.mono,
      color: COLOURS.ink,
    })
    cx += colWidths[1]

    page.drawText((comp.material || '—').slice(0, 24), {
      x: cx,
      y: cursor,
      size: rowSize,
      font: fonts.regular,
      color: COLOURS.ink,
    })
    cx += colWidths[2]

    page.drawText((comp.finish || '—').slice(0, 24), {
      x: cx,
      y: cursor,
      size: rowSize,
      font: fonts.regular,
      color: COLOURS.ink,
    })
    cx += colWidths[3]

    page.drawText((comp.technique || '—').slice(0, 28), {
      x: cx,
      y: cursor,
      size: rowSize,
      font: fonts.regular,
      color: COLOURS.muted,
    })

    cursor -= rowHeight
  }
}

function drawPalette(args: {
  page: ReturnType<PDFDocument['addPage']>
  fonts: PdfFontPair
  components: ComponentSpec[]
  palette: PaletteSwatch[]
  x: number
  y: number
  width: number
}) {
  const { page, fonts, components, palette, x, y, width } = args

  page.drawText('Palette'.toUpperCase(), {
    x,
    y,
    size: 9,
    font: fonts.bold,
    color: COLOURS.muted,
  })

  // Combine palette swatches with component-derived colours, dedup by hex.
  const swatches: PaletteSwatch[] = []
  const seen = new Set<string>()
  for (const p of palette) {
    const key = (p.colorHex || p.pantone || p.label || '').toLowerCase()
    if (key && !seen.has(key)) {
      seen.add(key)
      swatches.push(p)
    }
  }
  for (const c of components) {
    const key = (c.colorHex || c.pantone || c.label || '').toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    swatches.push({
      label: c.label,
      pantone: c.pantone ?? undefined,
      colorHex: c.colorHex ?? undefined,
    })
  }

  const swatchSize = 32
  const gap = 16
  const perRow = Math.max(1, Math.floor((width + gap) / (swatchSize * 4 + gap)))
  let cx = x
  let cy = y - swatchSize - 12
  let count = 0
  for (const swatch of swatches) {
    const colour = swatch.colorHex ? hexToRgb01(swatch.colorHex) : null
    page.drawRectangle({
      x: cx,
      y: cy,
      width: swatchSize,
      height: swatchSize,
      color: colour ?? rgb(0.92, 0.92, 0.94),
      borderColor: COLOURS.swatchBorder,
      borderWidth: 0.6,
    })
    page.drawText(swatch.label.slice(0, 18), {
      x: cx + swatchSize + 8,
      y: cy + swatchSize - 12,
      size: 9,
      font: fonts.bold,
      color: COLOURS.ink,
    })
    page.drawText((swatch.pantone || swatch.colorHex || '').slice(0, 22), {
      x: cx + swatchSize + 8,
      y: cy + swatchSize - 24,
      size: 8,
      font: fonts.mono,
      color: COLOURS.muted,
    })

    count += 1
    if (count % perRow === 0) {
      cx = x
      cy -= swatchSize + 14
    } else {
      cx += swatchSize * 4 + gap
    }
  }
}

interface BuildPdfArgs {
  packetName: string
  cmfCode: string | null
  notes: string | null
  generatedAt?: Date
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
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${args.cmfCode ?? 'CMF'} · ${args.packetName}`)
  pdf.setProducer('Loop Vesper · CMF Studio')
  pdf.setCreator('Loop Vesper · CMF Studio')

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica)
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const courier = await pdf.embedFont(StandardFonts.Courier)
  const fonts: PdfFontPair = { regular: helvetica, bold: helveticaBold, mono: courier }

  for (const render of args.renders) {
    const product = getCmfProduct(render.productSlug)
    const components = (render.componentSpecs as unknown as ComponentSpec[]) ?? []
    const palette = (render.paletteSwatches as unknown as PaletteSwatch[]) ?? []

    const page = pdf.addPage([PAGE_W, PAGE_H])
    drawBanner({
      page,
      fonts,
      cmfCode: args.cmfCode ?? render.label.toUpperCase(),
      productName: `${product?.name ?? render.productSlug}${render.productCode ? ` · ${render.productCode}` : ''}`,
      colorwayName: render.colorwayName ?? render.label,
      generatedAt,
    })

    // Render image area on the left half
    const imageBoxX = MARGIN
    const imageBoxY = MARGIN + FOOTER_H + 16
    const imageBoxW = (PAGE_W / 2) - MARGIN - 16
    const imageBoxH = PAGE_H - BANNER_H - imageBoxY - 16

    page.drawRectangle({
      x: imageBoxX,
      y: imageBoxY,
      width: imageBoxW,
      height: imageBoxH,
      color: rgb(0.97, 0.97, 0.98),
      borderColor: COLOURS.faint,
      borderWidth: 1,
    })

    const embedded = await embedRenderImage(pdf, render.renderUrl)
    if (embedded) {
      const aspect = embedded.width / embedded.height
      let drawW = imageBoxW - 24
      let drawH = drawW / aspect
      if (drawH > imageBoxH - 24) {
        drawH = imageBoxH - 24
        drawW = drawH * aspect
      }
      page.drawImage(embedded, {
        x: imageBoxX + (imageBoxW - drawW) / 2,
        y: imageBoxY + (imageBoxH - drawH) / 2,
        width: drawW,
        height: drawH,
      })
    } else {
      const placeholder = render.status === 'ready'
        ? 'Render not available'
        : 'Render not generated yet'
      const w = fonts.regular.widthOfTextAtSize(placeholder, 11)
      page.drawText(placeholder, {
        x: imageBoxX + (imageBoxW - w) / 2,
        y: imageBoxY + imageBoxH / 2,
        size: 11,
        font: fonts.regular,
        color: COLOURS.muted,
      })
    }

    // Right column: spec table
    const tableX = PAGE_W / 2 + 16
    const tableY = PAGE_H - BANNER_H - 48
    const tableW = PAGE_W - tableX - MARGIN

    page.drawText('CMF Spec'.toUpperCase(), {
      x: tableX,
      y: tableY + 22,
      size: 11,
      font: fonts.bold,
      color: COLOURS.primary,
    })
    drawComponentTable({
      page,
      fonts,
      components,
      x: tableX,
      y: tableY,
      width: tableW,
    })

    // Footer: palette on the left, EAN/notes on the right
    drawPalette({
      page,
      fonts,
      components,
      palette,
      x: MARGIN,
      y: MARGIN + FOOTER_H - 10,
      width: PAGE_W / 2 - MARGIN,
    })

    const metaX = PAGE_W / 2 + 16
    const metaY = MARGIN + FOOTER_H - 10
    page.drawText('Identity'.toUpperCase(), {
      x: metaX,
      y: metaY,
      size: 9,
      font: fonts.bold,
      color: COLOURS.muted,
    })
    let metaCursor = metaY - 16
    if (render.productCode) {
      page.drawText(`Product code  ${render.productCode}`, {
        x: metaX,
        y: metaCursor,
        size: 10,
        font: fonts.mono,
        color: COLOURS.ink,
      })
      metaCursor -= 14
    }
    if (render.ean) {
      page.drawText(`EAN  ${render.ean}`, {
        x: metaX,
        y: metaCursor,
        size: 10,
        font: fonts.mono,
        color: COLOURS.ink,
      })
      metaCursor -= 14
    }
    if (args.notes) {
      drawWrappedText({
        page,
        text: args.notes,
        x: metaX,
        y: metaCursor,
        size: 9,
        font: fonts.regular,
        color: COLOURS.muted,
        maxWidth: PAGE_W - metaX - MARGIN,
      })
    }
  }

  // Shared breakdown page for multi-SKU packets.
  if (args.renders.length > 1) {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    drawBanner({
      page,
      fonts,
      cmfCode: args.cmfCode ?? 'CMF Pack',
      productName: args.packetName,
      colorwayName: 'Pack breakdown',
      generatedAt,
    })

    const colCount = Math.min(args.renders.length, 4)
    const cellW = (PAGE_W - MARGIN * 2 - (colCount - 1) * 24) / colCount
    let cellX = MARGIN
    let cellY = PAGE_H - BANNER_H - 48
    for (const render of args.renders) {
      const components = (render.componentSpecs as unknown as ComponentSpec[]) ?? []
      // Title block per SKU
      page.drawText((render.colorwayName ?? render.label).toUpperCase(), {
        x: cellX,
        y: cellY,
        size: 12,
        font: fonts.bold,
        color: COLOURS.primary,
      })
      page.drawText(render.productSlug, {
        x: cellX,
        y: cellY - 16,
        size: 9,
        font: fonts.mono,
        color: COLOURS.muted,
      })
      // Mini swatch row
      let swatchX = cellX
      const swatchY = cellY - 38
      for (const comp of components.slice(0, 6)) {
        const colour = hexToRgb01(comp.colorHex)
        page.drawRectangle({
          x: swatchX,
          y: swatchY - 18,
          width: 20,
          height: 20,
          color: colour ?? rgb(0.9, 0.9, 0.92),
          borderColor: COLOURS.swatchBorder,
          borderWidth: 0.6,
        })
        page.drawText(comp.label.slice(0, 14), {
          x: swatchX,
          y: swatchY - 32,
          size: 7,
          font: fonts.regular,
          color: COLOURS.muted,
        })
        swatchX += 26
      }

      cellX += cellW + 24
      if (cellX + cellW > PAGE_W - MARGIN) {
        cellX = MARGIN
        cellY -= 140
      }
    }

    drawWrappedText({
      page,
      text: args.notes ?? '',
      x: MARGIN,
      y: MARGIN + 36,
      size: 9,
      font: fonts.regular,
      color: COLOURS.muted,
      maxWidth: PAGE_W - MARGIN * 2,
    })
  }

  return pdf.save()
}
