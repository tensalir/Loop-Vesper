/**
 * Damien's prompt template, filled by code from one SKU's cells and one clown key: a port of
 * `build()` in the product repository's `workstreams/cmf/scripts/prompt_build.py`. Given the same
 * spec, key and template it writes the same prompt, byte for byte, and the same sha256
 * (`tests/cmf-prompt-fill.spec.ts` holds it to every payload the repository commits).
 *
 * Why it is here (2026-09-29): the CMF tools sent prompts the repository had pre-built from a
 * saved copy of the workbook, so a PDF made from Damien's newest workbook could sit beside a
 * render made from older values. Now the prompt and the PDF are both built from one parse of the
 * workbook upload Vesper keeps, and no model sits between a cell and either of them.
 *
 * The fill (prompt-template.md, "The fill rules"), one line per component the key maps, in the
 * key's zone order:
 *
 *   zone_hex     the zone's hex from the key, upper case, with #
 *   component    the sheet's component header, as written
 *   material     the component's `Material` cell: the SKU's column, else Common specs
 *   finish       the component's finish fields joined with ", " in the sheet's row order
 *   colour_name  the colour cell's words with its codes taken out
 *   colour_code  the colour cell's codes as written, first code to last, the sheet's separators
 *
 * Refused, every reason named, before anything is paid for: a draft key (a zone with no
 * component); a component neither mapped nor in `not_on_clown`; a zone naming a component or a
 * field the tab lacks; a required cell empty or pending; a pending cell the prompt would use; a
 * component with no code and no ` / ` or `N/A`; a zone line whose colour cell holds no code; a
 * component whose colour sits in two differing fields, or on two sides of one cell, with one
 * zone. A key whose zones are all named but that Damien has not confirmed is used, with a
 * warning, exactly as prompt_build.py uses it.
 */

import crypto from 'crypto'
import { colourName, extractCodes, NOT_APPLICABLE, type CmfCode } from './codes'
import { CmfError } from './kit-cmf'
import { collapse, effective, type Cell, type Spec, type SpecComponent, type SpecField } from './spec-diff'
import { checkSku } from './workbook'

export const FINISH_FIELDS = ['finish', 'finishing', 'outer surface finish', 'shell finishing', 'uv coating', 'finishing technique']
const MATERIAL_FIELDS = ['material']
const COLOUR_FIELDS = ['colour', 'color']
const SIDE_WORDS = ['left', 'right', 'inner', 'outer', 'front', 'back', 'top', 'bottom', 'inside', 'outside']
export const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const FILL_NAMES = ['zone_hex', 'component', 'material', 'finish', 'colour_name', 'colour_code']

/** The prompt is not built. `reasons` names every cell, zone and component at fault. */
export class PromptRefusal extends CmfError {
  constructor(readonly reasons: string[]) {
    super(reasons.join('\n'))
    this.name = 'PromptRefusal'
  }
}

export function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Python's repr() of what a cell record holds: a string quoted, a number bare. */
export function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v !== 'string') return pyRepr(JSON.stringify(v))
  const quote = v.includes("'") && !v.includes('"') ? '"' : "'"
  let out = ''
  for (const ch of v) {
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += `\\${quote}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f) out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
    else out += ch
  }
  return quote + out + quote
}

const norm = (text: unknown) => collapse(text).toLowerCase()

// ------------------------------------------------------------------ the template

export interface PromptTemplate {
  block: string
  sha256: string
  head: string[]
  pattern: string
  tail: string[]
}

const NUMBERED = /\{([a-z_]+?)_\d+\}/g
const FILL = /\{([a-z_]+)\}/g

/** prompt_build.py's read_template, on the block itself (the kit carries the first fenced block). */
export function readTemplateBlock(block: string): PromptTemplate {
  const lines = block.replace(/\r\n/g, '\n').split('\n')
  const zoneIdx = lines.map((ln, i) => (ln.includes('{zone_hex_') ? i : -1)).filter((i) => i >= 0)
  if (!zoneIdx.length) throw new CmfError("the CMF template has no {zone_hex_N} line")
  if (zoneIdx.some((v, k) => v !== zoneIdx[0] + k)) throw new CmfError('the zone lines of the CMF template are not consecutive')
  const patterns = new Set(zoneIdx.map((i) => lines[i].replace(NUMBERED, (_m, name: string) => `{${name}}`)))
  if (patterns.size !== 1) throw new CmfError(`the CMF template's zone lines are not one pattern shown ${zoneIdx.length} times; the fill rules assume they are`)
  const pattern = Array.from(patterns)[0]
  const names = Array.from(pattern.matchAll(FILL), (m) => m[1])
  if ([...names].sort().join(',') !== [...FILL_NAMES].sort().join(',')) throw new CmfError(`the CMF template's zone line holds ${names.join(', ')}; the fill rules know ${FILL_NAMES.join(', ')}`)
  lines.forEach((ln, i) => {
    if (!zoneIdx.includes(i) && /\{([a-z_]+?)_\d+\}/.test(ln)) throw new CmfError(`line ${i + 1} of the CMF template has a placeholder outside the zone lines`)
  })
  return {
    block,
    sha256: sha256Text(block),
    head: lines.slice(0, zoneIdx[0]),
    pattern,
    tail: lines.slice(zoneIdx[zoneIdx.length - 1] + 1),
  }
}

