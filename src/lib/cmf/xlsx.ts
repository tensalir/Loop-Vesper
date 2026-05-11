/**
 * Server-side XLSX parser for CMF workbooks.
 *
 * Two supported workbook shapes:
 *
 *   1. Flat (legacy): single sheet, header row → one SKU per data row.
 *      Kept so existing tests and the lightweight template still work.
 *
 *   2. Transposed (current Loop CMF schema): one tab per product
 *      (Switch 2, Engage 2, etc.), one *column* per SKU. The first column
 *      lists field names, the second is "Common specs" shared across all
 *      SKUs, and each subsequent column is an individual SKU/colourway.
 *      Component sections appear as uppercase header rows followed by
 *      attribute rows (Material, Colour, Finish, ...).
 *
 * Both shapes parse to the same canonical `ParsedSkuRow[]` so the rest of
 * the pipeline does not branch on workbook format. Empty SKU columns
 * (placeholder cells like "xxxxxxxxxxx" / "xx/xx/xxxx") are intentionally
 * dropped so a half-filled tab never blocks a launch.
 *
 * Designed to live inside a Next.js Route Handler (Node runtime).
 */

import * as XLSX from 'xlsx'
import { getCmfProductBySheet, type CmfProductSpec } from './products'

export interface XlsxParseResult {
  /** Detected workbook shape — informational, the caller does not branch. */
  format: 'flat' | 'transposed'
  /** Per-sheet parse outcome; the transposed format yields multiple. */
  sheets: ParsedSheet[]
  /** Sheets we recognised but could not map to a product. */
  unmappedSheets: string[]
}

export interface ParsedSheet {
  sheetName: string
  productSlug: string
  productName: string
  collection: string | null
  /** Document groups (e.g. "BATTERY (12-14)") for the PDF/HTML layout. */
  groups: ParsedGroup[]
  skus: ParsedSkuRow[]
}

export interface ParsedGroup {
  name: string
  components: string[]
}

export interface ParsedSkuRow {
  /** Stable index within the sheet (column letter offset). */
  columnIndex: number
  /** SKU label from the column header (e.g. "SKU 1", "Emerald"). */
  skuLabel: string
  banner: ParsedBanner
  components: ParsedComponent[]
}

export interface ParsedBanner {
  cmfNumber: string | null
  collection: string | null
  productName: string | null
  productCode: string | null
  ean: string | null
  editDate: string | null
  drawnBy: string | null
  checkedBy1: string | null
  checkedBy2: string | null
}

export interface ParsedComponent {
  /** Snake-cased region key used for prompts and clown lookups. */
  region: string
  /** Original component name from the workbook. */
  label: string
  pantone: string | null
  colorHex: string | null
  material: string | null
  finish: string | null
  technique: string | null
  notes: string | null
}

export class XlsxParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxParseError'
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entry point
 * ────────────────────────────────────────────────────────────────────────── */

export function parseCmfWorkbook(buffer: Buffer): XlsxParseResult {
  let workbook: XLSX.WorkBook
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown parser error'
    throw new XlsxParseError(`Failed to parse workbook: ${message}`)
  }
  if (!workbook.SheetNames.length) {
    throw new XlsxParseError('Workbook has no sheets')
  }

  // Heuristic: if any sheet maps to a known product AND looks like the
  // transposed schema (row[0] has "Common specs" in column B), we use the
  // transposed parser for all product tabs. Otherwise we fall back to the
  // single-sheet flat parser so legacy templates still work.
  const transposedSheets: ParsedSheet[] = []
  const unmappedSheets: string[] = []
  let sawTransposedShape = false

  for (const name of workbook.SheetNames) {
    if (isMetaSheet(name)) continue
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const aoa = sheetToAoa(sheet)
    if (looksTransposed(aoa)) {
      sawTransposedShape = true
      const product = getCmfProductBySheet(name)
      if (!product) {
        unmappedSheets.push(name)
        continue
      }
      const parsed = parseTransposedSheet(name, aoa, product)
      if (parsed.skus.length > 0) transposedSheets.push(parsed)
    }
  }

  if (sawTransposedShape) {
    return { format: 'transposed', sheets: transposedSheets, unmappedSheets }
  }

  // Flat fallback — single product/sheet, header row drives column names.
  const flatSheets = parseFlatWorkbook(workbook)
  return { format: 'flat', sheets: flatSheets, unmappedSheets: [] }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transposed format
 * ────────────────────────────────────────────────────────────────────────── */

