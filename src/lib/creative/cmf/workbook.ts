/**
 * A CMF workbook read into the spec the spec check compares against: a port of `parse_tab` in the
 * plugin repository's `workstreams/cmf/scripts/workbook.py`, for the parts `spec-diff.ts` reads
 * (the header row, the SKU columns, the banner, every component and field, each cell's value,
 * placeholder, fill and codes). The problem list and the per-SKU counts are not ported.
 *
 * Why it is here (2026-09-29): the web CMF Studio built supplier PDFs from its own copy of the
 * sheet (`cmf_renders.componentSpecs`), which its importer had already altered, and nothing
 * compared the PDF with the sheet. The export now reads the workbook the designer uploaded (kept
 * at `cmf/{owner}/imports/{id}.xlsx`) with this reader, which shares no code with the importer
 * (`src/lib/cmf/xlsx.ts`), and refuses the PDF on any difference.
 *
 * The rules are the script's: the structure comes from the fills Damien's template sets, with the
 * text of column A as a fallback; a cell keeps what the sheet says (`raw`) beside the value read
 * from it (`value`); a gap is never filled. `tests/cmf-workbook.spec.ts` holds it to the script's
 * committed specs on the real workbook, where that workbook is on the machine.
 */

import crypto from 'crypto'
import * as XLSX from 'xlsx'
import { colourName, extractCodes, hasColourWord, isPlaceholder, NOT_APPLICABLE } from './codes'
import { effective, type Cell, type Spec, type SpecComponent, type SpecField } from './spec-diff'

export const FILL_HEADER_ROW = 'FF595959'
export const FILL_COMPONENT = 'FF404040'
export const FILL_SECTION = 'FF1F1F1F'
export const FILL_FIELD = 'FFF2F2F2'
export const FILL_REQUIRED = 'FFFFF2CC'

const FILL_KIND: Record<string, 'header_row' | 'component' | 'section' | 'field'> = {
  [FILL_HEADER_ROW]: 'header_row',
  [FILL_COMPONENT]: 'component',
  [FILL_SECTION]: 'section',
  [FILL_FIELD]: 'field',
}

const SKIP_TABS = new Set(['readme'])
const TEXTILE_TAB = 'textile library'
const UNRENAMED_HEADER = /^sku\s*\d+$/i
const COLOUR_FIELDS = new Set(['outer shell', 'inner shell', 'shell inside', 'l*a*b='])
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/** A date-formatted cell as openpyxl hands it over: a datetime (`time` is midnight for a date alone). */
export interface SheetDate {
  kind: 'date'
  y: number
  m: number
  d: number
  time: { H: number; M: number; S: number } | null
}

/** What a cell holds, typed as openpyxl types it: text, a number, a boolean, a date, or nothing. */
export type RawValue = string | number | boolean | SheetDate | null

export interface GridCell {
  raw: RawValue
  /** The fill as openpyxl names it: `FFF2F2F2`, `theme:4`, `indexed:64`, or null. */
  fill: string | null
}

/** One tab as rows and columns counted from 1, as openpyxl counts them. */
export interface SheetGrid {
  title: string
  maxRow: number
  maxCol: number
  cell(row: number, col: number): GridCell
}

export interface WorkbookInfo {
  file: string | null
  sha256: string | null
  modified: string | null
  modified_source?: string | null
}

// ------------------------------------------------------------------ small helpers

