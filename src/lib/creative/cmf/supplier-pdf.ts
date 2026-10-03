/**
 * The supplier CMF PDF, built by code from one parse of one workbook upload (Damien's issue 1).
 * Every value on it is the cell it came from, printed as the cell holds it, to the product
 * repository's contract `plugins/ai-product-design/skills/cmf-review/references/spec-fields.md`
 * (`plugins/product-design/` before the rename). No
 * model sits between a cell and this file.
 *
 * Layout: the retired CMF skill's `document-template.md` (A4 portrait, the 3×3 header, one
 * render/spec page per SKU, then ONE shared part-breakdown page; no pack-overview page, no
 * per-colourway Pantone on the breakdown: Damien, 2026-07-06), with spec-fields.md's rules for
 * what each place holds:
 *
 *   header      CMF number, Collection, Product name, Product code, EAN code, Edit date, Drawn,
 *               Checked, Checked: the banner cells (the SKU's, else Common specs), as written
 *   SKU page    the approved render, then one block per component in the sheet's order, headed
 *               with the sheet's header, and inside it the sheet's own field names in the sheet's
 *               order, each with its value; an empty cell prints empty
 *   breakdown   the clown, its legend from the confirmed key (a chip in the zone's hex and the
 *               component it marks, in the key's order), the components not on this clown, and
 *               per component the material, finish and technique cells every SKU shares
 *   footer      every page: `{workbook file} · modified {ISO} · sha256 {12}`, then where the time
 *               came from, and `-- N of M --`
 *
 * The text is drawn in the order `spec_diff.py --layout ours` reads it back (pypdf and pdf.js
 * both follow the content stream): the footer first, then the page label, the header grid label
 * by value, then the blocks. Each line is its own text object, and a field name and its value
 * on one row sit far enough apart that pdf.js reads them as two lines, as pypdf does. The PDF is
 * read back and checked (`supplier-pdf-check.ts`) before anything is saved.
 */

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import sharp from 'sharp'
import { extractCodes } from './codes'
import { CmfError } from './kit-cmf'
import { collapse, effective, OURS_SHARED_TITLE, type Cell, type Spec, type SpecComponent, type SpecField } from './spec-diff'
import type { ClownKeyFile } from './prompt-fill'
import type { WorkbookInfo } from './workbook'

export const PAGE_W = 595
export const PAGE_H = 842
const MARGIN = 36
const HEADER_H = 100
const FOOTER_H = 44

const INK = rgb(0.07, 0.07, 0.08)
const MUTED = rgb(0.42, 0.42, 0.48)
const FAINT = rgb(0.86, 0.86, 0.9)
const HAIRLINE = rgb(0.72, 0.72, 0.78)
const PRIMARY = rgb(0.36, 0.24, 0.74)
const HEADER_BG = rgb(0.97, 0.96, 0.93)
const PANEL_BG = rgb(0.97, 0.97, 0.98)

/** The header grid's labels, in spec-fields.md's order, and the banner field each prints. */
export const HEADER_CELLS: Array<{ label: string; field: string }> = [
  { label: 'CMF number', field: 'CMF number' },
  { label: 'Collection', field: 'Collection' },
  { label: 'Product name', field: 'Product Name' },
  { label: 'Product code', field: 'Product Code' },
  { label: 'EAN code', field: 'EAN code' },
  { label: 'Edit date', field: 'Edit Date' },
  { label: 'Drawn', field: 'Drawn by' },
  { label: 'Checked', field: 'Checked by 1' },
  { label: 'Checked', field: 'Checked by 2' },
]

/** The breakdown page's section line between the legend and the shared cells; spec-diff.ts ends the legend there. */
export const BREAKDOWN_SHARED_TITLE = OURS_SHARED_TITLE
export const BREAKDOWN_LABEL = 'Part Break Down'
export const LEGEND_LABEL = 'Legend'
export const NOT_ON_CLOWN_PREFIX = 'Not on this clown: '

// workbook.py's field classes for the breakdown (V_MATERIAL, V_FINISH, V_TECHNIQUE).
const BREAKDOWN_FIELDS = new Set([
  'material',
  'colour and material',
  'finish',
  'finishing',
  'finish logo',
  'outer surface finish',
  'uv coating',
  'shell finishing',
  'finishing technique',
  'technique',
  'method',
])

