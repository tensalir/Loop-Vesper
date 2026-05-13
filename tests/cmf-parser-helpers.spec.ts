/**
 * Unit tests for the CMF parser's regex zoo.
 *
 * Pinning these in isolation matters because the workbook fixtures in
 * `cmf-xlsx.spec.ts` exercise them indirectly via the full parse path —
 * if a regex regresses, the failure surfaces as "wrong field on the
 * parsed component" rather than "this exact string is no longer
 * recognised as a placeholder", which is much harder to triage.
 *
 * Cover the failure modes we've actually hit:
 *   - `isReal` / placeholder detection: workbook-default x-runs,
 *     dated placeholders, CMF-revision drafts, Pantone drafts.
 *   - `extractPantone`: TCX/TPG/U/C suffixes, free-form colour names,
 *     non-Pantone strings (notes path).
 *   - `peekIsContainer`: the lookahead that distinguishes group
 *     headers from component headers.
 *   - `slugifyRegion`: leading numbering, separators, length cap.
 *   - `isPlaceholderValue` / `isRealValue`: the canonical helpers
 *     both `xlsx.ts` and `schema.ts` now consume.
 */

import { test, expect } from '@playwright/test'
import {
  isReal,
  extractPantone,
  peekIsContainer,
  slugifyRegion,
} from '../src/lib/cmf/xlsx'
import { isPlaceholderValue, isRealValue } from '../src/lib/cmf/placeholder'

/* ── isReal / placeholder detection ─────────────────────────────────────── */

test('isReal accepts ordinary CMF strings', () => {
  expect(isReal('PANTONE 17-5641 TCX')).toBe(true)
  expect(isReal('Switch 2 Sage')).toBe(true)
  expect(isReal('en-sw-emb-02')).toBe(true)
  expect(isReal('CMF-001234revA')).toBe(true)
  expect(isReal('Black 6C')).toBe(true)
  expect(isReal('Pantone 7720C')).toBe(true)
  // Single 'x' is fine (could be a tracking column header etc.) — only
  // pure x-only-strings of any length are placeholders.
  expect(isReal('Pantone X')).toBe(true)
})

test('isReal rejects pure placeholder strings', () => {
  expect(isReal('xxxxxxxxxxx')).toBe(false)
  expect(isReal('xx')).toBe(false)
  expect(isReal('XXX')).toBe(false)
  expect(isReal('xx/xx/xxxx')).toBe(false)
  expect(isReal('CMF-xxxxxx rev x')).toBe(false)
  expect(isReal('Pantone xxxxxxxxxxx')).toBe(false)
  expect(isReal('Pantone xxxx')).toBe(false)
  expect(isReal('/')).toBe(false)
  expect(isReal('-')).toBe(false)
})

test('isReal handles null / empty / whitespace gracefully', () => {
  expect(isReal(null)).toBe(false)
  expect(isReal(undefined)).toBe(false)
  expect(isReal('')).toBe(false)
  expect(isReal('   ')).toBe(false)
})

test('isPlaceholderValue and isRealValue are symmetric', () => {
  // For non-empty strings, isReal === !isPlaceholder.
  const samples = ['PANTONE 17-5641 TCX', 'xxxxxxxxxxx', 'Switch 2', '/']
  for (const s of samples) {
    expect(isRealValue(s)).toBe(!isPlaceholderValue(s))
  }
})

test('isPlaceholderValue treats null/empty as NOT a placeholder', () => {
  // Subtle but important: empty/null inputs are absences, not
  // placeholders. Both isReal(null) and isPlaceholderValue(null)
  // should be false.
  expect(isPlaceholderValue(null)).toBe(false)
  expect(isPlaceholderValue(undefined)).toBe(false)
  expect(isPlaceholderValue('')).toBe(false)
  expect(isPlaceholderValue('   ')).toBe(false)
})

/* ── extractPantone ─────────────────────────────────────────────────────── */