const COMMON_COL = 1 // column B
const FIRST_SKU_COL = 2 // column C

/** Banner field names we recognise (matched case-insensitively). */
const BANNER_FIELDS: Record<string, keyof ParsedBanner> = {
  'cmf number': 'cmfNumber',
  'cmf': 'cmfNumber',
  'collection': 'collection',
  'product name': 'productName',
  'product code': 'productCode',
  'ean code': 'ean',
  'ean': 'ean',
  'edit date': 'editDate',
  'drawn by': 'drawnBy',
  'checked by 1': 'checkedBy1',
  'checked by 2': 'checkedBy2',
}

/**
 * Attribute field names mapped to ParsedComponent fields. The mapping is
 * intentionally GUIDE-level (high freedom): the workbook uses multiple
 * synonyms ("Finish", "Outer surface finish", "Finishing", "Finish Logo")
 * which all collapse to `finish`. Anything we do not recognise lands in
 * `notes` so context is never silently lost.
 */
const ATTRIBUTE_MAP: Record<string, keyof ParsedComponent> = {
  'material': 'material',
  'finish': 'finish',
  'finishing': 'finish',
  'finish logo': 'finish',
  'outer surface finish': 'finish',
  'uv coating': 'finish',
  'colour': 'pantone',
  'color': 'pantone',
  'colour and material': 'material',
  'colour and material drawstring': 'notes',
  'colour and technic logo': 'pantone',
  'color artwork': 'notes',
  'finishing technique': 'technique',
  'technique': 'technique',
  'method': 'technique',
  'reference finishing': 'notes',
  'artwork': 'notes',
  'mock-up': 'notes',
  'coating': 'notes',
  'transparency': 'notes',
  'transmittance %': 'notes',
  'color pigment %': 'notes',
  'ref.code': 'notes',
  'l*a*b=': 'notes',
  'delta e': 'notes',
  'outer shell': 'notes',
  'inner shell': 'notes',
  'insert': 'notes',
}

