/**
 * Server-side XLSX parser for CMF workbooks.
 *
 * Designed to live inside a Next.js Route Handler (Node runtime). Accepts a
 * raw `Buffer` and returns an array of header-keyed plain objects so the
 * downstream `normaliseRawRows` schema can validate them.
 *
 * The first sheet is treated as the source of truth. Empty leading rows are
 * skipped so designers can have title rows above the actual table.
 */

import * as XLSX from 'xlsx'

export interface XlsxParseResult {
  sheetName: string
  headers: string[]
  rows: Array<Record<string, unknown>>
}

export class XlsxParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XlsxParseError'
  }
}

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

  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new XlsxParseError(`Sheet ${sheetName} is missing`)
  }

  // header: 1 returns rows as arrays so we can pick the first non-empty row
  // as the header. defval keeps blank cells in the array shape.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  })

  if (aoa.length < 2) {
    throw new XlsxParseError('Workbook must have a header row and at least one data row')
  }

  // Skip leading rows where every cell is empty/string-empty until we find
  // one that looks like a header row (has at least 2 non-empty strings).
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

  return { sheetName, headers, rows }
}

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