function fillLine(pattern: string, values: Record<string, string>): string {
  return pattern.replace(FILL, (_m, name: string) => values[name])
}

// ------------------------------------------------------------------ the key

export interface ClownKeyFile {
  product?: string | null
  clown?: { id?: string | null; sha256?: string | null; width?: number | null; height?: number | null } | null
  confirmed_by?: string | null
  confirmed_at?: string | null
  zones?: Array<{ hex?: string | null; components?: Array<string | { component?: string; field?: string | null }> | null; [k: string]: unknown }> | null
  not_on_clown?: string[] | null
  [k: string]: unknown
}

/** A key is a draft while it has no zones or any zone names no component. */
export function isDraftKey(key: ClownKeyFile): boolean {
  const zones = key.zones ?? []
  return !zones.length || zones.some((z) => !(z.components ?? []).length)
}

function entryParts(entry: unknown): [string, string | null] {
  if (typeof entry === 'string') return [entry, null]
  if (entry && typeof entry === 'object' && (entry as { component?: string }).component) {
    const e = entry as { component: string; field?: string | null }
    return [e.component, e.field ?? null]
  }
  throw new PromptRefusal([`a key components entry must be a component name or {"component": ..., "field": ...}, not ${pyRepr(JSON.stringify(entry))}`])
}

/** The Gemini aspect nearest the clown's own size, as prompt_build.py picks it. */
export function nearestAspect(width: number, height: number): string {
  const ratio = Math.log(width / height)
  let best = ASPECTS[0]
  let bestGap = Infinity
  for (const a of ASPECTS) {
    const [w, h] = a.split(':').map(Number)
    const gap = Math.abs(Math.log(w / h) - ratio)
    if (gap < bestGap) {
      best = a
      bestGap = gap
    }
  }
  return best
}

// ------------------------------------------------------------------ the row

function whereOf(spec: Spec, row: number, column: string): string {
  return `${spec.tab}!${column}${row}`
}

/** (record, where) for one field of one SKU: its own cell when filled, else Common specs. */
function cellOf(spec: Spec, field: SpecField, column: string): [Cell | null, string | null] {
  const rec = effective(field, column)
  if (rec === null) return [null, null]
  const own = field.by_sku[column] ?? null
  const col = own !== null && rec === own ? column : 'B'
  return [rec, whereOf(spec, field.row, col)]
}

function valueOf(rec: Cell | null): string {
  return !rec || rec.value === null || rec.value === undefined ? '' : collapse(rec.value)
}

function isNa(rec: Cell | null): boolean {
  return !!rec && rec.placeholder !== null && rec.placeholder !== undefined && NOT_APPLICABLE.has(rec.placeholder)
}

function isPending(rec: Cell | null): boolean {
  return !!rec && rec.placeholder !== null && rec.placeholder !== undefined && !NOT_APPLICABLE.has(rec.placeholder)
}

function codesOf(rec: Cell | null): CmfCode[] {
  return ((rec?.codes ?? []) as unknown as CmfCode[]).filter(Boolean)
}

