import { test, expect } from '@playwright/test'
import {
  lookupPantoneHex,
  enrichComponentColour,
  hasUnresolvedPantone,
} from '../src/lib/cmf/pantone'

/**
 * Unit tests for the Pantone → hex resolver. The shape we care about:
 *   1. Recognises Solid Coated codes in the bundled pantone-colors range
 *      (e.g. Pantone 155 C).
 *   2. Recognises 7000-series codes that pantone-colors does not ship,
 *      via the local EXTENSIONS_HEX table (e.g. Pantone 7720 — Switch 2
 *      Emerald).
 *   3. Recognises dashed TCX codes (e.g. PANTONE 17-5641 TCX).
 *   4. Tolerates formatting variations: "Pantone " prefix, trailing
 *      letter, optional whitespace.
 *   5. Misses are silent (return null) so callers can warn.
 *   6. `enrichComponentColour` is a pure helper that only fills in
 *      `colorHex` when missing AND the lookup hits.
 */

/* ── Basic lookups ────────────────────────────────────────────────────── */

test('lookupPantoneHex resolves a Solid Coated code shipped by pantone-colors', () => {
  expect(lookupPantoneHex('Pantone 155 C')?.toLowerCase()).toBe('#f4dbaa')
  expect(lookupPantoneHex('Pantone 1777C')?.toLowerCase()).toBe('#fc6675')
  expect(lookupPantoneHex('Pantone 726C')?.toLowerCase()).toBe('#edd3b5')
})

test('lookupPantoneHex resolves 7000-series codes via the local extensions table (gap in pantone-colors)', () => {
  // 7720 is the Switch 2 Emerald POM ring colour Damien uses.
  expect(lookupPantoneHex('Pantone 7720 C')?.toLowerCase()).toBe('#247b5e')
  expect(lookupPantoneHex('Pantone 7720C')?.toLowerCase()).toBe('#247b5e')
  expect(lookupPantoneHex('7720')?.toLowerCase()).toBe('#247b5e')
})

test('lookupPantoneHex resolves TCX codes from the local extensions table', () => {
  expect(lookupPantoneHex('PANTONE 17-5641 TCX')?.toLowerCase()).toBe('#009969')
  expect(lookupPantoneHex('17-5641 TCX')?.toLowerCase()).toBe('#009969')
  expect(lookupPantoneHex('17-5641')?.toLowerCase()).toBe('#009969')
})

/* ── Formatting tolerance ─────────────────────────────────────────────── */

test('lookupPantoneHex is case- and whitespace-tolerant', () => {
  expect(lookupPantoneHex('pantone 7720 c')?.toLowerCase()).toBe('#247b5e')
  expect(lookupPantoneHex('  PANTONE   7720   C  ')?.toLowerCase()).toBe('#247b5e')
  expect(lookupPantoneHex('PANTONE 17-5641 tcx')?.toLowerCase()).toBe('#009969')
})

test('lookupPantoneHex returns null for unknown / non-numeric codes', () => {
  expect(lookupPantoneHex('Black 6 C')).toBeNull()
  expect(lookupPantoneHex('Pantone 99999 C')).toBeNull()
  expect(lookupPantoneHex('Pantone 99-9999 TCX')).toBeNull()
  expect(lookupPantoneHex('')).toBeNull()
  expect(lookupPantoneHex(null)).toBeNull()
  expect(lookupPantoneHex(undefined)).toBeNull()
})

/* ── enrichComponentColour ────────────────────────────────────────────── */

test('enrichComponentColour fills in colorHex when missing and Pantone is resolvable', () => {
  const enriched = enrichComponentColour({
    region: 'pom_ring',
    label: 'POM ring',
    pantone: 'Pantone 7720 C',
  })
  expect(enriched.colorHex?.toLowerCase()).toBe('#247b5e')
})

test('enrichComponentColour leaves the component untouched when colorHex is already set', () => {
  const before = {
    region: 'pom_ring',
    label: 'POM ring',
    pantone: 'Pantone 7720 C',
    colorHex: '#abcdef',
  }
  const after = enrichComponentColour(before)
  expect(after.colorHex).toBe('#abcdef')
})

test('enrichComponentColour is a no-op when there is no Pantone code', () => {
  const before = { region: 'pom_ring', label: 'POM ring' }
  const after = enrichComponentColour(before)
  expect(after.colorHex).toBeUndefined()
})

test('enrichComponentColour preserves other fields exactly', () => {
  const enriched = enrichComponentColour({
    region: 'cosmetic_cap',
    label: 'Cosmetic cap',
    pantone: 'PANTONE 17-5641 TCX',
    material: 'PC/ABS',
    finish: 'NCVM Satin',
    notes: 'pad-printed logo',
  })
  expect(enriched.material).toBe('PC/ABS')
  expect(enriched.finish).toBe('NCVM Satin')
  expect(enriched.notes).toBe('pad-printed logo')
  expect(enriched.colorHex?.toLowerCase()).toBe('#009969')
})

/* ── hasUnresolvedPantone ─────────────────────────────────────────────── */

test('hasUnresolvedPantone flags unknown Pantone codes for warning aggregation', () => {
  expect(hasUnresolvedPantone({ pantone: 'Black 6 C' })).toBe(true)
  expect(hasUnresolvedPantone({ pantone: 'Pantone 7720 C' })).toBe(false)
  expect(hasUnresolvedPantone({ pantone: 'Pantone 7720 C', colorHex: '#abcdef' })).toBe(false)
  expect(hasUnresolvedPantone({})).toBe(false)
})