function norm(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function isBlank(raw: RawValue): boolean {
  return raw === null || (typeof raw === 'string' && raw.trim() === '')
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

function isoDate(v: SheetDate): string {
  return `${pad(v.y, 4)}-${pad(v.m)}-${pad(v.d)}`
}

/** Python's `str()` of what openpyxl returns. */
function pyStr(raw: Exclude<RawValue, null>): string {
  if (typeof raw === 'boolean') return raw ? 'True' : 'False'
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return raw
  return raw.time ? `${isoDate(raw)} ${pad(raw.time.H)}:${pad(raw.time.M)}:${pad(raw.time.S)}` : isoDate(raw)
}

export function colLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function tabSlug(tab: string): string {
  if (norm(tab) === TEXTILE_TAB) return '_textile-library'
  return String(tab).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function isColourField(name: string): boolean {
  const n = norm(name)
  if (n.includes('%')) return false
  return n.includes('colour') || n.includes('color') || COLOUR_FIELDS.has(n)
}

/** `_cell_value`: text trimmed, a date as an ISO date, an EAN without its leading quote. */
function cellValue(raw: RawValue, fieldName: string, flags: string[]): string | null {
  if (isBlank(raw)) return null
  const name = norm(fieldName)
  if (raw !== null && typeof raw === 'object') {
    flags.push('date_typed')
    if (!raw.time || (raw.time.H === 0 && raw.time.M === 0 && raw.time.S === 0)) return isoDate(raw)
    return `${isoDate(raw)}T${pad(raw.time.H)}:${pad(raw.time.M)}:${pad(raw.time.S)}`
  }
  if (typeof raw === 'boolean') return raw ? 'True' : 'False'
  if (typeof raw === 'number') return String(raw)
  let value = String(raw).trim()
  if (name.startsWith('ean') && value.startsWith('"')) {
    value = value.slice(1).trim()
    flags.push('leading_quote')
  }
  if (name === 'edit date') {
    const m = DMY.exec(value)
    if (m) {
      const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])]
      const probe = new Date(Date.UTC(year, month - 1, day))
      if (probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day) {
        value = `${pad(year, 4)}-${pad(month)}-${pad(day)}`
        flags.push('date_from_text')
      } else {
        flags.push('date_unparsed')
      }
    }
  }
  return value
}

function cellRecord(cell: GridCell, fieldName: string, withCodes: boolean): Cell {
  const flags: string[] = []
  const value = cellValue(cell.raw, fieldName, flags)
  const rec: Cell = {
    raw: cell.raw === null ? null : pyStr(cell.raw),
    value,
    placeholder: value !== null ? isPlaceholder(value) : null,
    required: cell.fill === FILL_REQUIRED,
    fill: cell.fill,
    flags,
  }
  if (withCodes) {
    const found = value === null ? [] : extractCodes(value)
    rec.codes = found
    rec.colour_name = value !== null && (found.length > 0 || isColourField(fieldName)) ? colourName(value, found) : null
  }
  return rec
}

type TextKind = 'values_only' | 'empty' | 'field' | 'field_unindented' | 'header'

function textKind(aRaw: RawValue, hasValues: boolean): TextKind {
  if (isBlank(aRaw)) return hasValues ? 'values_only' : 'empty'
  const s = pyStr(aRaw as Exclude<RawValue, null>)
  if (/^\s/.test(s)) return 'field'
  return hasValues ? 'field_unindented' : 'header'
}

function findHeaderRow(ws: SheetGrid): number {
  for (let r = 1; r <= Math.min(ws.maxRow, 10); r++) {
    const a = ws.cell(r, 1)
    const b = ws.cell(r, 2)
    if (a.fill === FILL_HEADER_ROW || norm(b.raw === null ? '' : pyStr(b.raw)).startsWith('common')) return r
  }
  return 1
}

// ------------------------------------------------------------------ one product tab