/** A cell that gives two sides their own codes on their own lines (`Right: Pantone 121C` / `Left: ...`). */
function twoSides(value: string, codes: CmfCode[]): boolean {
  if (codes.length < 2 || !value.includes('\n')) return false
  const lines = value.split('\n').filter((ln) => extractCodes(ln).length > 0)
  const sided = lines.filter((ln) => new RegExp(`^\\s*(${SIDE_WORDS.join('|')})\\b`, 'i').test(ln))
  return lines.length >= 2 && sided.length >= 2
}

export interface FilledLine {
  n: number
  zone_hex: string
  component: string
  material: string
  finish: string
  colour_name: string
  colour_code: string
  field: string | null
  cells: { colour: string | null; material: string | null; finish: Array<{ field: string; cell: string | null }> }
  codes: string[]
}

export interface FilledPrompt {
  tab: string
  column: string
  sku_name: string | null
  sku_header: string | null
  sku_id: string
  product_slug: string | null
  key_confirmed: boolean
  clown: { id: string | null; sha256: string | null; width: number; height: number; aspect: string | null }
  template_sha256: string
  prompt: string
  prompt_sha256: string
  lines: FilledLine[]
  omitted: Array<{ component: string; why: string }>
  warnings: string[]
}

function kebab(text: string): string {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * prompt_build.py's build(), for one SKU column of one tab through one key: the prompt and what
 * it was filled from, or a PromptRefusal naming every reason. `keyFile` is the key's file name
 * (`case-experience2--front.json`), as the refusals name it. The clown's bytes are not read here:
 * cmf_render checks them against the key before it pays for a draw.
 */
export function fillPrompt(spec: Spec, column: string, key: ClownKeyFile, template: PromptTemplate, keyFile: string): FilledPrompt {
  const sku = spec.skus.find((s) => s.column === column)
  if (!sku) throw new CmfError(`no SKU column ${column} in ${spec.tab}; columns: ${spec.skus.map((s) => s.column).join(', ')}`)
  const col = sku.column
  const tab = spec.tab
  const kname = keyFile
  const reasons: string[] = []
  const warnings: string[] = []

  const byHeader = new Map<string, SpecComponent>()
  for (const c of spec.components) byHeader.set(c.header, c)
  const zones = key.zones ?? []
  if (!zones.length) reasons.push(`${kname}: the key has no zones (a draft)`)
  for (const z of zones) {
    if (!(z.components ?? []).length) {
      reasons.push(`${kname}: zone ${String(z.hex ?? 'None').toUpperCase()} names no component (the key is a draft; the lead CMF designer names it)`)
    }
  }
  const mapped: string[] = []
  for (const z of zones) {
    for (const e of z.components ?? []) {
      const [comp, field] = entryParts(e)
      const found = byHeader.get(comp)
      if (!found) {
        reasons.push(`${kname}: zone ${String(z.hex).toUpperCase()} names ${pyRepr(comp)}, which ${tab} does not have (its components: ${Array.from(byHeader.keys()).join(', ')})`)
        continue
      }
      if (field && !found.fields.some((f) => f.name === field)) {
        reasons.push(`${kname}: zone ${String(z.hex).toUpperCase()} names field ${pyRepr(field)} of ${pyRepr(comp)}, which has no such field`)
      }
      if (!mapped.includes(comp)) mapped.push(comp)
    }
  }
  const notOn = [...(key.not_on_clown ?? [])]
  for (const comp of notOn) {
    if (!byHeader.has(comp)) reasons.push(`${kname}: not_on_clown names ${pyRepr(comp)}, which ${tab} does not have`)
  }
  for (const comp of spec.components) {
    if (!mapped.includes(comp.header) && !notOn.includes(comp.header)) {
      reasons.push(`${tab} component ${pyRepr(comp.header)} has no zone in ${kname} and is not listed in its not_on_clown`)
    }
  }

  // The sheet: every required cell of a mapped component, and each component's codes.
  for (const f of checkSku(spec, col, 'components', true).fails) {
    const compName = f.what.split(' · ')[0]
    if (!mapped.includes(compName)) continue
    const raw = f.raw !== null && f.raw !== undefined ? ` (${pyRepr(f.raw)})` : ''
    reasons.push(`${f.where} ${f.what}: ${f.why}${raw}`)
  }

  const clownMeta = key.clown ?? {}
  const linesOut: string[] = []
  const lineRecords: FilledLine[] = []
  let n = 0
  for (const z of zones) {
    for (const e of z.components ?? []) {
      const [compName, fieldName] = entryParts(e)
      const comp = byHeader.get(compName)
      if (!comp) continue
      n += 1
      const fields = comp.fields
      // The colour cell.
      let colourField: SpecField | null = null
      if (fieldName) {
        colourField = fields.find((f) => f.name === fieldName) ?? null
      } else {
        colourField = fields.find((f) => COLOUR_FIELDS.includes(norm(f.name))) ?? null
        if (colourField === null) {
          const holding = fields.filter((f) => codesOf(effective(f, col)).length > 0)
          const distinct = new Set(holding.map((f) => valueOf(effective(f, col))))
          if (distinct.size > 1) {
            const shown = holding.map((f) => `${f.name}: ${valueOf(effective(f, col))}`).join('; ')
            reasons.push(
              `${whereOf(spec, comp.row, col)} ${compName}: its colour sits in ${holding.length} fields that differ (${shown}) and ${kname} gives it one zone; the key needs one zone per side, naming the field`
            )
          }
          colourField = holding[0] ?? null
        }
      }
      const [crec, cwhere] = colourField ? cellOf(spec, colourField, col) : [null, null]
      const cval = valueOf(crec)
      const ccodes = codesOf(crec)
      if (crec !== null && twoSides(String(crec.value ?? ''), ccodes)) {
        reasons.push(`${cwhere} ${compName} · ${colourField!.name}: one cell gives two sides two codes (${ccodes.map((c) => c.raw).join(', ')}) and ${kname} gives it one zone`)
      }
      if (isPending(crec)) {
        reasons.push(`${cwhere} ${compName} · ${colourField!.name}: pending (${crec!.placeholder}): ${pyRepr(crec!.raw)}`)
      } else if (!ccodes.length && !isNa(crec)) {
        const what = cval ? `a colour in words only: ${pyRepr(cval)}` : 'empty'
        const where = cwhere ?? whereOf(spec, comp.row, col)
        const fname = colourField ? colourField.name : '(no colour field)'
        reasons.push(`${where} ${compName} · ${fname}: no code and no ' / ' or 'N/A' (${what}); a zone line needs the code as the sheet writes it`)
      }
      // Material and finish.
      const materialField = fields.find((f) => MATERIAL_FIELDS.includes(norm(f.name))) ?? null
      const [mrec, mwhere] = materialField ? cellOf(spec, materialField, col) : [null, null]
      if (isPending(mrec)) reasons.push(`${mwhere} ${compName} · ${materialField!.name}: pending (${mrec!.placeholder}): ${pyRepr(mrec!.raw)}`)
      const material = isNa(mrec) || isPending(mrec) ? '' : valueOf(mrec)
      const finishParts: string[] = []
      const finishCells: Array<{ field: string; cell: string | null }> = []
      for (const f of fields) {
        if (!FINISH_FIELDS.includes(norm(f.name))) continue
        const [frec, fwhere] = cellOf(spec, f, col)
        if (frec === null || isNa(frec)) continue
        if (isPending(frec)) {
          reasons.push(`${fwhere} ${compName} · ${f.name}: pending (${frec.placeholder}): ${pyRepr(frec.raw)}`)
          continue
        }
        finishParts.push(valueOf(frec))
        finishCells.push({ field: f.name, cell: fwhere })
      }
      let name: string | null = crec && ccodes.length ? colourName(crec.value, ccodes) : null
      if (crec && !ccodes.length && !isNa(crec) && !isPending(crec)) name = cval
      let colourCode = ''
      if (ccodes.length) {
        const raw = String(crec!.value)
        colourCode = collapse(raw.slice(ccodes[0].span[0], ccodes[ccodes.length - 1].span[1]))
      }
      const values = {
        zone_hex: '#' + String(z.hex).replace(/^#+/, '').toUpperCase(),
        component: compName,
        material,
        finish: finishParts.join(', '),
        colour_name: name ? collapse(name) : '',
        colour_code: colourCode,
      }
      linesOut.push(fillLine(template.pattern, values))
      lineRecords.push({
        n,
        ...values,
        field: colourField ? colourField.name : null,
        cells: { colour: cwhere, material: mwhere, finish: finishCells },
        codes: ccodes.map((c) => c.raw),
      })
    }
  }

  if (reasons.length) throw new PromptRefusal(reasons)

  if (!key.confirmed_by) {
    warnings.unshift(
      `${kname} is not confirmed (confirmed_by is empty): the prompt is built from its mapping, and the payload records key_confirmed: false until the lead CMF designer confirms it`
    )
  }
  const prompt = [...template.head, ...linesOut, ...template.tail].join('\n')
  const width = Number(clownMeta.width ?? 0) || 0
  const height = Number(clownMeta.height ?? 0) || 0
  return {
    tab,
    column: col,
    sku_name: (sku.name as string | null | undefined) ?? null,
    sku_header: (sku.header as string | null | undefined) ?? null,
    sku_id: `${(spec.slug as string | undefined) ?? kebab(tab)}--${col}`,
    product_slug: key.product ?? null,
    key_confirmed: !!key.confirmed_by,
    clown: { id: clownMeta.id ?? null, sha256: clownMeta.sha256 ?? null, width, height, aspect: width && height ? nearestAspect(width, height) : null },
    template_sha256: template.sha256,
    prompt,
    prompt_sha256: sha256Text(prompt),
    lines: lineRecords,
    omitted: notOn.map((c) => ({ component: c, why: "not on this clown (the key's not_on_clown)" })),
    warnings,
  }
}

// ------------------------------------------------------------------ the SKU's cells, as a render records them

export interface SkuSpecField {
  name: string
  cell: string | null
  value: string | null
}

export interface SkuSpecView {
  tab: string
  column: string
  components: Array<{ header: string; fields: SkuSpecField[] }>
}

/**
 * Every component cell one SKU reads (its own cell, else Common specs, never for a yellow one),
 * as a render records it: what the prompt and the PDF's component blocks are made from. The
 * banner is left out: filling in a CMF number or a Checked cell changes no picture.
 */
export function skuSpecView(spec: Spec, column: string): SkuSpecView {
  return {
    tab: spec.tab,
    column,
    components: spec.components.map((c) => ({
      header: c.header,
      fields: c.fields.map((f) => {
        const [rec, where] = cellOf(spec, f, column)
        return { name: f.name, cell: where ?? whereOf(spec, f.row, column), value: rec && rec.value !== null && rec.value !== undefined ? String(rec.value) : null }
      }),
    })),
  }
}

export function skuSpecSha256(view: SkuSpecView): string {
  return sha256Text(JSON.stringify(view))
}

export interface SpecChange {
  component: string
  field: string
  cell: string | null
  rendered: string | null
  now: string | null
}

/** The fields whose value differs between the cells a render was made from and the workbook's cells now. */
export function skuSpecChanges(rendered: SkuSpecView, now: SkuSpecView): SpecChange[] {
  const keyed = (v: SkuSpecView) => {
    const out = new Map<string, { component: string; field: SkuSpecField }>()
    const seen = new Map<string, number>()
    for (const c of v.components) {
      for (const f of c.fields) {
        const base = `${c.header} · ${f.name}`
        const k = (seen.get(base) ?? 0) + 1
        seen.set(base, k)
        out.set(k === 1 ? base : `${base} #${k}`, { component: c.header, field: f })
      }
    }
    return out
  }
  const a = keyed(rendered)
  const b = keyed(now)
  const changes: SpecChange[] = []
  for (const [k, then] of Array.from(a.entries())) {
    const cur = b.get(k)
    const was = then.field.value === null ? null : collapse(then.field.value)
    const is = cur ? (cur.field.value === null ? null : collapse(cur.field.value)) : null
    if (!cur || was !== is) changes.push({ component: then.component, field: then.field.name, cell: cur?.field.cell ?? then.field.cell, rendered: then.field.value, now: cur ? cur.field.value : null })
  }
  for (const [k, cur] of Array.from(b.entries())) {
    if (!a.has(k)) changes.push({ component: cur.component, field: cur.field.name, cell: cur.field.cell, rendered: null, now: cur.field.value })
  }
  return changes
}