export interface SupplierPdfImage {
  bytes: Buffer
  mimeType: string | null
}

export interface SupplierPdfInput {
  spec: Spec
  /** The SKU columns, one page each, in the sheet's column order. */
  columns: string[]
  key: { id: string; file: ClownKeyFile }
  renders: Record<string, SupplierPdfImage>
  clown: SupplierPdfImage | null
  workbook: WorkbookInfo
}

export interface SupplierPdfPage {
  kind: 'sku' | 'breakdown'
  column: string | null
}

export interface SupplierPdf {
  bytes: Uint8Array
  fileName: string
  pages: SupplierPdfPage[]
  legend: string[]
}

// ------------------------------------------------------------------ the cells

/** spec-diff.ts's banner record: the SKU's own cell, else Common specs, never for a yellow one. */
export function bannerCell(spec: Spec, field: string, col: string): Cell | null {
  const entry = (spec.banner ?? {})[field]
  if (!entry) return null
  const own = (entry[col] ?? null) as Cell | null
  const has = (r: Cell | null) => !!r && r.value !== null && r.value !== undefined
  if (own && has(own)) return own
  if (own && own.required) return own
  const common = (entry.common ?? null) as Cell | null
  if (common && has(common)) return common
  return own
}

function cellText(rec: Cell | null): string {
  return !rec || rec.value === null || rec.value === undefined ? '' : String(rec.value)
}

/** The value one field prints for one SKU: the SKU's cell, else Common specs, as the cell holds it. */
export function fieldText(field: SpecField, col: string): string {
  return cellText(effective(field, col))
}

/**
 * The key's components in its zone order, each once (the spec check's expected legend), with the
 * hex of every zone that marks it: the carry case's Shell - Front is the red zone (Outer Shell)
 * and the blue one (Inner Shell), so its line carries both chips.
 */
export function legendFromKey(key: ClownKeyFile): Array<{ component: string; hexes: string[] }> {
  const out: Array<{ component: string; hexes: string[] }> = []
  for (const z of key.zones ?? []) {
    for (const e of z.components ?? []) {
      const name = typeof e === 'string' ? e : e?.component
      if (!name) continue
      const hex = String(z.hex ?? '')
      const at = out.find((o) => o.component === name)
      if (!at) out.push({ component: name, hexes: [hex] })
      else if (!at.hexes.includes(hex)) at.hexes.push(hex)
    }
  }
  return out
}

/**
 * The breakdown's cells for one component: its material, finish and technique fields whose value
 * every SKU of the PDF shares (collapsed whitespace equal, not empty), leaving out any that holds
 * a colour code, so no colourway's colour reaches the shared page.
 */
export function sharedBreakdownFields(comp: SpecComponent, columns: string[]): Array<{ field: SpecField; text: string }> {
  const out: Array<{ field: SpecField; text: string }> = []
  for (const f of comp.fields) {
    if (!BREAKDOWN_FIELDS.has(collapse(f.name).toLowerCase())) continue
    const texts = columns.map((c) => fieldText(f, c))
    if (!texts[0] || texts.some((t) => collapse(t) !== collapse(texts[0]))) continue
    if (texts.some((t) => extractCodes(t).length > 0)) continue
    out.push({ field: f, text: texts[0] })
  }
  return out
}

/** A header cell's value on the shared page: the value every SKU prints there, else empty. */
export function sharedBannerText(spec: Spec, field: string, columns: string[]): string {
  const texts = columns.map((c) => cellText(bannerCell(spec, field, c)))
  return texts.every((t) => collapse(t) === collapse(texts[0])) ? texts[0] : ''
}

/** `{cmfCode}_{Product}_CMF_{Colorway}.pdf`, from banner cells: CMF number, Collection, Product Name. */
export function supplierPdfFileName(spec: Spec, columns: string[]): string {
  const safe = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9.-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '')
  const code = collapse(cellText(bannerCell(spec, 'CMF number', columns[0])))
  const product = collapse(cellText(bannerCell(spec, 'Collection', columns[0])))
  const names = columns.map((c) => collapse(cellText(bannerCell(spec, 'Product Name', c))))
  const colourway = Array.from(new Set(names)).join('+')
  const stem = [safe(code), safe(product), 'CMF', safe(colourway)].join('_').slice(0, 150)
  return `${stem}.pdf`
}