/** `parse_tab`, without its problem list: one tab as the spec the check reads. */
export function parseTab(ws: SheetGrid, info: WorkbookInfo | null = null): Spec {
  const tab = ws.title
  const headerRow = findHeaderRow(ws)
  const maxCol = ws.maxCol
  const skuCols: number[] = []
  for (let c = 3; c <= maxCol; c++) if (!isBlank(ws.cell(headerRow, c).raw)) skuCols.push(c)
  const commonHeader = ws.cell(headerRow, 2).raw

  const banner: NonNullable<Spec['banner']> = {}
  const sections: Array<{ name: string; row: number; components: string[] }> = []
  const components: Array<SpecComponent & { fields: SpecField[] }> = []
  let current: (SpecComponent & { fields: SpecField[] }) | null = null
  let section: string | null = null
  let mode: 'banner' | 'component' | null = null

  const rows: number[] = []
  for (let r = headerRow + 1; r <= ws.maxRow; r++) rows.push(r)
  const rowHasValues = (r: number) => [2, ...skuCols].some((c) => !isBlank(ws.cell(r, c).raw))
  const nextIsHeader = (i: number): boolean => {
    for (const r2 of rows.slice(i + 1)) {
      const a2 = ws.cell(r2, 1).raw
      const hv = rowHasValues(r2)
      if (isBlank(a2) && !hv) continue
      const k = FILL_KIND[ws.cell(r2, 1).fill ?? '']
      if (k === 'component' || k === 'section') return true
      if (k === 'field') return false
      return textKind(a2, hv) === 'header'
    }
    return false
  }

  rows.forEach((r, i) => {
    const a = ws.cell(r, 1)
    const hasValues = rowHasValues(r)
    if (isBlank(a.raw) && !hasValues) return
    const aText = isBlank(a.raw) ? '' : pyStr(a.raw as Exclude<RawValue, null>).trim()
    const tk = textKind(a.raw, hasValues)
    const fillKind = FILL_KIND[a.fill ?? '']
    if (tk === 'values_only') return

    let kind: 'component' | 'section' | 'field'
    if (fillKind === 'component' || fillKind === 'section' || fillKind === 'field') {
      kind = fillKind
    } else if (tk === 'header') {
      kind = nextIsHeader(i) ? 'section' : 'component'
    } else {
      kind = 'field'
    }

    if (kind === 'section') {
      section = aText
      sections.push({ name: aText, row: r, components: [] })
      current = null
      mode = null
      return
    }
    if (kind === 'component') {
      if (norm(aText) === 'banner') {
        mode = 'banner'
        current = null
        return
      }
      current = { header: aText, section, row: r, fields: [] }
      components.push(current)
      const last = sections[sections.length - 1]
      if (last && section === last.name) last.components.push(aText)
      mode = 'component'
      return
    }

    const name = aText
    if (mode === 'banner') {
      const b = ws.cell(r, 2)
      const entry: { row: number; common: Cell | null; [col: string]: unknown } = {
        row: r,
        common: isBlank(b.raw) ? null : cellRecord(b, name, false),
      }
      for (const c of skuCols) entry[colLetter(c)] = cellRecord(ws.cell(r, c), name, false)
      banner[name] = entry
      return
    }
    if (mode !== 'component' || current === null) return
    const b = ws.cell(r, 2)
    const bySku: Record<string, Cell> = {}
    for (const c of skuCols) bySku[colLetter(c)] = cellRecord(ws.cell(r, c), name, true)
    ;(current as SpecComponent).fields.push({
      name,
      row: r,
      common: isBlank(b.raw) ? null : cellRecord(b, name, true),
      by_sku: bySku,
    })
  })

  const names = (banner['Product Name'] ?? {}) as Record<string, Cell | undefined>
  const skus = skuCols.map((c) => {
    const column = colLetter(c)
    const header = pyStr(ws.cell(headerRow, c).raw as Exclude<RawValue, null>).trim()
    const rec = names[column]
    const pname = rec && rec.value !== null && rec.value !== undefined && !rec.placeholder ? String(rec.value) : null
    let inScope: boolean
    let reason: string
    if (!UNRENAMED_HEADER.test(header)) {
      inScope = true
      reason = 'header renamed'
    } else if (pname) {
      inScope = true
      reason = 'header not renamed; Product Name filled'
    } else {
      inScope = false
      reason = 'header not renamed and Product Name pending'
    }
    return { column, header, name: pname, in_scope: inScope, scope_reason: reason }
  })

  const collection = ((banner['Collection']?.common ?? null) as Cell | null)?.value ?? null
  return {
    schema: 1,
    workbook: info,
    tab,
    slug: tabSlug(tab),
    collection,
    header_row: headerRow,
    common_header: commonHeader === null ? null : pyStr(commonHeader),
    skus,
    banner,
    sections,
    components,
  }
}

// ------------------------------------------------------------------ the xlsx, read with SheetJS

function fillOf(cell: XLSX.CellObject | undefined): string | null {
  const s = (cell as { s?: { patternType?: string; fgColor?: { rgb?: string; theme?: number; indexed?: number } } } | undefined)?.s
  if (!s || !s.patternType || s.patternType === 'none') return null
  const fg = s.fgColor
  if (!fg) return null
  if (typeof fg.rgb === 'string') {
    const rgb = fg.rgb.toUpperCase()
    return rgb.length === 6 ? `FF${rgb}` : rgb
  }
  if (typeof fg.theme === 'number') return `theme:${fg.theme}`
  if (typeof fg.indexed === 'number') return `indexed:${fg.indexed}`
  return null
}

