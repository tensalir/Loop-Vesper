/**
 * The CMF spec check: a CMF PDF, or the values a PDF would print, against the sheet, value by
 * value. A port of the plugin repository's `workstreams/cmf/scripts/spec_diff.py`, held to it by
 * `tests/fixtures/cmf/spec-diff-parity.json` (rows, counts, assertions and the expected-case match,
 * on the real 2026-09-22 export and on the repository's synthetic cases).
 *
 * The contract is the CMF review skill's `references/spec-fields.md`: every printed value is a
 * sheet cell, copied. Strings are compared exactly once runs of whitespace are one space; a colour
 * field is also compared as its code set plus its colour words. Every compared value gets a state
 * (`match`, `mismatch`, `missing_in_pdf`, `empty_in_sheet`, `extra_in_pdf`) and, where the class is
 * recognisable, a cause slug. Code does this, never a model: "no LLM touches values".
 */

import { colourName, extractCodes, NOT_APPLICABLE } from './codes'

export const BANNER = ['CMF number', 'Collection', 'Product Name', 'Product Code', 'EAN code', 'Edit Date', 'Drawn by', 'Checked by 1', 'Checked by 2']
export const VESPER_HEADER = ['CMF NUMBER', 'COLLECTION', 'PRODUCT NAME', 'PRODUCT CODE', 'EAN CODE', 'EDIT DATE', 'DRAWN', 'CHECKED', 'CHECKED']
export const OURS_HEADER = ['CMF number', 'Collection', 'Product name', 'Product code', 'EAN code', 'Edit date', 'Drawn', 'Checked', 'Checked']
export const VESPER_LABELS = ['Material', 'Finish', 'Colour', 'Artwork']
export const VESPER_BREAKDOWN_LABELS = ['MATERIAL', 'FINISH', 'TECHNIQUE']
const PRIMARY_FINISH = new Set(['finish', 'finishing', 'outer surface finish', 'shell finishing'])
const EMPTY_MARKS = new Set(['—', '–'])

export const STATES = ['match', 'mismatch', 'missing_in_pdf', 'empty_in_sheet', 'extra_in_pdf'] as const
export type State = (typeof STATES)[number]

// spec-fields.md's names for the classes, as the spec cases write them.
const CAUSE_PHRASES: Record<string, string[]> = {
  'a placeholder printed as a value': ['placeholder_replaced'],
  'words added before the value': ['prefixed_text'],
  'placeholder in the sheet': ['placeholder_in_sheet'],
  'export date': ['export_date'],
  'exporting user': ['exporting_user'],
  'checked lost': ['checked_lost'],
  'component renamed': ['component_renamed'],
  'blank colour': ['blank_colour'],
  'notes under artwork': ['notes_under_artwork'],
  'a field read as another': ['field_read_as_another'],
  'truncated code': ['truncated_code', 'compound_cell_reduced'],
  'no traceability': ['no_traceability'],
  'legend not from the key': ['legend_not_from_key'],
}

// ------------------------------------------------------------------ the sheet's shapes

export interface Cell {
  raw?: string | null
  value?: unknown
  placeholder?: string | null
  required?: boolean
  codes?: Array<{ raw: string }>
  [k: string]: unknown
}

export interface SpecField {
  name: string
  row: number
  common: Cell | null
  by_sku: Record<string, Cell | null | undefined>
}

export interface SpecComponent {
  header: string
  section?: string | null
  row: number
  fields: SpecField[]
}

export interface Spec {
  tab: string
  workbook?: { file?: string | null; sha256?: string | null; modified?: string | null } | null
  skus: Array<{ column: string; header?: string | null; name?: string | null; [k: string]: unknown }>
  banner?: Record<string, { row: number; common?: Cell | null; [col: string]: unknown }>
  components: SpecComponent[]
  [k: string]: unknown
}

export interface Printed {
  header?: Record<string, string> | null
  components?: Record<string, Record<string, string> | null> | null
  footer?: { workbook?: string | null; modified?: string | null; sha256?: string | null } | null
  legend?: string[] | null
  [k: string]: unknown
}

export interface Row {
  tab: string
  column: string | null
  sku_name: string | null | undefined
  part: string
  component: string
  field: string
  pdf_label: string | null
  sheet: string | null
  pdf: string | null
  state: State
  cause: string | null
  where: string | null
}