// ------------------------------------------------------------------ drawing

interface Fonts {
  regular: PDFFont
  bold: PDFFont
  mono: PDFFont
}

/** Refuses a value the PDF's font cannot print, naming where it comes from; nothing is substituted. */
function printable(font: PDFFont, raw: string, where: string): void {
  // A line break or a tab is layout, not a character to print: the lines are drawn apart.
  const text = raw.replace(/[\r\n\t]/g, ' ')
  try {
    font.encodeText(text)
  } catch {
    const bad = Array.from(text).filter((ch) => {
      try {
        font.encodeText(ch)
        return false
      } catch {
        return true
      }
    })
    throw new CmfError(`${where} holds ${bad.map((c) => `'${c}' (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}, which the PDF's font cannot print; nothing is printed in its place, so the PDF is not made`)
  }
}

/** Splits a cell's text into printed lines: its own line breaks kept, each wrapped at spaces to `width`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  for (const part of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = part.split(/[ \t ]+/).filter(Boolean)
    if (!words.length) continue
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (!cur || font.widthOfTextAtSize(next, size) <= width) cur = next
      else {
        out.push(cur)
        cur = w
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

/** A line's size: `size` unless it is wider than `width`, then smaller, down to 5pt. */
function fit(text: string, font: PDFFont, size: number, width: number): number {
  let s = size
  while (s > 5 && font.widthOfTextAtSize(text, s) > width) s -= 0.25
  return s
}

function drawLine(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color = INK): void {
  if (!text) return
  page.drawText(text, { x, y, size, font, color })
}

async function embed(pdf: PDFDocument, img: SupplierPdfImage, what: string): Promise<PDFImage> {
  const mime = (img.mimeType ?? '').toLowerCase()
  try {
    if (mime === 'image/png' || img.bytes.subarray(0, 4).toString('hex') === '89504e47') return await pdf.embedPng(img.bytes)
    if (mime === 'image/jpeg' || img.bytes.subarray(0, 2).toString('hex') === 'ffd8') return await pdf.embedJpg(img.bytes)
    // Another format (webp): its pixels as a PNG, unchanged in size. Image data only; no cell.
    return await pdf.embedPng(await sharp(img.bytes).png().toBuffer())
  } catch (err) {
    throw new CmfError(`${what} could not be placed in the PDF (${(err as Error)?.message || 'unreadable image'})`)
  }
}

function drawImageIn(page: PDFPage, image: PDFImage, box: { x: number; y: number; w: number; h: number }): void {
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: PANEL_BG, borderColor: FAINT, borderWidth: 0.5 })
  const aspect = image.width / image.height
  let w = box.w - 12
  let h = w / aspect
  if (h > box.h - 12) {
    h = box.h - 12
    w = h * aspect
  }
  page.drawImage(image, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h })
}

function hexColour(hex: string) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** The footer, drawn first on every page so its text never reads as a value. */
export function footerTrace(wb: WorkbookInfo): string {
  if (!wb.file || !wb.sha256 || !wb.modified) {
    throw new CmfError(
      `the workbook's ${!wb.modified ? 'modified time' : !wb.sha256 ? 'sha256' : 'file name'} is not known (${wb.modified_source ?? 'no source'}): the footer cannot name it, so the PDF is not made`
    )
  }
  return `${wb.file} · modified ${wb.modified} · sha256 ${wb.sha256.slice(0, 12)}`
}

/** Where the footer's time came from, in plain words, after the trace line. */
export function footerTimeSource(wb: WorkbookInfo): string {
  return (wb.modified_source ?? '').startsWith('docProps/core.xml')
    ? 'time: when the file was last saved'
    : 'time: when the file was uploaded; the file records no save time'
}

function drawFooter(page: PDFPage, fonts: Fonts, wb: WorkbookInfo, n: number, total: number): void {
  const line = `${footerTrace(wb)} · ${footerTimeSource(wb)}`
  printable(fonts.regular, line, 'the workbook file name')
  const size = fit(line, fonts.regular, 6.5, PAGE_W - MARGIN * 2)
  drawLine(page, line, MARGIN, 24, size, fonts.regular, MUTED)
  const marker = `-- ${n} of ${total} --`
  drawLine(page, marker, PAGE_W - MARGIN - fonts.mono.widthOfTextAtSize(marker, 8), 11, 8, fonts.mono, MUTED)
  page.drawRectangle({ x: 0, y: FOOTER_H - 8, width: PAGE_W, height: 0.75, color: FAINT })
}