function rawOf(cell: XLSX.CellObject | undefined): RawValue {
  if (!cell) return null
  switch (cell.t) {
    case 's':
      return typeof cell.v === 'string' ? cell.v : cell.v === undefined ? null : String(cell.v)
    case 'b':
      return !!cell.v
    case 'e':
      return cell.w ?? null
    case 'n': {
      const v = cell.v as number
      if (typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z)) {
        const p = XLSX.SSF.parse_date_code(v)
        if (p) {
          // openpyxl: a serial under one day is a time of day (its str()), anything else a datetime.
          if (v >= 0 && v < 1) return `${pad(p.H)}:${pad(p.M)}:${pad(p.S)}`
          return { kind: 'date', y: p.y, m: p.m, d: p.d, time: { H: p.H, M: p.M, S: p.S } }
        }
      }
      return v
    }
    case 'd': {
      const d = cell.v instanceof Date ? cell.v : new Date(String(cell.v))
      return { kind: 'date', y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), time: { H: d.getHours(), M: d.getMinutes(), S: d.getSeconds() } }
    }
    default:
      return null
  }
}

/** One SheetJS worksheet as the grid `parseTab` reads, with openpyxl's value types and fills. */
export function gridFromSheet(ws: XLSX.WorkSheet, title: string): SheetGrid {
  let maxRow = 0
  let maxCol = 0
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue
    const at = XLSX.utils.decode_cell(key)
    maxRow = Math.max(maxRow, at.r + 1)
    maxCol = Math.max(maxCol, at.c + 1)
  }
  return {
    title,
    maxRow,
    maxCol,
    cell(row, col) {
      const c = ws[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as XLSX.CellObject | undefined
      return { raw: rawOf(c), fill: fillOf(c) }
    },
  }
}

// ------------------------------------------------------------------ the workbook's own identity

/** workbook.py's core_modified: the save time the file itself records (docProps/core.xml), or null. */
export function coreModified(bytes: Buffer | Uint8Array): string | null {
  let cfb: ReturnType<typeof XLSX.CFB.read>
  try {
    cfb = XLSX.CFB.read(Buffer.from(bytes), { type: 'buffer' })
  } catch {
    return null
  }
  const at = cfb.FullPaths.findIndex((p: string) => p.toLowerCase().endsWith('/docprops/core.xml'))
  if (at < 0) return null
  const content = cfb.FileIndex[at]?.content
  if (!content) return null
  const xml = Buffer.from(content as Uint8Array).toString('utf8')
  const m = /<dcterms:modified[^>]*>([^<]+)</.exec(xml)
  return m ? m[1].trim() : null
}