export interface ClownKey {
  zones?: Array<{ components?: Array<string | { component?: string }> }>
}

// ------------------------------------------------------------------ text

/** Runs of whitespace as one space, trimmed; nothing for null. */
export function collapse(text: unknown): string {
  if (text === null || text === undefined) return ''
  return pyStr(text).replace(/\s+/g, ' ').trim()
}

function pyStr(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

export function norm(text: unknown): string {
  return collapse(text).toLowerCase()
}

/** A heading folded for finding a block: case, dash kind and spaces ignored. */
export function headingKey(text: unknown): string {
  const t = collapse(text).replace(/—/g, '-').replace(/–/g, '-').toLowerCase()
  return t.replace(/\s*-\s*/g, '-')
}

function has(obj: object | null | undefined, key: string): boolean {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key)
}

// ------------------------------------------------------------------ the sheet side

function hasValue(rec: Cell | null | undefined): boolean {
  return rec !== null && rec !== undefined && rec.value !== null && rec.value !== undefined
}

/** workbook.effective: the SKU's own cell when filled, else Common specs, never for a yellow one. */
export function effective(field: SpecField, col: string): Cell | null {
  const own = field.by_sku[col] ?? null
  if (own && hasValue(own)) return own
  if (own && own.required) return null
  return field.common && hasValue(field.common) ? field.common : null
}

function bannerRecord(spec: Spec, field: string, col: string): [Cell | null, string | null] {
  const entry = (spec.banner ?? {})[field]
  if (entry === undefined || entry === null) return [null, null]
  const own = (entry[col] ?? null) as Cell | null
  if (own && hasValue(own)) return [own, `${spec.tab}!${col}${entry.row}`]
  if (own && own.required) return [own, `${spec.tab}!${col}${entry.row}`]
  const common = (entry.common ?? null) as Cell | null
  if (common && hasValue(common)) return [common, `${spec.tab}!B${entry.row}`]
  return [own, `${spec.tab}!${col}${entry.row}`]
}

function fieldRecord(spec: Spec, field: SpecField, col: string): [Cell | null, string] {
  const own = field.by_sku[col] ?? null
  const rec = effective(field, col)
  if (rec === null) return [own, `${spec.tab}!${col}${field.row}`]
  const whereCol = own !== null && rec === own ? col : 'B'
  return [rec, `${spec.tab}!${whereCol}${field.row}`]
}

function isBlocking(rec: Cell | null): boolean {
  if (!rec || !rec.required) return false
  if (rec.value === null || rec.value === undefined) return true
  return rec.placeholder !== null && rec.placeholder !== undefined && !NOT_APPLICABLE.has(rec.placeholder)
}

function sheetValue(rec: Cell | null): string {
  return !rec || rec.value === null || rec.value === undefined ? '' : collapse(rec.value)
}

function codesRaw(text: string): string[] {
  return extractCodes(text || '').map((c) => collapse(c.raw))
}

function isColourName(fieldName: string): boolean {
  const n = norm(fieldName)
  return n === 'colour' || n === 'color'
}

// ------------------------------------------------------------------ judging one value

function sortedEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

function same(sv: string, pv: string, colour: boolean): boolean {
  if (sv === pv) return true
  if (!colour) return false
  const sc = codesRaw(sv)
  const pc = codesRaw(pv)
  if (!sc.length || !sortedEqual(sc, pc)) return false
  return collapse(colourName(sv) ?? '') === collapse(colourName(pv) ?? '')
}

function causeFor(field: string, sv: string, pv: string): string | null {
  if (field === 'Edit Date' && /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/.test(pv)) return 'export_date'
  if (field === 'Drawn by' && pv.includes('@')) return 'exporting_user'
  const sc = codesRaw(sv)
  const pc = codesRaw(pv)
  if (sc.length) {
    const scSet = new Set(sc)
    const pcSet = new Set(pc)
    const properSubset = pc.length > 0 && Array.from(pcSet).every((c) => scSet.has(c)) && pcSet.size < scSet.size
    if (properSubset) return 'truncated_code'
    if (sv.startsWith(pv) && pv.length < sv.length) {
      if (extractCodes(sv).some((c) => c.span[1] > pv.length)) return 'truncated_code'
    }
    for (const s of sc) {
      for (const p of [...pc, pv]) {
        if (p && s !== p && s.startsWith(p)) return 'truncated_code'
      }
    }
    const sameSet = pcSet.size === scSet.size && Array.from(pcSet).every((c) => scSet.has(c))
    if (pc.length && sameSet && sv.includes(pv) && pv !== sv) return 'compound_cell_reduced'
  }
  if (pv.endsWith(sv) && pv.length > sv.length) return 'prefixed_text'
  return null
}