function parseTransposedSheet(
  sheetName: string,
  aoa: unknown[][],
  product: CmfProductSpec
): ParsedSheet {
  // Find the column count from row 0 (the SKU header row).
  const headerRow = aoa[0] ?? []
  const lastCol = Math.max(...aoa.map((r) => r.length), headerRow.length)
  const skuColumns: { index: number; label: string }[] = []
  for (let c = FIRST_SKU_COL; c < lastCol; c++) {
    const label = cellString(headerRow[c])
    if (!label) continue
    skuColumns.push({ index: c, label })
  }

  // Walk rows to identify section/group/component/banner blocks.
  const banner: Record<number, ParsedBanner> = {}
  for (const col of skuColumns) {
    banner[col.index] = emptyBanner()
  }
  const collection = pickCollection(aoa)

  const components: Record<number, ParsedComponent[]> = {}
  for (const col of skuColumns) components[col.index] = []

  const groups: ParsedGroup[] = []

  let mode: 'idle' | 'banner' | 'component' = 'idle'
  let currentComponent: { name: string; region: string } | null = null
  let currentGroup: ParsedGroup | null = null
  let perSkuActive: Record<number, ParsedComponent | null> = {}

  function ensureComponent(colIndex: number): ParsedComponent {
    if (!perSkuActive[colIndex]) {
      perSkuActive[colIndex] = {
        region: currentComponent!.region,
        label: currentComponent!.name,
        pantone: null,
        colorHex: null,
        material: null,
        finish: null,
        technique: null,
        notes: null,
      }
      components[colIndex].push(perSkuActive[colIndex]!)
    }
    return perSkuActive[colIndex]!
  }

  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const labelCell = cellString(row[0])
    const commonCell = cellString(row[COMMON_COL])
    const skuCells: Record<number, string> = {}
    for (const col of skuColumns) {
      skuCells[col.index] = cellString(row[col.index])
    }

    if (!labelCell && !commonCell && !Object.values(skuCells).some(Boolean)) continue

    const normalisedLabel = labelCell.toLowerCase().trim()

    // BANNER header — switches us into banner mode for following rows.
    if (normalisedLabel === 'banner') {
      mode = 'banner'
      currentComponent = null
      perSkuActive = {}
      continue
    }

    // Recognised banner field? Capture and continue.
    if (mode === 'banner' && BANNER_FIELDS[normalisedLabel]) {
      const key = BANNER_FIELDS[normalisedLabel]
      for (const col of skuColumns) {
        const v = pickValue(skuCells[col.index], commonCell)
        if (v) banner[col.index][key] = v
      }
      continue
    }

    // Container row = col A non-empty, B and all SKU cols empty.
    const isContainer =
      !!labelCell &&
      !commonCell &&
      Object.values(skuCells).every((v) => !v)

    if (isContainer) {
      // Detect group header vs component header by peeking the next non-empty
      // row. A group header is followed by another container; a component
      // header is followed by an attribute row.
      const nextContainer = peekIsContainer(aoa, r + 1, skuColumns)
      if (nextContainer) {
        // Group header. Remember for the document layout, then skip.
        currentGroup = { name: labelCell, components: [] }
        groups.push(currentGroup)
        currentComponent = null
        perSkuActive = {}
        mode = 'idle'
        continue
      }

      // Component header.
      const region = slugifyRegion(labelCell)
      currentComponent = { name: labelCell, region }
      perSkuActive = {}
      mode = 'component'
      if (currentGroup) currentGroup.components.push(labelCell)
      continue
    }

    // Attribute row inside a component.
    if (mode === 'component' && currentComponent) {
      const field = ATTRIBUTE_MAP[normalisedLabel] ?? 'notes'
      const isColourField = field === 'pantone'

      for (const col of skuColumns) {
        const value = pickValue(skuCells[col.index], commonCell)
        if (!value) continue
        // Drop placeholder values so the downstream prompt builder never
        // sees "Pantone xxxxxxxxxxx" as a real spec.
        if (!isReal(value)) continue
        const component = ensureComponent(col.index)
        if (isColourField) {
          const pantone = extractPantone(value)
          if (pantone) component.pantone = pantone
          // Keep the full text (which may include "translucent" / "see ref")
          // in notes so designer intent is preserved verbatim.
          mergeNotes(component, `${labelCell}: ${value}`)
        } else if (field === 'notes') {
          mergeNotes(component, `${labelCell}: ${value}`)
        } else {
          // Use the first non-empty source-of-truth; later attribute rows
          // can append to notes but should not silently overwrite.
          if (!component[field]) {
            ;(component as Record<keyof ParsedComponent, string | null>)[field] = value
          } else if (component[field] !== value) {
            mergeNotes(component, `${labelCell}: ${value}`)
          }
        }
      }
      continue
    }
  }

  // Filter out empty SKU columns — the workbook ships with three SKU slots
  // by default and a designer often fills only one. Empty = no banner
  // values look real AND no component attributes were captured.
  const skus: ParsedSkuRow[] = []
  for (const col of skuColumns) {
    const b = banner[col.index]
    const c = components[col.index] ?? []
    if (!isSkuFilled(b, c)) continue
    skus.push({
      columnIndex: col.index,
      skuLabel: col.label,
      banner: b,
      components: c,
    })
  }

  return {
    sheetName,
    productSlug: product.slug,
    productName: product.name,
    collection,
    groups,
    skus,
  }
}

function peekIsContainer(
  aoa: unknown[][],
  startRow: number,
  skuColumns: { index: number; label: string }[]
): boolean {
  for (let r = startRow; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const a = cellString(row[0])
    const b = cellString(row[COMMON_COL])
    const skus = skuColumns.map((c) => cellString(row[c.index]))
    if (!a && !b && skus.every((v) => !v)) continue
    return !!a && !b && skus.every((v) => !v)
  }
  return false
}

