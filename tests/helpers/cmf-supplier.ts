/**
 * Test-only material for the supplier PDF tests. Nothing here is Damien's: the banner cells the
 * workbook still holds as placeholders are filled here, labelled TEST-FILLED, and a tab with no
 * named clown key gets a key made here, labelled as a test key. The component cells are the
 * workbook's own, untouched.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import * as XLSX from 'xlsx'
import type { Cell, Spec } from '../../src/lib/creative/cmf/spec-diff'
import type { ClownKeyFile } from '../../src/lib/creative/cmf/prompt-fill'

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

/** The banner cells a real SKU still holds as placeholders, and what the tests put in them. */
export const TEST_FILLED = ['CMF number', 'Product Code', 'EAN code', 'Checked by 1', 'Checked by 2'] as const

function testValue(field: string, col: string, n: number): string {
  switch (field) {
    case 'CMF number':
      return `CMF-TEST0${n} rev A`
    case 'Product Code':
      return `TEST-FILLED-${col}`
    case 'EAN code':
      return `540000000000${n}`
    default:
      return `TEST ${field.slice(-1)}`
  }
}

/** A copy of the spec whose five pending banner cells of `columns` are filled, TEST-FILLED. */
export function withTestFilledBanner(spec: Spec, columns: string[]): Spec {
  const out = clone(spec)
  columns.forEach((col, i) => {
    for (const field of TEST_FILLED) {
      const entry = (out.banner ?? {})[field]
      if (!entry) continue
      const own = (entry[col] ?? null) as Cell | null
      if (!own) continue
      const v = testValue(field, col, i + 1)
      entry[col] = { ...own, raw: v, value: v, placeholder: null, flags: [] }
    }
  })
  return out
}

/** Every pending banner cell of a SKU, as `Tab!C3 (CMF number)`. */
export function pendingBannerCells(spec: Spec, col: string): string[] {
  const out: string[] = []
  for (const [field, entry] of Object.entries(spec.banner ?? {})) {
    const own = (entry[col] ?? null) as Cell | null
    if (own && own.required && (own.value === null || own.value === undefined || (own.placeholder && !['slash', 'dash', 'n/a'].includes(own.placeholder)))) {
      out.push(`${spec.tab}!${col}${entry.row} (${field})`)
    }
  }
  return out
}

const PALETTE = ['#D51C1B', '#C6B807', '#206893', '#2E8B57', '#8A2BE2', '#FF8C00', '#00CED1', '#DC143C', '#708090', '#6B8E23', '#B8860B', '#4682B4', '#9932CC', '#CD5C5C']

/** A TEST key for a tab without a named key: one zone per component, in the sheet's order, confirmed by "test". */
export function testKeyFor(spec: Spec, id: string): ClownKeyFile {
  return {
    product: id.split('--')[0],
    clown: { id, sha256: sha256(`test clown ${id}`), width: 1024, height: 1024 },
    confirmed_by: 'test key (not Damien)',
    confirmed_at: '2026-09-29',
    zones: spec.components.map((c, i) => ({ hex: PALETTE[i % PALETTE.length], components: [c.header] })),
    not_on_clown: [],
    note: 'TEST key made by tests/helpers/cmf-supplier.ts',
  }
}

/** A real key, marked confirmed for the test: its zones are the product repository's. */
export function testConfirmed(key: ClownKeyFile): ClownKeyFile {
  return { ...clone(key), confirmed_by: 'test (Damien has not confirmed this key)', confirmed_at: '2026-09-29' }
}

export async function png(r: number, g: number, b: number, w = 96, h = 96): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer()
}

/** The real 2026-09-22 workbook, where it is on this machine (it is never committed). */
export function findRealWorkbook(): { file: string; bytes: Buffer; committed: { file: string; sha256: string; modified: string } } | null {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'cmf', 'prompt-parity.json'), 'utf8'))
  const wb = fixture.specs['references/workbook/spec/experience-2-cc.json'].workbook as { file: string; sha256: string; modified: string }
  const roots = [process.env.LOOP_ASSET_REVIEWER_DIR, path.join(__dirname, '..', '..', '..', '..', 'loop-asset-reviewer-cmf')].filter((p): p is string => !!p)
  for (const root of roots) {
    const file = path.join(root, 'workstreams', 'cmf', 'references', 'workbook', wb.file)
    if (!fs.existsSync(file)) continue
    const bytes = fs.readFileSync(file)
    if (sha256(bytes) === wb.sha256) return { file, bytes, committed: wb }
  }
  return null
}

/**
 * A spec written back out as a workbook the way a Google Sheets download would read without its
 * fills: column A's text carries the structure (two leading spaces on a field), values as text.
 * SheetJS writes no fills, so no cell comes back yellow.
 */
export function specToXlsx(spec: Spec, opts: { modified?: Date } = {}): Buffer {
  const rows: Array<Array<string | null>> = []
  const cols = spec.skus.map((s) => s.column)
  const colIndex = (c: string) => XLSX.utils.decode_col(c)
  const width = Math.max(...cols.map(colIndex)) + 1
  const put = (r: number, c: number, v: string | null) => {
    while (rows.length < r) rows.push(new Array(width).fill(null))
    rows[r - 1][c] = v
  }
  const header = Number(spec.header_row ?? 1)
  put(header, 1, String(spec.common_header ?? 'Common specs'))
  for (const s of spec.skus) put(header, colIndex(s.column), String(s.header ?? s.column))
  const bannerRows = Object.values(spec.banner ?? {}).map((e) => e.row)
  if (bannerRows.length) put(Math.min(...bannerRows) - 1, 0, 'BANNER')
  const text = (rec: Cell | null | undefined) => (rec && rec.value !== null && rec.value !== undefined ? String(rec.value) : null)
  for (const [name, entry] of Object.entries(spec.banner ?? {})) {
    put(entry.row, 0, `  ${name}`)
    put(entry.row, 1, text(entry.common as Cell | null))
    for (const c of cols) put(entry.row, colIndex(c), text(entry[c] as Cell | null))
  }
  for (const comp of spec.components) {
    put(comp.row, 0, comp.header)
    for (const f of comp.fields) {
      put(f.row, 0, `  ${f.name}`)
      put(f.row, 1, text(f.common))
      for (const c of cols) put(f.row, colIndex(c), text(f.by_sku[c]))
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), spec.tab)
  if (opts.modified) wb.Props = { ModifiedDate: opts.modified }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