function judge(rec: Cell | null, pvRaw: unknown, field: string, colour = false): [State, string | null] {
  const sv = sheetValue(rec)
  let pv = collapse(pvRaw)
  if (EMPTY_MARKS.has(pv)) pv = ''
  if (isBlocking(rec)) {
    if (sv && pv === sv) return ['empty_in_sheet', null]
    if (sv === '') return ['empty_in_sheet', null]
    if (pv === '') return ['empty_in_sheet', field.startsWith('Checked by') ? 'checked_lost' : 'placeholder_in_sheet']
    return ['empty_in_sheet', 'placeholder_replaced']
  }
  if (sv === '') return pv === '' ? ['match', null] : ['extra_in_pdf', null]
  if (pv === '') return ['missing_in_pdf', null]
  if (same(sv, pv, colour)) return ['match', null]
  return ['mismatch', causeFor(field, sv, pv)]
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** An email address printed on a PDF (Vesper's Drawn cell) is named, never copied. */
function redact(text: string | null): string | null {
  if (text === null || text === undefined) return null
  return String(text).replace(EMAIL, '(an email address)')
}

function row(
  spec: Spec,
  col: string | null,
  skuName: string | null | undefined,
  part: string,
  component: string,
  field: string,
  sheet: string | null,
  pdf: string | null,
  state: State,
  cause: string | null,
  where: string | null = null,
  pdfLabel: string | null = null
): Row {
  return {
    tab: spec.tab,
    column: col,
    sku_name: skuName,
    part,
    component,
    field,
    pdf_label: pdfLabel,
    sheet,
    pdf: redact(pdf),
    state,
    cause,
    where,
  }
}

// ------------------------------------------------------------------ comparing one SKU

function findBlock(printed: Record<string, unknown>, header: string): [string | null, boolean] {
  if (has(printed, header)) return [header, true]
  const want = headingKey(header)
  for (const label of Object.keys(printed)) if (headingKey(label) === want) return [label, false]
  return [null, false]
}

/** `Outer Shell: a · Inner Shell: b` as {name: value}. */
function notesSegments(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const seg of collapse(text).split(' · ')) {
    const m = /^([^:]{1,60}):\s*([\s\S]*)$/.exec(seg)
    if (m) out[m[1].trim()] = m[2].trim()
  }
  return out
}

function compareHeader(spec: Spec, col: string, skuName: string | null | undefined, printed: Printed): Row[] {
  const rows: Row[] = []
  const header = printed.header ?? {}
  for (const field of BANNER) {
    const [rec, where] = bannerRecord(spec, field, col)
    if (rec === null && !has(header, field)) continue
    const pv = has(header, field) ? header[field] : null
    const [state, cause] = judge(rec, pv, field)
    rows.push(row(spec, col, skuName, 'header', 'BANNER', field, sheetValue(rec), pv !== null && pv !== undefined ? collapse(pv) : null, state, cause, where))
  }
  return rows
}

function compareBlockExact(spec: Spec, col: string, skuName: string | null | undefined, comp: SpecComponent, block: Record<string, string>): Row[] {
  const rows: Row[] = []
  const seen = new Set<string>()
  const lower: Record<string, string> = {}
  for (const k of Object.keys(block)) lower[norm(k)] = k
  for (const f of comp.fields) {
    const [rec, where] = fieldRecord(spec, f, col)
    const label = has(block, f.name) ? f.name : has(lower, norm(f.name)) ? lower[norm(f.name)] : null
    const pv = label ? block[label] : null
    if (label) seen.add(label)
    const colour = isColourName(f.name) || !!(rec?.codes && rec.codes.length)
    const [state, cause] = judge(rec, pv, f.name, colour)
    rows.push(row(spec, col, skuName, 'component', comp.header, f.name, sheetValue(rec), pv !== null && pv !== undefined ? collapse(pv) : null, state, cause, where, label))
  }
  const values = new Set(comp.fields.map((f) => sheetValue(fieldRecord(spec, f, col)[0])))
  for (const [label, pv] of Object.entries(block)) {
    const c = collapse(pv)
    if (seen.has(label) || c === '' || EMPTY_MARKS.has(c)) continue
    const cause = values.has(c) ? 'field_read_as_another' : null
    rows.push(row(spec, col, skuName, 'component', comp.header, label, '', c, 'extra_in_pdf', cause, null, label))
  }
  return rows
}

function compareBlockVesper(spec: Spec, col: string, skuName: string | null | undefined, comp: SpecComponent, block: Record<string, string>): Row[] {
  const rows: Row[] = []
  const slots: Record<string, string> = {}
  for (const [k, v] of Object.entries(block)) slots[k] = EMPTY_MARKS.has(collapse(v)) ? '' : collapse(v)
  const slot = (k: string) => (has(slots, k) ? slots[k] : '')
  const artworkNotes = notesSegments(slot('Artwork'))
  const fields = comp.fields
  const material = fields.find((f) => norm(f.name) === 'material') ?? null
  const finish = fields.find((f) => PRIMARY_FINISH.has(norm(f.name))) ?? null
  const colour = fields.find((f) => isColourName(f.name)) ?? null
  const artwork = fields.find((f) => norm(f.name) === 'artwork') ?? null
  const ownSlot = new Map<string, string>()
  for (const [f, s] of [
    [material, 'Material'],
    [finish, 'Finish'],
    [colour, 'Colour'],
    [artwork, 'Artwork'],
  ] as Array<[SpecField | null, string]>) {
    if (f !== null) ownSlot.set(f.name, s)
  }
  const accounted = new Set(ownSlot.values())
  const otherValues = new Set(fields.filter((f) => f !== artwork).map((f) => sheetValue(fieldRecord(spec, f, col)[0])))

  for (const f of fields) {
    const [rec, where] = fieldRecord(spec, f, col)
    const sv = sheetValue(rec)
    const own = ownSlot.get(f.name)
    if (own) {
      const pv = slot(own)
      const isCol = own === 'Colour' || !!(rec?.codes && rec.codes.length)
      let [state, cause] = judge(rec, pv, f.name, isCol)
      if (own === 'Artwork' && state === 'mismatch' && (Object.keys(artworkNotes).length > 0 || otherValues.has(pv))) {
        cause = 'notes_under_artwork'
      } else if (state === 'missing_in_pdf') {
        if (has(artworkNotes, f.name)) cause = 'notes_under_artwork'
        else if (own === 'Colour') cause = 'blank_colour'
      }
      rows.push(row(spec, col, skuName, 'component', comp.header, f.name, sv, pv, state, cause, where, own))
      continue
    }
    if (sv === '' && !isBlocking(rec)) {
      rows.push(row(spec, col, skuName, 'component', comp.header, f.name, '', '', 'match', null, where, null))
      continue
    }
    if (isBlocking(rec)) {
      const [state, cause] = judge(rec, '', f.name)
      rows.push(row(spec, col, skuName, 'component', comp.header, f.name, sv, '', state, cause, where, null))
      continue
    }
    let foundSlot: string | null = null
    let cause: string | null = null
    if (has(artworkNotes, f.name) && collapse(artworkNotes[f.name]) === sv) {
      foundSlot = 'Artwork'
      cause = 'notes_under_artwork'
    } else if (has(slots, 'Artwork') && slots.Artwork === sv) {
      foundSlot = 'Artwork'
      cause = 'notes_under_artwork'
    } else {
      for (const s of VESPER_LABELS) {
        if (s !== 'Artwork' && has(slots, s) && slots[s] === sv) {
          foundSlot = s
          cause = 'field_read_as_another'
          break
        }
      }
    }
    let pdf: string | null
    if (foundSlot) {
      accounted.add(foundSlot)
      pdf = foundSlot === 'Artwork' ? (has(slots, 'Artwork') ? slots.Artwork : null) : `${foundSlot}: ${sv}`
    } else {
      pdf = ''
    }
    rows.push(row(spec, col, skuName, 'component', comp.header, f.name, sv, pdf, 'missing_in_pdf', cause, where, foundSlot))
  }

  // Vesper's Colour label on a component whose sheet has no Colour field: the component's codes,
  // wherever the sheet writes them, are what belongs there.
  if (colour === null) {
    const found: string[] = []
    for (const f of fields) {
      const [rec] = fieldRecord(spec, f, col)
      for (const c of rec?.codes ?? []) {
        const r = collapse(c.raw)
        if (!found.includes(r)) found.push(r)
      }
    }
    const pv = slot('Colour')
    if (found.length) {
      const sv = found.join(' + ')
      accounted.add('Colour')
      let state: State
      let cause: string | null
      if (pv === '') {
        state = 'missing_in_pdf'
        cause = 'blank_colour'
      } else if (same(sv, pv, true)) {
        state = 'match'
        cause = null
      } else {
        state = 'mismatch'
        cause = causeFor('Colour', sv, pv)
      }
      rows.push(row(spec, col, skuName, 'component', comp.header, 'Colour', sv, pv, state, cause, null, 'Colour'))
    }
  }
  for (const s of VESPER_LABELS) {
    const pv = slot(s)
    if (accounted.has(s) || pv === '') continue
    rows.push(row(spec, col, skuName, 'component', comp.header, s, '', pv, 'extra_in_pdf', null, null, s))
  }
  return rows
}

function compareComponents(spec: Spec, col: string, skuName: string | null | undefined, printed: Printed, layout: string): Row[] {
  const rows: Row[] = []
  const comps = (printed.components ?? {}) as Record<string, Record<string, string> | null>
  const used = new Set<string>()
  for (const comp of spec.components) {
    const [label, exact] = findBlock(comps, comp.header)
    if (label === null) {
      rows.push(row(spec, col, skuName, 'component', comp.header, '(heading)', comp.header, null, 'missing_in_pdf', null, `${spec.tab}!A${comp.row}`))
      for (const f of comp.fields) {
        const [rec, where] = fieldRecord(spec, f, col)
        const [state, cause] = judge(rec, null, f.name)
        rows.push(row(spec, col, skuName, 'component', comp.header, f.name, sheetValue(rec), null, state, cause, where))
      }
      continue
    }
    used.add(label)
    if (!exact) {
      rows.push(row(spec, col, skuName, 'component', comp.header, '(heading)', comp.header, label, 'mismatch', 'component_renamed', `${spec.tab}!A${comp.row}`))
    }
    const block = comps[label] ?? {}
    rows.push(...(layout === 'vesper' ? compareBlockVesper(spec, col, skuName, comp, block) : compareBlockExact(spec, col, skuName, comp, block)))
  }
  for (const [label, block] of Object.entries(comps)) {
    if (used.has(label)) continue
    for (const [fname, pv] of Object.entries(block ?? {})) {
      const c = collapse(pv)
      if (c && !EMPTY_MARKS.has(c)) rows.push(row(spec, col, skuName, 'component', label, fname, '', c, 'extra_in_pdf', null, null, fname))
    }
  }
  return rows
}

function compareFooter(spec: Spec, col: string, skuName: string | null | undefined, printed: Printed): Row[] {
  const wb = spec.workbook ?? {}
  const ft = printed.footer ?? {}
  const rows: Row[] = []
  for (const [field, wantRaw] of [
    ['workbook', wb.file],
    ['modified', wb.modified],
    ['sha256', wb.sha256],
  ] as Array<[string, unknown]>) {
    const raw = (ft as Record<string, unknown>)[field]
    const got = raw !== null && raw !== undefined ? collapse(raw) : ''
    const want = collapse(wantRaw)
    let state: State
    let cause: string | null
    if (got === '') {
      state = 'missing_in_pdf'
      cause = 'no_traceability'
    } else if (field === 'sha256') {
      const ok = got.length >= 12 && want.startsWith(got.toLowerCase())
      state = ok ? 'match' : 'mismatch'
      cause = null
    } else {
      state = got === want ? 'match' : 'mismatch'
      cause = null
    }
    rows.push(row(spec, col, skuName, 'footer', 'FOOTER', field, want, got, state, cause))
  }
  return rows
}

export function expectedLegend(spec: Spec, key: ClownKey | null): string[] {
  if (key) {
    const out: string[] = []
    for (const z of key.zones ?? []) {
      for (const e of z.components ?? []) {
        const name = typeof e === 'string' ? e : e?.component
        if (name && !out.includes(name)) out.push(name)
      }
    }
    return out
  }
  return spec.components.map((c) => c.header)
}

export function compareLegend(spec: Spec, legend: string[] | null | undefined, key: ClownKey | null): Row {
  const want = expectedLegend(spec, key)
  const got = legend !== null && legend !== undefined ? legend.map((x) => collapse(x)) : null
  let state: State
  let cause: string | null
  if (got === null || got.length === 0) {
    state = 'missing_in_pdf'
    cause = 'legend_not_from_key'
  } else if (got.length === want.length && got.every((g, i) => g === want[i])) {
    state = 'match'
    cause = null
  } else {
    state = 'mismatch'
    cause = 'legend_not_from_key'
  }
  return row(spec, null, null, 'legend', 'LEGEND', 'order', want.join(' | '), got && got.length ? got.join(' | ') : null, state, cause)
}

export function compareSku(spec: Spec, col: string, printed: Printed, layout: string): Row[] {
  const sku = spec.skus.find((s) => s.column === col) ?? ({} as Spec['skus'][number])
  const name = sku.name
  return [...compareHeader(spec, col, name, printed), ...compareComponents(spec, col, name, printed, layout), ...compareFooter(spec, col, name, printed)]
}

// ------------------------------------------------------------------ reading a PDF's lines

const FOOTER_MARK = /^--\s*\d+\s+of\s+\d+\s*--$/

function collect(lines: string[], start: number, stops: (line: string, index: number) => boolean): [string, number] {
  const out: string[] = []
  let i = start
  while (i < lines.length && !stops(lines[i], i)) {
    out.push(lines[i])
    i++
  }
  return [collapse(out.join(' ')), i]
}

function pyTitle(s: string): string {
  return s.toLowerCase().replace(/(^|[^A-Za-z])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
}

export interface ParsedPage {
  header: Record<string, string>
  components: Record<string, Record<string, string>>
  footer: Printed['footer'] | null
  legend: string[] | null
  kind: 'sku' | 'breakdown'
  title: string | null
  footer_text?: string | null
  clown_label?: string | null
}

export function parseVesperPage(lines: string[]): ParsedPage {
  const page: ParsedPage = { header: {}, components: {}, footer: null, legend: null, kind: 'sku', title: null }
  const body = lines.filter((ln) => !FOOTER_MARK.test(ln))
  page.footer_text = lines.find((ln) => FOOTER_MARK.test(ln)) ?? null
  let i = 0
  const endHeader = /^(CMF Page \d+|Part Break Down)$/
  for (let k = 0; k < VESPER_HEADER.length; k++) {
    const label = VESPER_HEADER[k]
    while (i < body.length && body[i] !== label) i++
    if (i >= body.length) break
    const nxt = k + 1 < VESPER_HEADER.length ? VESPER_HEADER[k + 1] : null
    const [value, j] = collect(body, i + 1, (ln) => (nxt ? ln === nxt : endHeader.test(ln)))
    i = j
    page.header[BANNER[k]] = EMPTY_MARKS.has(value) ? '' : value
  }
  let rest = body.slice(i)
  let labels: string[]
  if (rest.length && rest[0] === 'Part Break Down') {
    page.kind = 'breakdown'
    labels = VESPER_BREAKDOWN_LABELS
    let j = 1
    if (j < rest.length && rest[j].toLowerCase() === 'part break down') j++
    page.clown_label = j < rest.length ? rest[j] : null
    j++
    if (j < rest.length && rest[j] === 'Colour legend') j++
    const legend: string[] = []
    while (j < rest.length && !(j + 1 < rest.length && rest[j + 1] === labels[0])) {
      legend.push(rest[j])
      j++
    }
    page.legend = legend
    rest = rest.slice(j)
  } else {
    labels = VESPER_LABELS
    rest = rest.filter((ln) => !/^CMF Page \d+$/.test(ln) && ln !== 'Product render')
  }
  const heads: number[] = []
  for (let j = 0; j < rest.length - 1; j++) if (rest[j + 1] === labels[0]) heads.push(j)
  heads.forEach((h, n) => {
    const stop = n + 1 < heads.length ? heads[n + 1] : rest.length
    const seg = rest.slice(h + 1, stop)
    const block: Record<string, string> = {}
    let j = 0
    labels.forEach((label, k) => {
      if (j < seg.length && seg[j] === label) {
        const nxt = k + 1 < labels.length ? labels[k + 1] : null
        const [value, jj] = collect(seg, j + 1, (ln) => nxt !== null && ln === nxt)
        j = jj
        block[page.kind === 'breakdown' ? pyTitle(label) : label] = EMPTY_MARKS.has(value) ? '' : value
      }
    })
    page.components[rest[h]] = block
  })
  const name = page.header['Product Name'] ?? ''
  page.title = name.includes(' · ') ? name.slice(name.lastIndexOf(' · ') + 3) : null
  return page
}

/** A page made to spec-fields.md (our own PDF, which does not exist yet). */
export function parseOursPage(lines: string[], spec: Spec): ParsedPage {
  const page: ParsedPage = { header: {}, components: {}, footer: null, legend: null, kind: 'sku', title: null }
  const text = lines.join('\n')
  const m = /(\S[^\n]*?) · modified (\S+) · sha256 ([0-9a-fA-F]{12,64})/.exec(text)
  if (m) page.footer = { workbook: m[1].trim(), modified: m[2], sha256: m[3].toLowerCase() }
  const body = lines.filter((ln) => !FOOTER_MARK.test(ln) && !ln.includes(' · sha256 '))
  const headers = spec.components.map((c) => c.header)
  const labels = new Set([...OURS_HEADER, ...headers])
  let i = 0
  for (let k = 0; k < OURS_HEADER.length; k++) {
    const label = OURS_HEADER[k]
    while (i < body.length && body[i] !== label) i++
    if (i >= body.length) break
    const [value, j] = collect(body, i + 1, (ln) => labels.has(ln) || ln.toLowerCase() === 'legend')
    i = j
    page.header[BANNER[k]] = value
  }
  const lowered = body.map((b) => b.toLowerCase())
  if (lowered.some((ln) => ln === 'part break down' || ln === 'legend')) {
    page.kind = 'breakdown'
    if (body.includes('Legend') || lowered.includes('legend')) {
      let j = lowered.indexOf('legend') + 1
      const legend: string[] = []
      while (j < body.length && !headers.includes(body[j])) {
        legend.push(body[j])
        j++
      }
      page.legend = legend
    }
  }
  const starts: number[] = []
  body.forEach((ln, j) => {
    if (headers.includes(ln)) starts.push(j)
  })
  starts.forEach((h, n) => {
    const comp = spec.components.find((c) => c.header === body[h])!
    const names = comp.fields.map((f) => f.name)
    const stop = n + 1 < starts.length ? starts[n + 1] : body.length
    const seg = body.slice(h + 1, stop)
    const block: Record<string, string> = {}
    let j = 0
    while (j < seg.length) {
      if (names.includes(seg[j])) {
        const [value, j2] = collect(seg, j + 1, (ln) => names.includes(ln))
        block[seg[j]] = value
        j = j2
      } else {
        j++
      }
    }
    page.components[body[h]] = block
  })
  const name = page.header['Product Name'] ?? ''
  page.title = name || null
  return page
}

export interface PrintedFromPages {
  byColumn: Record<string, Printed & { tab: string; column: string; page: number; footer_text: string | null | undefined }>
  legend: string[] | null
  notes: string[]
}

/** Every SKU page the PDF holds, by column, pages matched to columns by their title in order. */
export function printedFromPages(pages: string[][], spec: Spec, layout: 'vesper' | 'ours'): PrintedFromPages {
  const parsed = pages.map((p) => (layout === 'vesper' ? parseVesperPage(p) : parseOursPage(p, spec)))
  const legend = parsed.find((p) => p.legend !== null && p.legend !== undefined)?.legend ?? null
  const byColumn: PrintedFromPages['byColumn'] = {}
  const notes: string[] = []
  const used = new Map<string | null, number>()
  parsed.forEach((p, idx) => {
    const n = idx + 1
    if (p.kind !== 'sku') return
    const title = p.title
    const cols = spec.skus.filter((s) => collapse(s.name) === collapse(title)).map((s) => s.column)
    const k = used.get(title) ?? 0
    if (k >= cols.length) {
      notes.push(`page ${n}: title ${pyRepr(title)} names no remaining SKU column of ${spec.tab}`)
      return
    }
    used.set(title, k + 1)
    const col = cols[k]
    byColumn[col] = {
      tab: spec.tab,
      column: col,
      header: p.header,
      components: p.components,
      footer: p.footer,
      legend,
      page: n,
      footer_text: p.footer_text,
    }
  })
  return { byColumn, legend, notes }
}

function pyRepr(v: string | null): string {
  if (v === null) return 'None'
  return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

// ------------------------------------------------------------------ one whole check

export interface SpecCheck {
  rows: Row[]
  counts: Record<State, number>
  cells_compared: number
  assertions: { footer_names_sheet_and_time: boolean; legend_from_clown_key: boolean }
  clean: boolean
}

export function runSpecCheck(
  spec: Spec,
  printed: Record<string, Printed>,
  legend: string[] | null | undefined,
  columns: string[],
  layout: string,
  key: ClownKey | null = null
): SpecCheck {
  const rows: Row[] = []
  for (const col of columns) {
    if (!has(printed, col)) {
      const sku = spec.skus.find((s) => s.column === col)!
      rows.push(row(spec, col, sku.name, 'page', 'PAGE', '(page)', sku.name ?? null, null, 'missing_in_pdf', null, null))
      continue
    }
    rows.push(...compareSku(spec, col, printed[col], layout))
  }
  rows.push(compareLegend(spec, legend, key))
  const counts = Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => r.state === s).length])) as Record<State, number>
  const cells = rows.filter((r) => (r.part === 'header' || r.part === 'component') && r.field !== '(heading)').length
  const footerOk = rows.filter((r) => r.component === 'FOOTER').every((r) => r.state === 'match')
  const legendRow = rows[rows.length - 1]
  return {
    rows,
    counts,
    cells_compared: cells,
    assertions: { footer_names_sheet_and_time: footerOk, legend_from_clown_key: !!key && legendRow.state === 'match' },
    clean: rows.every((r) => r.state === 'match'),
  }
}

