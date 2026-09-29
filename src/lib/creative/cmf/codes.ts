/**
 * Colour codes and placeholders in CMF sheet cells: a port of the plugin repository's
 * `workstreams/cmf/scripts/codes.py`, held to it by `tests/fixtures/cmf/spec-diff-parity.json`
 * (every cell text in the committed specs, and the module's own examples, through
 * `extract_codes`, `colour_name` and `is_placeholder`).
 *
 * A cell is written by a person for a supplier, so a code arrives in many shapes: `Pantone 544C`,
 * `Pantone Warm Grey 9C`, `Brown 7518C`, `LilacPantone 2635C`, `Burgundy 19-2025TCX`,
 * `Black 000000`, `Pantone 544C + 427C + 5405 + white`. `raw` keeps what the sheet says;
 * `key` is for lookups only and is never printed back as the value. The grammar and its
 * refusals are the Python module's docstring; nothing here decides anything it does not.
 */

export interface CmfCode {
  raw: string
  system: 'pantone' | 'hex' | 'ral'
  family: 'solid' | 'textile' | 'named' | 'hex' | 'ral'
  name: string | null
  number: string | null
  suffix: string | null
  key: string
  span: [number, number]
  flags: string[]
}

const SUFFIXES = ['xgc', 'tcx', 'tpg', 'tpx', 'cp', 'pc', 'c', 'u', 'm'] // longest first

// Pantone's named families, longest first; the pattern is the number the family takes.
const NAMED_FAMILIES: Array<[string, string | null]> = [
  ['process black', null],
  ['process blue', null],
  ['reflex blue', null],
  ['bright red', null],
  ['rubine red', null],
  ['rhodamine red', null],
  ['warm grey', '(?:[1-9]|1[01])'],
  ['cool grey', '(?:[1-9]|1[01])'],
  ['black', '[2-7]'],
  ['orange', '021'],
  ['yellow', '012'],
  ['blue', '072'],
  ['purple', null],
  ['violet', null],
  ['green', null],
]
const FAMILY_NUMBER = new Map(NAMED_FAMILIES)

export const COLOUR_WORDS = new Set(
  `black white grey gray silver gold red green blue yellow orange pink purple violet lilac
   lavender navy brown beige cream ivory teal turquoise mint sage olive burgundy maroon coral
   peach rose magenta cyan charcoal graphite titanium bronze copper champagne ember
   transparent clear hex colour color rgb`.split(/\s+/).filter(Boolean)
)

const NAMED_ALT = NAMED_FAMILIES.map(([name]) => name.replace('grey', 'gr[ae]y').split(' ').join('\\s+')).join('|')
const SUFFIX_ALT = SUFFIXES.join('|')

// codes.py's `_CODE`, verbose flag taken out; `i` for its re.I.
const CODE_SOURCE =
  '(?:(?<prefix>pantone)(?<gap>\\s*)|(?<![A-Za-z0-9]))' +
  '(?:' +
  `(?<named>${NAMED_ALT})(?:\\s*(?<nnum>\\d{1,3}))?` +
  '|(?<textile>\\d{2}-\\d{4})' +
  '|(?<badtextile>\\d{4}-\\d{2})(?=\\s*(?:tcx|tpg|tpx)(?![A-Za-z0-9]))' +
  '|(?<num>\\d{3,4})' +
  ')' +
  `(?:\\s*(?<suffix>${SUFFIX_ALT})(?<dup>(?<=[cC])[cC])?)?` +
  '(?![A-Za-z0-9])'

// Python's \w on text is Unicode letters, numbers and the underscore.
const HEX_SOURCE = '(?<![\\p{L}\\p{N}_-])(?<hash>#)?(?<hex>[0-9A-Fa-f]{6})(?![\\p{L}\\p{N}_-])'
const RAL_SOURCE = '(?<![A-Za-z0-9])(?<prefix>ral)\\s*(?<num>\\d{4})(?![A-Za-z0-9])'
const JOIN = /^\s*\+\s*$/
const WORD_BEFORE = /([A-Za-z]+)[^A-Za-z0-9]*$/