/** The 3×3 header: each label, then its value's lines, cell by cell in spec-fields.md's order. */
function drawHeader(page: PDFPage, fonts: Fonts, values: string[], where: string[]): void {
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: HEADER_BG })
  page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H - 1, width: PAGE_W, height: 1, color: HAIRLINE })
  const cellW = (PAGE_W - MARGIN * 2) / 3
  const rowH = (HEADER_H - 16) / 3
  HEADER_CELLS.forEach((cell, i) => {
    const x = MARGIN + (i % 3) * cellW
    const y = PAGE_H - 18 - Math.floor(i / 3) * rowH
    drawLine(page, cell.label, x, y, 6, fonts.bold, MUTED)
    const text = values[i]
    printable(fonts.regular, text, where[i])
    let size = 8.5
    let lines = wrap(text, fonts.regular, size, cellW - 10)
    while (lines.length > 2 && size > 6) {
      size -= 0.5
      lines = wrap(text, fonts.regular, size, cellW - 10)
    }
    lines.forEach((ln, k) => drawLine(page, ln, x, y - 10 - k * (size + 1.5), fit(ln, fonts.regular, size, cellW - 10), fonts.regular, INK))
  })
}

// ------------------------------------------------------------------ one SKU's component blocks

interface BlockRow {
  name: string
  nameOwnRow: boolean
  lines: string[]
  sizes: number[]
}

interface Block {
  header: string
  rows: BlockRow[]
  height: number
}

const HEAD_SIZE = 8
const NAME_SIZE = 7
const VALUE_SIZE = 7.5
const PITCH = 9.2

function layoutBlocks(spec: Spec, col: string, fonts: Fonts, colW: number, nameW: number): Block[] {
  const valueW = colW - nameW
  return spec.components.map((comp) => {
    printable(fonts.bold, comp.header, `${spec.tab}!A${comp.row}`)
    const rows: BlockRow[] = comp.fields.map((f) => {
      const [text, where] = [fieldText(f, col), `${spec.tab}!${col}${f.row}`]
      printable(fonts.regular, f.name, `${spec.tab}!A${f.row}`)
      printable(fonts.regular, text, where)
      // The name and the value sit on one row only when pdf.js will still read them as two lines.
      const nameOwnRow = fonts.regular.widthOfTextAtSize(f.name, NAME_SIZE) + 3.5 * VALUE_SIZE > nameW
      const lines = wrap(text, fonts.regular, VALUE_SIZE, valueW - 4)
      return { name: f.name, nameOwnRow, lines, sizes: lines.map((ln) => fit(ln, fonts.regular, VALUE_SIZE, valueW - 4)) }
    })
    const height = PITCH + 2 + rows.reduce((h, r) => h + PITCH * (Math.max(1, r.lines.length) + (r.nameOwnRow ? 1 : 0)), 0) + 5
    return { header: comp.header, rows, height }
  })
}

function drawBlocks(page: PDFPage, fonts: Fonts, blocks: Block[], x: number, top: number, nameW: number): void {
  let y = top
  for (const b of blocks) {
    drawLine(page, b.header, x, y, HEAD_SIZE, fonts.bold, PRIMARY)
    y -= PITCH + 2
    for (const r of b.rows) {
      drawLine(page, r.name, x + 6, y, NAME_SIZE, fonts.regular, MUTED)
      if (r.nameOwnRow) y -= PITCH
      if (!r.lines.length) y -= PITCH
      r.lines.forEach((ln, k) => {
        drawLine(page, ln, x + nameW, y, r.sizes[k], fonts.regular, INK)
        y -= PITCH
      })
    }
    y -= 5
  }
}