function isSkuFilled(banner: ParsedBanner, components: ParsedComponent[]): boolean {
  // A SKU is "filled" only when banner identity OR a per-SKU component
  // attribute is real (not placeholder). Common-spec values that the
  // workbook duplicates across columns do not count, because every column
  // would otherwise look populated even when the designer only really
  // filled one.
  const realProductName = isReal(banner.productName)
  const realCmfNumber = isReal(banner.cmfNumber)
  const realProductCode = isReal(banner.productCode)
  const hasPerSkuPantone = components.some((c) => isReal(c.pantone))
  return realProductName || realCmfNumber || realProductCode || hasPerSkuPantone
}

function isReal(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^[/-]$/.test(trimmed)) return false
  if (/^x+$/i.test(trimmed)) return false
  if (/^x{2,}\/x{2,}\/x{2,}$/i.test(trimmed)) return false
  if (/x{6,}/i.test(trimmed) && !/[a-w0-9]/i.test(trimmed.replace(/x/gi, ''))) return false
  if (/^cmf-x+\s*rev\s*x$/i.test(trimmed)) return false
  // "Pantone xxxxxxxxxxx" or any pantone with a long x-run is a placeholder.
  if (/pantone\s+x{4,}/i.test(trimmed)) return false
  return true
}

function emptyBanner(): ParsedBanner {
  return {
    cmfNumber: null,
    collection: null,
    productName: null,
    productCode: null,
    ean: null,
    editDate: null,
    drawnBy: null,
    checkedBy1: null,
    checkedBy2: null,
  }
}

function pickCollection(aoa: unknown[][]): string | null {
  for (const row of aoa) {
    const label = cellString(row[0]).toLowerCase().trim()
    if (label === 'collection') {
      const v = cellString(row[COMMON_COL])
      return v || null
    }
  }
  return null
}

function pickValue(skuValue: string, commonValue: string): string {
  if (isReal(skuValue)) return skuValue.trim()
  if (isReal(commonValue)) return commonValue.trim()
  return ''
}

function mergeNotes(component: ParsedComponent, addition: string) {
  if (!component.notes) component.notes = addition
  else if (!component.notes.includes(addition)) component.notes = `${component.notes} · ${addition}`
}

function extractPantone(value: string): string | null {
  const match = value.match(/pantone\s+[a-z0-9-]+\s*(c|cp|u|tcx|tpg)?/i)
  if (match) return match[0].replace(/\s+/g, ' ').trim()
  // Free-form "Black 6C", "Black" etc. — return as-is when the cell looks
  // colour-like (very short or contains "Pantone"-adjacent tokens).
  const lower = value.toLowerCase()
  if (lower.includes('pantone')) return value.trim()
  if (value.trim().length <= 32) return value.trim()
  return null
}

function slugifyRegion(label: string): string {
  return label
    .toLowerCase()
    // Strip leading numbering like "1. " or "A. " from Aphrodite CC / Earplug.
    .replace(/^[a-z0-9]+\.\s*/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'component'
}

function looksTransposed(aoa: unknown[][]): boolean {
  const head = aoa[0] ?? []
  return cellString(head[1]).toLowerCase().includes('common spec')
}

function isMetaSheet(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'readme' || n === 'textile library' || n.startsWith('_')
}

function sheetToAoa(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  })
}

function cellString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

/* ────────────────────────────────────────────────────────────────────────────
 * Flat (legacy) format
 * ────────────────────────────────────────────────────────────────────────── */