function canonicalFamily(named: string): string {
  return named.trim().toLowerCase().replace(/\s+/g, ' ').replace(/gray/g, 'grey')
}

function pantoneKey(name: string | null, number: string | null, suffix: string | null): string {
  const parts = ['pantone']
  if (name) parts.push(name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/grey/g, 'gray'))
  if (number) parts.push(number.toLowerCase())
  if (suffix) parts.push(suffix.toLowerCase())
  return parts.join(' ')
}

const LETTERS = new RegExp('^\\p{L}+$', 'u')

function isAlpha(ch: string): boolean {
  return ch !== '' && LETTERS.test(ch)
}

function pantoneCodes(text: string): CmfCode[] {
  const found: CmfCode[] = []
  const re = new RegExp(CODE_SOURCE, 'gi')
  let pos = 0
  let lastEnd: number | null = null
  let lastPrefixed = false
  for (;;) {
    re.lastIndex = pos
    const m = re.exec(text)
    if (!m) break
    const g = m.groups ?? {}
    const prefix = g.prefix
    const named = g.named
    const nnum = g.nnum
    const suffix = g.suffix
    const flags: string[] = []
    const start = m.index
    const end = start + m[0].length

    if (named && nnum) {
      const pattern = FAMILY_NUMBER.get(canonicalFamily(named))
      if (pattern === null || pattern === undefined || !new RegExp(`^(?:${pattern})$`).test(nnum)) {
        pos = start + 1
        continue
      }
    }
    let inherited = false
    if (!prefix && lastEnd !== null && lastPrefixed && JOIN.test(text.slice(lastEnd, start))) inherited = true
    const hasPrefix = !!prefix || inherited
    if (!hasPrefix && !suffix) {
      pos = start + 1
      continue
    }
    if (!hasPrefix && suffix!.toLowerCase() === 'm') {
      pos = start + 1
      continue
    }
    if (g.dup) flags.push('double_suffix')
    if (prefix) {
      const before = start > 0 ? text[start - 1] : ''
      if (isAlpha(before) || !g.gap) flags.push('no_space_prefix')
    }
    if (inherited) flags.push('inherited_prefix')
    if (!suffix) flags.push('missing_suffix')

    let family: CmfCode['family']
    let name: string | null
    let number: string | null
    if (named) {
      family = 'named'
      name = named.trim().replace(/\s+/g, ' ')
      number = nnum ?? null
    } else if (g.textile) {
      family = 'textile'
      name = null
      number = g.textile
    } else if (g.badtextile) {
      family = 'textile'
      name = null
      number = g.badtextile
      flags.push('malformed_number')
    } else {
      family = 'solid'
      name = null
      number = g.num
    }
    found.push({
      raw: text.slice(start, end),
      system: 'pantone',
      family,
      name,
      number,
      suffix: suffix ?? null,
      key: pantoneKey(name, number, suffix ?? null),
      span: [start, end],
      flags,
    })
    lastEnd = end
    lastPrefixed = hasPrefix
    pos = end
  }
  return found
}

function overlaps(span: [number, number], spans: Array<[number, number]>): boolean {
  return spans.some(([s, e]) => span[0] < e && s < span[1])
}

function codePointLength(text: string): number {
  return Array.from(text).length
}

