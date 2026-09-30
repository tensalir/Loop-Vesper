/**
 * THE ROW and THE KEY of a CMF grade, built by code from a parsed sheet and a clown key: a port of
 * `sku_row`, `row_lines` and `key_lines` in the product repository's
 * `workstreams/cmf/scripts/qa.py`, which `kit_parts.py` runs to write `kit/cmf-grading.json`.
 * Given the same spec, key and Pantone lookup it writes the same lines (`tests/cmf-grading-row.spec.ts`
 * holds it to the kit's committed parts).
 *
 * Why it is here (2026-09-30): a render made from a workbook upload was graded against the kit's
 * committed row, which is built from the workbook the kit was released with, not the one the
 * render was made from. With an upload named, the grade reads that upload's row instead, built
 * here from the same parse the prompt and the supplier PDF are built from.
 */

import { effective, type Cell, type Spec } from './spec-diff'
import type { ClownKeyFile } from './prompt-fill'
import type { CmfGradingParts } from './kit-cmf'

/** The owned Pantone lookup's `codes` (`pantone.json`): a hex only where a person confirmed one. */
export type PantoneLookup = Record<string, { hex?: string | null; confirmed_by?: string | null; [k: string]: unknown }>

interface RowCode {
  raw: string
  key: string | null
  system: string | null
  hex: string | null
}

interface RowField {
  name: string
  value: unknown
  empty_required?: boolean
  codes: RowCode[]
}

export interface GradingRow {
  tab: string
  column: string
  header: string | null
  sku_name: string | null
  components: Array<{ label: string; fields: RowField[]; codes: RowCode[] }>
}

/** qa._hex: upper case with #, `#??????` when there is none. */
function hexOf(value: unknown): string {
  const h = String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .toUpperCase()
  return h ? `#${h}` : '#??????'
}

/** Python's str() of a cell value. */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

/** qa._one_line: a cell on one line, a line break inside it shown as ` | `. */
function oneLine(value: unknown): string {
  return pyStr(value)
    .split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' | ')
}

/** qa.confirmed_hex: the sheet's own hex, or an entry in the lookup a person confirmed; never a guess. */
function confirmedHex(code: { system?: unknown; number?: unknown; key?: unknown }, pantone: PantoneLookup): string | null {
  if (code.system === 'hex' && code.number) return hexOf(code.number)
  const entry = pantone[String(code.key ?? '')] ?? {}
  const h = entry.hex
  return h && entry.confirmed_by ? hexOf(h) : null
}

function filled(own: Cell | null | undefined): own is Cell {
  return !!own && Object.keys(own).length > 0
}

/** qa.sku_row: every component with every field the sheet fills for the SKU, as written. */
export function gradingRow(spec: Spec, column: string, pantone: PantoneLookup): GradingRow {
  const sku = spec.skus.find((s) => s.column === column) ?? null
  const components = spec.components.map((comp) => {
    const fields: RowField[] = []
    const codes: RowCode[] = []
    const seen = new Set<string>()
    for (const f of comp.fields) {
      const own = (f.by_sku ?? {})[column]
      const rec = effective(f, column)
      if (rec === null) {
        if (filled(own) && own.required) fields.push({ name: f.name, value: null, empty_required: true, codes: [] })
        continue
      }
      const value = rec.raw !== null && rec.raw !== undefined ? rec.raw : rec.value
      const fcodes = ((rec.codes ?? []) as Array<Record<string, unknown>>).map((c) => ({
        raw: String(c.raw),
        key: (c.key as string | undefined) ?? null,
        system: (c.system as string | undefined) ?? null,
        hex: confirmedHex(c, pantone),
      }))
      fields.push({ name: f.name, value, codes: fcodes })
      for (const c of fcodes) {
        if (!seen.has(c.raw)) {
          seen.add(c.raw)
          codes.push(c)
        }
      }
    }
    return { label: comp.header, fields, codes }
  })
  return {
    tab: spec.tab,
    column,
    header: (sku?.header as string | null | undefined) ?? null,
    sku_name: (sku?.name as string | null | undefined) ?? null,
    components,
  }
}