// ------------------------------------------------------------------ a spec case's expected rows

export interface ExpectedCase {
  mismatches?: Array<Record<string, unknown>>
  match_on?: string[]
  footer_names_sheet_and_time?: boolean
  legend_from_clown_key?: boolean
  [k: string]: unknown
}

export function expectedMatch(
  rows: Row[],
  expected: ExpectedCase | Array<Record<string, unknown>>,
  columns: string[],
  assertions: SpecCheck['assertions']
): [boolean, string[]] {
  const isDict = !Array.isArray(expected)
  let expRows = ((isDict ? (expected as ExpectedCase).mismatches : expected) ?? []) as Array<Record<string, unknown>>
  const matchOn = (isDict ? (expected as ExpectedCase).match_on : undefined) ?? ['tab', 'column', 'component', 'field', 'cause']
  let found = rows.filter((r) => r.state !== 'match' && r.component !== 'FOOTER' && r.component !== 'LEGEND')
  const hasAssert = isDict && ['footer_names_sheet_and_time', 'legend_from_clown_key'].some((k) => has(expected as object, k))
  if (!hasAssert) found = rows.filter((r) => r.state !== 'match')
  expRows = expRows.filter((e) => e.column === null || e.column === undefined || columns.includes(String(e.column)))

  const causes = (value: unknown): Array<string | null> => {
    if (value === null || value === undefined) return [null]
    return CAUSE_PHRASES[String(value).toLowerCase()] ?? [String(value)]
  }
  const hit = (e: Record<string, unknown>, r: Row) => {
    for (const k of matchOn) {
      if (!has(e, k)) continue
      if (k === 'cause') {
        if (!causes(e.cause).includes(r.cause)) return false
      } else if ((e[k] ?? null) !== ((r as unknown as Record<string, unknown>)[k] ?? null)) {
        return false
      }
    }
    return true
  }
  const problems: string[] = []
  const left = [...found]
  for (const e of expRows) {
    const at = left.findIndex((r) => hit(e, r))
    if (at < 0) {
      problems.push(`expected, not found: ${e.column ?? 'None'} ${e.component ?? 'None'} · ${e.field ?? 'None'} (${e.cause ?? 'None'})`)
    } else {
      left.splice(at, 1)
    }
  }
  for (const r of left) problems.push(`found, not expected: ${r.column ?? 'None'} ${r.component} · ${r.field} ${r.state} (${r.cause ?? 'None'})`)
  if (isDict) {
    for (const k of ['footer_names_sheet_and_time', 'legend_from_clown_key'] as const) {
      const e = expected as ExpectedCase
      if (has(e, k) && !!e[k] !== assertions[k]) {
        problems.push(`assertion ${k}: expected ${e[k] ? 'True' : 'False'}, found ${assertions[k] ? 'True' : 'False'}`)
      }
    }
  }
  return [problems.length === 0, problems]
}