/** Every colour code in a cell, in reading order. */
export function extractCodes(text: unknown): CmfCode[] {
  if (text === null || text === undefined) return []
  const s = String(text)
  if (!s.trim()) return []
  const codes = pantoneCodes(s)
  const taken: Array<[number, number]> = codes.map((c) => c.span)

  const ral = new RegExp(RAL_SOURCE, 'gi')
  for (let m = ral.exec(s); m; m = ral.exec(s)) {
    const span: [number, number] = [m.index!, m.index! + m[0].length]
    if (overlaps(span, taken)) continue
    codes.push({
      raw: m[0],
      system: 'ral',
      family: 'ral',
      name: null,
      number: m.groups!.num,
      suffix: null,
      key: `ral ${m.groups!.num}`,
      span,
      flags: [],
    })
    taken.push(span)
  }

  const short = codePointLength(s.trim()) <= 20
  const hex = new RegExp(HEX_SOURCE, 'gu')
  for (let m = hex.exec(s); m; m = hex.exec(s)) {
    const span: [number, number] = [m.index!, m.index! + m[0].length]
    if (overlaps(span, taken)) continue
    const word = WORD_BEFORE.exec(s.slice(0, m.index))
    const afterColourWord = !!word && COLOUR_WORDS.has(word[1].toLowerCase())
    if (!(m.groups!.hash || afterColourWord || short)) continue
    const digits = m.groups!.hex
    if (!m.groups!.hash && !/[0-9]/.test(digits)) continue // a six-letter word (`facade`) is not a hex
    codes.push({
      raw: m[0],
      system: 'hex',
      family: 'hex',
      name: null,
      number: digits,
      suffix: null,
      key: `hex ${digits.toLowerCase()}`,
      span,
      flags: [],
    })
    taken.push(span)
  }
  // Python's sort is stable, and so is Array.prototype.sort.
  codes.sort((a, b) => a.span[0] - b.span[0])
  return codes
}

const SEPARATORS = ' \t\r\n+,;:/&|—–-'

function stripChars(text: string, chars: string): string {
  let a = 0
  let b = text.length
  while (a < b && chars.includes(text[a])) a++
  while (b > a && chars.includes(text[b - 1])) b--
  return text.slice(a, b)
}

/**
 * The cell's words once its codes are taken out, as written; a named code's family name when the
 * cell has one; the cell's own text when it has no code. Null for an empty or placeholder cell.
 */
export function colourName(text: unknown, codes?: CmfCode[]): string | null {
  if (text === null || text === undefined) return null
  const s = String(text)
  if (isEmpty(s) || isPlaceholder(s)) return null
  const cs = codes ?? extractCodes(s)
  const pieces: string[] = []
  let cursor = 0
  for (const c of [...cs].sort((a, b) => a.span[0] - b.span[0])) {
    pieces.push(s.slice(cursor, c.span[0]))
    cursor = c.span[1]
  }
  pieces.push(s.slice(cursor))
  for (const c of cs) if (c.name) return c.name
  const words: string[] = []
  for (let piece of pieces) {
    piece = piece.replace(/pantone\s*$/i, '')
    piece = stripChars(piece, SEPARATORS)
    piece = piece.replace(/\s+/g, ' ')
    if (piece) words.push(piece)
  }
  return words.join(' ') || null
}

// The placeholder rules, in the order they are tested: the first three say "does not apply".
const PLACEHOLDER_RULES: Array<[string, RegExp]> = [
  ['slash', /^\/$/],
  ['dash', /^[-–—]$/],
  ['n/a', /^n\s*\/\s*a\.?$/i],
  ['date_x', /^x{2,}\/x{2,}\/x{2,}$/i],
  ['cmf_rev_x', /^cmf-x+\s*rev\s*x+$/i],
  ['pantone_x', /pantone\s*x{3,}/i],
  ['bracket', /^\[[^\]]*\]$/],
  ['tbc', /^tbc\.?$/i],
  ['tbd', /^tb[da]\.?$/i],
  ['x_number', /^(?=.*x)(?=.*[.%])[x.,%\s]+$/i],
  ['x_run', /(?<![A-Za-z0-9])x{2,}(?![A-Za-z0-9])/i],
]

export const NOT_APPLICABLE = new Set(['slash', 'dash', 'n/a'])

export function isEmpty(text: unknown): boolean {
  return text === null || text === undefined || (typeof text === 'string' && !text.trim())
}

/** The name of the placeholder rule the cell matches, or null. */
export function isPlaceholder(text: unknown): string | null {
  if (isEmpty(text)) return null
  let s = String(text).trim()
  if (s.startsWith('"')) s = s.slice(1).trim()
  for (const [name, rule] of PLACEHOLDER_RULES) if (rule.test(s)) return name
  return null
}