/** qa.row_lines: THE ROW, one line per component, every field as the sheet writes it. */
export function rowLines(row: GradingRow): string[] {
  let head = `THE ROW: ${row.tab}, column ${row.column}`
  if (row.header) head += ` (${row.header})`
  if (row.sku_name) head += `, ${row.sku_name}`
  const out = [head + '. Every value as the sheet writes it; a line break inside a cell is shown as |.']
  for (const c of row.components) {
    const vals = c.fields.map((f) => `${f.name}: ${f.empty_required ? '(empty in the sheet, required)' : oneLine(f.value)}`)
    const codes = c.codes.length ? c.codes.map((k) => `${k.raw} (${k.hex ? `confirmed hex ${k.hex}` : 'no confirmed hex'})`).join(', ') : 'none in the row'
    out.push(`- ${c.label}: ${vals.join('; ') || 'no field filled'}. Codes: ${codes}.`)
  }
  return out
}

type KeyEntry = string | { component?: string; field?: string | null }

function entryParts(entry: KeyEntry): [string, string | null] {
  if (entry && typeof entry === 'object') return [String(entry.component ?? ''), entry.field ?? null]
  return [String(entry), null]
}

function entryLabel(entry: KeyEntry): string {
  const [comp, field] = entryParts(entry)
  return field ? `${comp} (${field})` : comp
}

/** qa.key_confirmed: confirmed by someone, with every zone named. */
export function keyConfirmed(key: ClownKeyFile | null | undefined): boolean {
  const zones = key?.zones ?? []
  return !!key?.confirmed_by && zones.length > 0 && zones.every((z) => (z.components ?? []).length > 0)
}

/** qa.key_lines: THE KEY. */
export function keyLines(key: ClownKeyFile | null, keyId: string | null, row: GradingRow | null): string[] {
  if (!key) {
    return [
      'THE KEY: none on file for this clown. Find each clown colour in image 2 yourself, match it to THE ROW by the part it paints, and say in the notes that no key was given.',
    ]
  }
  const cid = key.clown?.id || keyId
  const zones = key.zones ?? []
  const unnamed = zones.filter((z) => !(z.components ?? []).length)
  let head: string
  if (keyConfirmed(key)) {
    head = `THE KEY: clown ${cid}, confirmed by ${key.confirmed_by}`
    head += key.confirmed_at ? ` on ${key.confirmed_at}.` : '.'
  } else if (unnamed.length) {
    head =
      `THE KEY: clown ${cid}, a DRAFT: its colours were sampled by code and ${unnamed.length} of its ${zones.length} zones are not named yet. ` +
      "Use it as the map of where the clown's colours are; where a zone is not named, match it to THE ROW by the part it paints, and say so in the notes."
  } else {
    head =
      `THE KEY: clown ${cid}, every zone named but not yet confirmed by the lead CMF designer. ` +
      'Use it as the map of which zone is which part; where the picture plainly disagrees with it, say so in the notes.'
  }
  const out = [head]
  const mapped = new Set<string>()
  for (const z of zones) {
    const entries = [...((z.components ?? []) as KeyEntry[])]
    for (const e of entries) mapped.add(entryParts(e)[0])
    const note = z.note ? ` (${String(z.note)})` : ''
    out.push(`- zone ${hexOf(z.hex)} → ${entries.length ? entries.map(entryLabel).join(', ') : 'not named yet'}${note}`)
  }
  const absent = ((key.not_on_clown ?? []) as KeyEntry[]).map((e) => entryParts(e)[0])
  if (absent.length) out.push(`- not on this clown: ${absent.join(', ')}`)
  if (row && mapped.size) {
    const loose = row.components.map((c) => c.label).filter((l) => !mapped.has(l) && !absent.includes(l))
    if (loose.length) out.push(`- in THE ROW, not in the key: ${loose.join(', ')}`)
  }
  return out
}

/**
 * The grading parts for one SKU of one parsed sheet through one key, shaped like the kit's
 * `kit/cmf-grading.json` so the kit's grader assembles its prompt from them unchanged.
 */
export function gradingPartsFor(args: {
  spec: Spec
  specSlug: string
  column: string
  keyId: string
  key: ClownKeyFile
  pantone: PantoneLookup
  noKeyLines: string[]
}): CmfGradingParts {
  const row = gradingRow(args.spec, args.column, args.pantone)
  const rowKey = `${args.specSlug}--${args.column}`
  const draft = !keyConfirmed(args.key) && (args.key.zones ?? []).some((z) => !(z.components ?? []).length)
  return {
    rows: { [rowKey]: { spec: args.specSlug, tab: args.spec.tab, column: args.column, sku_name: row.sku_name, row_lines: rowLines(row) } },
    keys: { [`${rowKey}--${args.keyId}`]: { key: args.keyId, draft, key_lines: keyLines(args.key, args.keyId, row) } },
    no_key_lines: args.noKeyLines,
  }
}