/** An ISO time to the second in UTC, as workbook.py writes an upload's Last-Modified. */
export function isoSeconds(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const MODIFIED_FROM_FILE = "docProps/core.xml: the file's last save"
export const MODIFIED_FROM_UPLOAD =
  "the upload's Last-Modified in Vesper's storage: the file carries no save time of its own, so this is when it was uploaded, not when it was edited"

/**
 * workbook.py's workbook_info for an upload kept in Vesper: the file name, the sha256 of its
 * bytes, and the modified time with where it came from. The spec-fields.md contract: "The
 * modified time is the workbook's own property as read. For a downloaded workbook that is the
 * download or re-save time, not Damien's last edit, so the footer names where the time came
 * from." So: the file's own save time (docProps/core.xml) when it has one, else the stored
 * upload's own Last-Modified, the time workbook.py reads from the same upload. Never the import
 * row's clock, and never the export time. With neither, the time is null and a PDF refuses.
 */
export function workbookInfoForUpload(args: { bytes: Buffer | Uint8Array; fileName: string; storedLastModified: Date | null }): WorkbookInfo {
  const sha256 = crypto.createHash('sha256').update(args.bytes).digest('hex')
  const own = coreModified(args.bytes)
  if (own) return { file: args.fileName, sha256, modified: own, modified_source: MODIFIED_FROM_FILE }
  if (args.storedLastModified && !Number.isNaN(args.storedLastModified.getTime())) {
    return { file: args.fileName, sha256, modified: isoSeconds(args.storedLastModified), modified_source: MODIFIED_FROM_UPLOAD }
  }
  return { file: args.fileName, sha256, modified: null, modified_source: 'none: the file carries no save time and the stored upload has no Last-Modified' }
}

// ------------------------------------------------------------------ one SKU's cells

export interface SkuFailure {
  row: number
  where: string
  what: string
  raw: unknown
  why: string
}

function hasValueRec(rec: Cell | null | undefined): rec is Cell {
  return !!rec && rec.value !== null && rec.value !== undefined
}

/** workbook.py's _pending: empty, or a placeholder that means pending. */
function pendingRec(rec: Cell | null | undefined): boolean {
  if (!rec || rec.value === null || rec.value === undefined) return true
  const rule = rec.placeholder
  return rule !== null && rule !== undefined && !NOT_APPLICABLE.has(rule)
}

/**
 * workbook.py's check_sku: (failures, notes) for one SKU column. A failure blocks: a yellow cell
 * that is empty or holds a pending placeholder, or a component with no code in any field and no
 * not-applicable marker. A component whose only colour is a colour word is a note, and a failure
 * under `strict`.
 */
export function checkSku(spec: Spec, col: string, part: 'all' | 'banner' | 'components' = 'all', strict = false): { fails: SkuFailure[]; notes: SkuFailure[] } {
  const fails: SkuFailure[] = []
  const notes: SkuFailure[] = []
  const tab = spec.tab
  if (part === 'all' || part === 'banner') {
    for (const [fname, entry] of Object.entries(spec.banner ?? {})) {
      const rec = (entry as Record<string, unknown>)[col] as Cell | null | undefined
      if (rec && rec.required && pendingRec(rec)) {
        const why = rec.value === null || rec.value === undefined ? 'empty' : `pending (${rec.placeholder})`
        fails.push({ row: entry.row, where: `${tab}!${col}${entry.row}`, what: `BANNER · ${fname}`, raw: rec.raw ?? null, why })
      }
    }
  }
  if (part === 'all' || part === 'components') {
    for (const comp of spec.components) {
      for (const f of comp.fields) {
        const rec = f.by_sku[col]
        if (rec && rec.required && pendingRec(rec)) {
          const why = rec.value === null || rec.value === undefined ? 'empty' : `pending (${rec.placeholder})`
          fails.push({ row: f.row, where: `${tab}!${col}${f.row}`, what: `${comp.header} · ${f.name}`, raw: rec.raw ?? null, why })
        }
      }
      const recs = comp.fields.map((f) => effective(f, col)).filter((r): r is Cell => r !== null)
      if (recs.some((r) => (r.codes ?? []).length > 0)) continue
      if (recs.some((r) => r.placeholder !== null && r.placeholder !== undefined && NOT_APPLICABLE.has(r.placeholder))) continue
      const named = recs.filter((r) => !r.placeholder && hasValueRec(r) && hasColourWord(r.value)).map((r) => String(r.value))
      const entry: SkuFailure = { row: comp.row, where: `${tab}!A${comp.row}`, what: comp.header, raw: null, why: '' }
      if (named.length) {
        entry.why = 'no code in any field; a colour in words only: ' + named.join('; ')
        ;(strict ? fails : notes).push(entry)
      } else {
        entry.why = "no code in any field and no ' / ' or 'N/A' to say none applies"
        fails.push(entry)
      }
    }
  }
  return { fails, notes }
}

/**
 * Every product tab of a workbook, by its tab name. The README and the textile library are not
 * product tabs; the spec check never reads them.
 */
export function parseWorkbookBytes(bytes: Buffer | Uint8Array, info: WorkbookInfo | null = null): Record<string, Spec> {
  const wb = XLSX.read(bytes, { type: 'buffer', cellStyles: true, cellNF: true, cellDates: false })
  const out: Record<string, Spec> = {}
  for (const title of wb.SheetNames) {
    const n = norm(title)
    if (SKIP_TABS.has(n) || n === TEXTILE_TAB) continue
    const ws = wb.Sheets[title]
    if (!ws) continue
    out[title] = parseTab(gridFromSheet(ws, title), info)
  }
  return out
}
