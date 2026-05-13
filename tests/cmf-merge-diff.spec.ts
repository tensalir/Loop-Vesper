/**
 * Unit tests for the smart-merge diff helpers.
 *
 * `componentsDiffer` and `palettesDiffer` decide whether re-uploading a
 * workbook should mark a SKU as "changed" or "unchanged". Mistakes here
 * have a high blast radius — false negatives mean a designer's edits
 * silently never land; false positives mean every re-upload looks like
 * a churning diff. Today only the SKU-set signature has dedicated
 * coverage; pinning the field-level diff means future refactors can't
 * regress the comparison rules without a test failure.
 */

import { test, expect } from '@playwright/test'
import { componentsDiffer, palettesDiffer } from '../src/lib/cmf/service'
import type { ComponentSpec, PaletteSwatch } from '../src/lib/cmf/schema'

/* ── componentsDiffer ───────────────────────────────────────────────────── */

const baseRing: ComponentSpec = {
  region: 'pom_ring',
  label: 'POM ring',
  material: 'POM',
  finish: 'Matte',
  pantone: 'PANTONE 17-5641 TCX',
}

const baseCap: ComponentSpec = {
  region: 'cosmetic_cap',
  label: 'Cosmetic cap',
  material: 'ABS',
  finish: 'NCVM Satin',
  pantone: 'Pantone 7720C',
}

test('componentsDiffer returns no change when both sides match', () => {
  const result = componentsDiffer([baseRing, baseCap], [baseRing, baseCap])
  expect(result.changed).toBe(false)
  expect(result.changedRegions).toEqual([])
})

test('componentsDiffer ignores region order', () => {
  const result = componentsDiffer([baseRing, baseCap], [baseCap, baseRing])
  expect(result.changed).toBe(false)
})

test('componentsDiffer flags material changes', () => {
  const incoming: ComponentSpec[] = [
    { ...baseRing, material: 'POM-LF' },
    baseCap,
  ]
  const result = componentsDiffer([baseRing, baseCap], incoming)
  expect(result.changed).toBe(true)
  expect(result.changedRegions).toContain('pom_ring')
})

test('componentsDiffer flags finish changes', () => {
  const incoming: ComponentSpec[] = [
    { ...baseRing, finish: 'Glossy' },
    baseCap,
  ]
  expect(componentsDiffer([baseRing, baseCap], incoming).changedRegions).toContain('pom_ring')
})

test('componentsDiffer flags Pantone changes (case-insensitive)', () => {
  const incoming: ComponentSpec[] = [
    { ...baseRing, pantone: 'PANTONE 19-1664 TCX' },
    baseCap,
  ]
  expect(componentsDiffer([baseRing, baseCap], incoming).changed).toBe(true)
})

test('componentsDiffer treats Pantone case as equal', () => {
  // Pantone is normalised to upper-case before comparison so casing
  // changes alone don't show up as drift.
  const incoming: ComponentSpec[] = [
    { ...baseRing, pantone: 'pantone 17-5641 tcx' },
    baseCap,
  ]
  expect(componentsDiffer([baseRing, baseCap], incoming).changed).toBe(false)
})

test('componentsDiffer flags colorHex changes (case-insensitive)', () => {
  const a: ComponentSpec = { ...baseRing, colorHex: '#A1B2C3' }
  const b: ComponentSpec = { ...baseRing, colorHex: '#A1B2C4' }
  expect(componentsDiffer([a], [b]).changed).toBe(true)
})

test('componentsDiffer ignores hex casing changes alone', () => {
  const a: ComponentSpec = { ...baseRing, colorHex: '#A1B2C3' }
  const b: ComponentSpec = { ...baseRing, colorHex: '#a1b2c3' }
  expect(componentsDiffer([a], [b]).changed).toBe(false)
})

test('componentsDiffer reports added regions', () => {
  const incoming: ComponentSpec[] = [
    baseRing,
    baseCap,
    {
      region: 'eartip',
      label: 'Eartip (hidden flange)',
      material: 'Silicone',
    },
  ]
  const result = componentsDiffer([baseRing, baseCap], incoming)
  expect(result.changed).toBe(true)
  expect(result.changedRegions).toContain('eartip')
})

test('componentsDiffer reports dropped regions', () => {
  // Designer removed the cosmetic_cap row in the new workbook.
  const result = componentsDiffer([baseRing, baseCap], [baseRing])
  expect(result.changed).toBe(true)
  expect(result.changedRegions).toContain('cosmetic_cap')
})

test('componentsDiffer copes with malformed existing data', () => {
  // Existing was stored as something other than an array (legacy null,
  // accidental object). Should treat as empty -> every incoming
  // region is "added".
  const result = componentsDiffer(null, [baseRing])
  expect(result.changed).toBe(true)
  expect(result.changedRegions).toContain('pom_ring')
})

test('componentsDiffer ignores incoming entries without a region', () => {
  // Null/empty region rows are filtered out — they can't drive a
  // diff because there's no key to compare against.
  const incoming: ComponentSpec[] = [
    baseRing,
    { region: '' as string, label: 'orphan' },
  ]
  expect(componentsDiffer([baseRing], incoming).changed).toBe(false)
})

/* ── palettesDiffer ─────────────────────────────────────────────────────── */

const swatchA: PaletteSwatch = {
  label: 'Sage',
  pantone: 'PANTONE 17-5641 TCX',
  colorHex: '#A0B099',
}

const swatchB: PaletteSwatch = {
  label: 'Cream',
  pantone: 'Pantone 7720C',
  colorHex: '#F4ECD8',
}

test('palettesDiffer returns false for identical palettes', () => {
  expect(palettesDiffer([swatchA, swatchB], [swatchA, swatchB])).toBe(false)
})

test('palettesDiffer flags different lengths', () => {
  expect(palettesDiffer([swatchA], [swatchA, swatchB])).toBe(true)
  expect(palettesDiffer([swatchA, swatchB], [swatchA])).toBe(true)
})

test('palettesDiffer flags label changes', () => {
  const renamed: PaletteSwatch = { ...swatchA, label: 'Mint' }
  expect(palettesDiffer([swatchA], [renamed])).toBe(true)
})

test('palettesDiffer flags Pantone changes (case-insensitive)', () => {
  const changed: PaletteSwatch = { ...swatchA, pantone: 'PANTONE 19-1664 TCX' }
  expect(palettesDiffer([swatchA], [changed])).toBe(true)
})

test('palettesDiffer ignores Pantone casing', () => {
  const same: PaletteSwatch = { ...swatchA, pantone: 'pantone 17-5641 tcx' }
  expect(palettesDiffer([swatchA], [same])).toBe(false)
})

test('palettesDiffer flags hex changes', () => {
  const changed: PaletteSwatch = { ...swatchA, colorHex: '#A0B100' }
  expect(palettesDiffer([swatchA], [changed])).toBe(true)
})

test('palettesDiffer ignores hex casing alone', () => {
  const same: PaletteSwatch = { ...swatchA, colorHex: '#a0b099' }
  expect(palettesDiffer([swatchA], [same])).toBe(false)
})

test('palettesDiffer flags reorder by index', () => {
  // The function compares by index, not by content match. Reordering
  // is a meaningful change because the order is what drives the PDF
  // swatch row.
  expect(palettesDiffer([swatchA, swatchB], [swatchB, swatchA])).toBe(true)
})

test('palettesDiffer treats malformed existing as empty', () => {
  expect(palettesDiffer(null, [swatchA])).toBe(true)
  expect(palettesDiffer({} as unknown, [swatchA])).toBe(true)
})