/** Blocks in one column, or two filled top-down when one does not fit beside the render. */
function planColumns(blocks: Block[], height: number): Block[][] {
  const total = blocks.reduce((h, b) => h + b.height, 0)
  if (total <= height) return [blocks]
  const left: Block[] = []
  let h = 0
  let i = 0
  while (i < blocks.length && h + blocks[i].height <= Math.max(total / 2, blocks[0].height)) {
    h += blocks[i].height
    left.push(blocks[i])
    i++
  }
  return [left, blocks.slice(i)]
}

// ------------------------------------------------------------------ the document

/**
 * The PDF for SKU columns of one tab: one page per SKU in the sheet's column order, then the one
 * shared part-breakdown page. Refuses (CmfError) a value the font cannot print, a spec that does
 * not fit one page per SKU, or a workbook whose name, sha256 or modified time is unknown.
 */
export async function buildSupplierPdf(input: SupplierPdfInput): Promise<SupplierPdf> {
  const { spec, columns, workbook } = input
  if (!columns.length) throw new CmfError('no SKU column to print')
  footerTrace(workbook)
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${spec.tab} CMF`)
  pdf.setProducer('Vesper (cmf_pdf)')
  pdf.setCreator('Vesper')
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
  }
  const total = columns.length + 1
  const pages: SupplierPdfPage[] = []
  const bodyTop = PAGE_H - HEADER_H - 14
  const bodyBottom = FOOTER_H + 4

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]
    const page = pdf.addPage([PAGE_W, PAGE_H])
    drawFooter(page, fonts, workbook, i + 1, total)
    drawLine(page, `CMF Page ${i + 1}`, PAGE_W - MARGIN - fonts.bold.widthOfTextAtSize(`CMF Page ${i + 1}`, 10), PAGE_H - HEADER_H - 12, 10, fonts.bold, PRIMARY)
    drawHeader(
      page,
      fonts,
      HEADER_CELLS.map((c) => cellText(bannerCell(spec, c.field, col))),
      HEADER_CELLS.map((c) => `${spec.tab}!${col}${(spec.banner ?? {})[c.field]?.row ?? '?'} (${c.field})`)
    )
    const render = input.renders[col]
    if (!render) throw new CmfError(`no render for ${spec.tab} column ${col}`)
    const image = await embed(pdf, render, `the render of column ${col}`)

    // The blocks decide how much height the render keeps.
    const fullW = PAGE_W - MARGIN * 2
    let columnsPlan: Block[][] = []
    let nameW = 0
    let renderH = 0
    for (const [colW, split] of [
      [fullW, false],
      [(fullW - 18) / 2, true],
    ] as Array<[number, boolean]>) {
      nameW = Math.min(118, colW * 0.36)
      const blocks = layoutBlocks(spec, col, fonts, colW, nameW)
      const plan = split ? planColumns(blocks, 0) : [blocks]
      const needed = Math.max(...plan.map((c) => c.reduce((h, b) => h + b.height, 0)))
      renderH = Math.min(320, bodyTop - bodyBottom - needed - 14)
      columnsPlan = plan
      if (renderH >= 170) break
    }
    if (renderH < 120) throw new CmfError(`${spec.tab} column ${col} has more fields than one page holds beside its render; the PDF is not made`)
    drawImageIn(page, image, { x: MARGIN, y: bodyTop - renderH, w: fullW, h: renderH })
    const blocksTop = bodyTop - renderH - 16
    const colW = columnsPlan.length === 1 ? fullW : (fullW - 18) / 2
    columnsPlan.forEach((blocks, k) => drawBlocks(page, fonts, blocks, MARGIN + k * (colW + 18), blocksTop, nameW))
    pages.push({ kind: 'sku', column: col })
  }

  // The shared part-breakdown page.
  const page = pdf.addPage([PAGE_W, PAGE_H])
  drawFooter(page, fonts, workbook, total, total)
  const legend = legendFromKey(input.key.file)
  const notOn = (input.key.file.not_on_clown ?? []).filter(Boolean)
  // Before the header in the text: the page label, the clown's id and what is not on the clown.
  drawLine(page, BREAKDOWN_LABEL, PAGE_W - MARGIN - fonts.bold.widthOfTextAtSize(BREAKDOWN_LABEL, 10), PAGE_H - HEADER_H - 12, 10, fonts.bold, PRIMARY)
  const clownLabel = `Clown ${input.key.file.clown?.id ?? input.key.id} · key ${input.key.id}`
  printable(fonts.mono, clownLabel, 'the clown key id')
  drawLine(page, clownLabel, MARGIN, PAGE_H - HEADER_H - 12, 7, fonts.mono, MUTED)
  const bandTop = PAGE_H - HEADER_H - 22
  const bandH = Math.max(250, 40 + (legend.length + 1) * 14)
  const imageW = (PAGE_W - MARGIN * 2) * 0.55
  const legendX = MARGIN + imageW + 16
  const legendW = PAGE_W - MARGIN - legendX
  const legendLineY = (k: number) => bandTop - 16 - k * 14
  if (notOn.length) {
    const text = `${NOT_ON_CLOWN_PREFIX}${notOn.join(', ')}`
    printable(fonts.regular, text, 'the clown key not_on_clown')
    const lines = wrap(text, fonts.regular, 7, legendW)
    // One text line only, so it reads back whole; a long list gets a smaller size.
    const one = lines.length === 1 ? lines[0] : text
    drawLine(page, one, legendX, legendLineY(legend.length) - 6, fit(one, fonts.regular, 7, legendW), fonts.regular, MUTED)
  }
  drawHeader(
    page,
    fonts,
    HEADER_CELLS.map((c) => sharedBannerText(spec, c.field, columns)),
    HEADER_CELLS.map((c) => `${spec.tab} banner ${c.field}`)
  )
  if (input.clown) drawImageIn(page, await embed(pdf, input.clown, 'the clown'), { x: MARGIN, y: bandTop - bandH, w: imageW, h: bandH })
  drawLine(page, LEGEND_LABEL, legendX, bandTop, 8, fonts.bold, MUTED)
  const chipsW = Math.max(1, ...legend.map((e) => e.hexes.length)) * 13
  legend.forEach((entry, k) => {
    const y = legendLineY(k)
    // One chip per zone that marks the component, in the key's zone order.
    entry.hexes.forEach((hex, n) => {
      page.drawRectangle({ x: legendX + n * 13, y: y - 2, width: 10, height: 10, color: hexColour(hex) ?? PANEL_BG, borderColor: HAIRLINE, borderWidth: 0.5 })
    })
    printable(fonts.regular, entry.component, `the key's zone ${entry.hexes.join(', ')}`)
    drawLine(page, entry.component, legendX + chipsW + 4, y, fit(entry.component, fonts.regular, 8, legendW - chipsW - 4), fonts.regular, INK)
  })
  const sharedTop = bandTop - bandH - 20
  drawLine(page, BREAKDOWN_SHARED_TITLE, MARGIN, sharedTop, 9, fonts.bold, INK)
  const fullW = PAGE_W - MARGIN * 2
  const colW = (fullW - 18) / 2
  const nameW = Math.min(118, colW * 0.4)
  const blocks: Block[] = spec.components.map((comp) => {
    const rows = sharedBreakdownFields(comp, columns).map(({ field, text }) => {
      const lines = wrap(text, fonts.regular, VALUE_SIZE, colW - nameW - 4)
      return {
        name: field.name,
        nameOwnRow: fonts.regular.widthOfTextAtSize(field.name, NAME_SIZE) + 3.5 * VALUE_SIZE > nameW,
        lines,
        sizes: lines.map((ln) => fit(ln, fonts.regular, VALUE_SIZE, colW - nameW - 4)),
      }
    })
    const height = PITCH + 2 + rows.reduce((h, r) => h + PITCH * (Math.max(1, r.lines.length) + (r.nameOwnRow ? 1 : 0)), 0) + 5
    return { header: comp.header, rows, height }
  })
  const plan = planColumns(blocks, 0)
  const needed = Math.max(...plan.map((c) => c.reduce((h, b) => h + b.height, 0)))
  if (sharedTop - 14 - needed < bodyBottom) throw new CmfError(`${spec.tab}'s shared cells do not fit on the part-breakdown page; the PDF is not made`)
  plan.forEach((col, k) => drawBlocks(page, fonts, col, MARGIN + k * (colW + 18), sharedTop - 16, nameW))
  pages.push({ kind: 'breakdown', column: null })

  const bytes = await pdf.save({ useObjectStreams: false })
  return { bytes, fileName: supplierPdfFileName(spec, columns), pages, legend: legend.map((l) => l.component) }
}
