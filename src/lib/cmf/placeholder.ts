/**
 * Placeholder detection — single source of truth.
 *
 * Loop CMF workbooks ship with three SKU slots per product tab and
 * designers typically fill only one. The unfilled slots carry "draft"
 * placeholder strings — `xxxxxxxxxxx`, `Pantone xxxxxxxxxxx`,
 * `xx/xx/xxxx`, `CMF-XXXrevX` — and we want to drop those EVERYWHERE
 * we see them: the parser's `isReal` gate, the schema normaliser's
 * `cleanField`, the diagnostic surfacing.
 *
 * Before this module these regexes lived twice (in `xlsx.ts:isReal`
 * and `schema.ts:cleanField`). The two definitions had drifted in
 * subtle ways; consolidating here means a value is "real" in the
 * parser if and only if it's "real" in the normaliser.
 *
 * Two exports:
 *   - `isPlaceholderValue` — true when the input looks like draft
 *     filler. Empty / null inputs return `false` (they're absences,
 *     not placeholders).
 *   - `isRealValue` — true when the input is a non-empty,
 *     non-placeholder string.
 *
 * Both treat the input case-insensitively for the X-runs and trim
 * whitespace before testing.
 */

/**
 * Regex zoo for the placeholder shapes Loop workbooks emit. Centralised
 * so the test suite can exercise each rule in isolation. Order matters
 * — we test specific shapes (CMF-XXXrevX, Pantone xxxx, xx/xx/xxxx)
 * before the catch-all generic-X rule so a string like
 * "CMF-xxxxx rev x" matches the dedicated rule's debug output rather
 * than the generic one.
 */
const PLACEHOLDER_RULES: ReadonlyArray<{ name: string; test: RegExp }> = [
  // Single slash or single dash — workbook leftovers from "N/A" cells.
  { name: 'separator', test: /^[/-]$/ },
  // Pure run of x's — `xxxxxxxxxxx`.
  { name: 'pure-x-run', test: /^x+$/i },
  // Date placeholder: xx/xx/xxxx (any 2+ x's separated by slashes).
  { name: 'date', test: /^x{2,}\/x{2,}\/x{2,}$/i },
  // CMF revision placeholder: `CMF-xxxxx rev x`.
  { name: 'cmf-rev', test: /^cmf-x+\s*rev\s*x$/i },
  // Pantone placeholder: `Pantone xxxx`.
  { name: 'pantone', test: /pantone\s+x{4,}/i },
] as const

/**
 * True when a 6+ character string is dominated by x's with nothing
 * meaningful in between. Catches `xxxxxxxxxxx`, `xx-xx`, `xx_xx_xx`
 * etc. without flagging real strings that happen to contain an x
 * (`Sage` / `Switch 2 Box`).
 */
function looksLikeGenericXPlaceholder(trimmed: string): boolean {
  if (!/x{6,}/i.test(trimmed)) return false
  // Strip every x and check whether anything alpha-numeric remains.
  // If there are no letters/digits left after removing x's, the string
  // was effectively all x's plus separators.
  const remaining = trimmed.replace(/x/gi, '')
  return !/[a-w0-9]/i.test(remaining)
}

export function isPlaceholderValue(
  value: string | null | undefined
): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  for (const rule of PLACEHOLDER_RULES) {
    if (rule.test.test(trimmed)) return true
  }
  return looksLikeGenericXPlaceholder(trimmed)
}

export function isRealValue(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed) return false
  return !isPlaceholderValue(trimmed)
}