function parseFlatWorkbook(workbook: XLSX.WorkBook): ParsedSheet[] {
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new XlsxParseError(`Sheet ${sheetName} is missing`)

  const aoa = sheetToAoa(sheet)
  if (aoa.length < 2) {
    throw new XlsxParseError('Workbook must have a header row and at least one data row')
  }

  // Locate the first row that looks like headers (≥ 2 non-empty cells).
  let headerRowIndex = 0
  for (let i = 0; i < aoa.length; i++) {
    const candidate = aoa[i]
    const filled = candidate.filter((c) => c !== '' && c != null && String(c).trim() !== '').length
    if (filled >= 2) {
      headerRowIndex = i
      break
    }
  }
  const headerRow = aoa[headerRowIndex] as unknown[]
  const headers = headerRow.map((c, idx) => {
    const text = c == null ? '' : String(c).trim()
    return text || `column_${idx + 1}`
  })
  const rows: Array<Record<string, unknown>> = []
  for (let i = headerRowIndex + 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[]
    if (!row || row.every((c) => c === '' || c == null)) continue
    const obj: Record<string, unknown> = {}
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? ''
    })
    rows.push(obj)
  }

  return [
    {
      sheetName,
      productSlug: '__flat__',
      productName: 'Flat workbook',
      collection: null,
      groups: [],
      skus: rows.map((raw, idx) => flatRowToSku(raw, idx)),
    },
  ]
}

function flatRowToSku(raw: Record<string, unknown>, idx: number): ParsedSkuRow {
  // The flat path is only kept for the legacy template; the heavy lifting
  // happens in `schema.ts > normaliseRawRows` which reads the same raw
  // objects. We populate a placeholder ParsedSkuRow that schema.ts
  // routes through `normaliseRawRows` directly via `getFlatRawRows`.
  return {
    columnIndex: idx + 1,
    skuLabel: '',
    banner: emptyBanner(),
    components: [],
  }
}

/** Returns the raw flat-format rows when the parser detected the flat shape.
 * Used by the schema normaliser to keep the legacy column-keyed path alive
 * without duplicating XLSX read logic. */
export function getFlatRawRows(buffer: Buffer): Array<Record<string, unknown>> {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  if (!workbook.SheetNames.length) return []
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const aoa = sheetToAoa(sheet)
  if (aoa.length < 2) return []
  let headerRowIndex = 0
  for (let i = 0; i < aoa.length; i++) {
    const candidate = aoa[i]
    const filled = candidate.filter((c) => c !== '' && c != null && String(c).trim() !== '').length
    if (filled >= 2) {
      headerRowIndex = i
      break
    }
  }
  const headerRow = aoa[headerRowIndex] as unknown[]
  const headers = headerRow.map((c, idx) => {
    const text = c == null ? '' : String(c).trim()
    return text || `column_${idx + 1}`
  })
  const rows: Array<Record<string, unknown>> = []
  for (let i = headerRowIndex + 1; i < aoa.length; i++) {
    const row = aoa[i] as unknown[]
    if (!row || row.every((c) => c === '' || c == null)) continue
    const obj: Record<string, unknown> = {}
    headers.forEach((header, idx) => {
      obj[header] = row[idx] ?? ''
    })
    rows.push(obj)
  }
  return rows
}

/* ────────────────────────────────────────────────────────────────────────────
 * Template
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Generate a minimal CMF workbook template buffer the UI can offer as a
 * starter download. Single sheet, headers only.
 */
export function buildCmfTemplateWorkbook(productSlug = 'switch2'): Buffer {
  const headers = [
    'label',
    'product_slug',
    'variant_slug',
    'product_code',
    'ean',
    'colorway_name',
    'cmf_code',
    'packet_name',
    'clown_slug',
    'pom_ring_pantone',
    'pom_ring_material',
    'pom_ring_finish',
    'cosmetic_cap_pantone',
    'cosmetic_cap_material',
    'cosmetic_cap_finish',
    'silicone_tip_pantone',
    'silicone_tip_material',
    'silicone_tip_finish',
    'notes',
  ]

  const example = [
    'Switch 2 Sage',
    productSlug,
    'default',
    'SW2-SAGE-001',
    '5400000000017',
    'Sage',
    'CMF-001234revA',
    'Switch 2 Spring 2026',
    'switch2-clown-1',
    'PANTONE 17-5641 TCX',
    'POM',
    'Matte',
    'PANTONE 11-0602 TCX',
    'PC/ABS',
    'Satin',
    'PANTONE 14-4313 TCX',
    'Silicone',
    'Matte',
    'Spring 2026 launch',
  ]

  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'CMF')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}