test('extractPantone captures TCX / TPG / U / C suffixes', () => {
  expect(extractPantone('PANTONE 17-5641 TCX')).toBe('PANTONE 17-5641 TCX')
  expect(extractPantone('Pantone 18-1664 TPG')).toBe('Pantone 18-1664 TPG')
  expect(extractPantone('pantone 7720 c')).toBe('pantone 7720 c')
  expect(extractPantone('Pantone 7720C')).toBe('Pantone 7720C')
  // The U variant is in the regex's suffix group too.
  expect(extractPantone('PANTONE 432 U')).toBe('PANTONE 432 U')
})

test('extractPantone handles free-form Pantone-adjacent strings', () => {
  // The strict `pantone\s+[a-z0-9-]+\s*(suffix)?` regex matches
  // "Pantone Black" (greedy `[a-z0-9-]+` captures "Black"; "6C" is
  // outside the suffix vocabulary), so the result is the matched
  // prefix, not the full input. That's intentional: the matched
  // string is what we set on the component's `pantone` field; the
  // FULL input is preserved separately in `notes` by the caller.
  expect(extractPantone('Pantone Black 6C')).toBe('Pantone Black')
  // Non-pantone short strings (<= 32 chars) come back as-is so colour
  // codes like "Black 6C" without the "Pantone" prefix don't lose info.
  expect(extractPantone('Black 6C')).toBe('Black 6C')
})

test('extractPantone returns null for long free-form text', () => {
  const longText =
    'translucent see reference attached, finish should approximate brushed steel with iridescent overtones'
  expect(extractPantone(longText)).toBeNull()
})

/* ── peekIsContainer ────────────────────────────────────────────────────── */

test('peekIsContainer detects container rows after blank rows', () => {
  // Container = col A non-empty, B and SKU cols empty.
  const aoa: unknown[][] = [
    ['', 'Common specs', 'SKU 1'],
    ['', '', ''], // blank row — should be skipped
    ['POM RING', '', ''], // container
    ['Material', 'POM', ''],
  ]
  const skuColumns = [{ index: 2, label: 'SKU 1' }]
  expect(peekIsContainer(aoa, 1, skuColumns)).toBe(true)
})

test('peekIsContainer returns false for attribute rows', () => {
  // Material row has B="POM" — that's a value, so NOT a container.
  const aoa: unknown[][] = [
    ['', 'Common specs', 'SKU 1'],
    ['Material', 'POM', ''],
  ]
  const skuColumns = [{ index: 2, label: 'SKU 1' }]
  expect(peekIsContainer(aoa, 1, skuColumns)).toBe(false)
})

test('peekIsContainer returns false past the end of the AOA', () => {
  const aoa: unknown[][] = [['POM RING', '', '']]
  const skuColumns = [{ index: 2, label: 'SKU 1' }]
  // startRow past the last row → no container ahead.
  expect(peekIsContainer(aoa, 5, skuColumns)).toBe(false)
})

/* ── slugifyRegion ──────────────────────────────────────────────────────── */

test('slugifyRegion strips leading numbering', () => {
  expect(slugifyRegion('1. Case lid housing')).toBe('case_lid_housing')
  expect(slugifyRegion('A. Top housing')).toBe('top_housing')
  expect(slugifyRegion('2. Inner lid housing')).toBe('inner_lid_housing')
})

test('slugifyRegion collapses non-alphanumeric runs to underscores', () => {
  expect(slugifyRegion('POM RING')).toBe('pom_ring')
  expect(slugifyRegion('Cosmetic cap')).toBe('cosmetic_cap')
  expect(slugifyRegion('Body — Left')).toBe('body_left')
  expect(slugifyRegion('Eartip (hidden flange)')).toBe('eartip_hidden_flange')
})

test('slugifyRegion truncates at 60 characters', () => {
  const longLabel = 'A super long region label '.repeat(5)
  const slug = slugifyRegion(longLabel)
  expect(slug.length).toBeLessThanOrEqual(60)
})

test('slugifyRegion returns "component" as a fallback for empty input', () => {
  expect(slugifyRegion('')).toBe('component')
  expect(slugifyRegion('!!!')).toBe('component')
})
