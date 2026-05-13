/**
 * Tests for the pure helpers extracted from `createPacketFromRows`.
 *
 * `groupRowsByProductSlug` is the only fully-pure piece (no Prisma
 * transaction client involved) so we can pin it directly. The merge
 * + create paths are exercised end-to-end via the workbook fixtures
 * in `cmf-xlsx.spec.ts`; spinning up Prisma here would buy little
 * additional coverage at high test-runtime cost.
 *
 * These tests guard the property the orchestrator relies on:
 *   - rows for the same product cluster together
 *   - workbook order is preserved across products (Switch 2 before
 *     Cocoon, not lexical)
 *   - mixed inputs interleave correctly (S2, Coc, S2, Coc → S2 + Coc
 *     buckets, each with the right rows)
 */

import { test, expect } from '@playwright/test'
import { groupRowsByProductSlug } from '../src/lib/cmf/service'
import type { CmfSkuRow } from '../src/lib/cmf/schema'

function row(productSlug: string, label: string): CmfSkuRow {
  return {
    label,
    productSlug,
    variantSlug: 'default',
    components: [
      {
        region: 'pom_ring',
        label: 'POM ring',
        material: 'POM',
      },
    ],
    palette: [],
  }
}

test('groupRowsByProductSlug returns empty array for empty input', () => {
  expect(groupRowsByProductSlug([])).toEqual([])
})

test('groupRowsByProductSlug clusters consecutive rows by slug', () => {
  const rows: CmfSkuRow[] = [
    row('switch2', 'Switch 2 Sage'),
    row('switch2', 'Switch 2 Cream'),
    row('cocoon', 'Cocoon Berry'),
  ]
  const groups = groupRowsByProductSlug(rows)
  expect(groups.map((g) => g.productSlug)).toEqual(['switch2', 'cocoon'])
  expect(groups[0].rows).toHaveLength(2)
  expect(groups[1].rows).toHaveLength(1)
})

test('groupRowsByProductSlug preserves first-encounter order', () => {
  // Workbook order matters because the importer surfaces packets in
  // the order they were created on the page; lexical reordering would
  // confuse a designer expecting "Switch 2 first because it's the first
  // tab".
  const rows: CmfSkuRow[] = [
    row('switch2', 'Switch 2 Sage'),
    row('cocoon', 'Cocoon Berry'),
    row('switch2', 'Switch 2 Cream'),
  ]
  const groups = groupRowsByProductSlug(rows)
  expect(groups.map((g) => g.productSlug)).toEqual(['switch2', 'cocoon'])
})

test('groupRowsByProductSlug interleaves correctly', () => {
  // Same first-encounter-wins ordering, but make sure rows hit the
  // right bucket regardless of where they appeared in the input.
  const rows: CmfSkuRow[] = [
    row('switch2', 'Switch 2 Sage'),
    row('cocoon', 'Cocoon Berry'),
    row('switch2', 'Switch 2 Cream'),
    row('cocoon', 'Cocoon Sage'),
  ]
  const groups = groupRowsByProductSlug(rows)
  const switch2 = groups.find((g) => g.productSlug === 'switch2')!
  const cocoon = groups.find((g) => g.productSlug === 'cocoon')!
  expect(switch2.rows.map((r) => r.label)).toEqual([
    'Switch 2 Sage',
    'Switch 2 Cream',
  ])
  expect(cocoon.rows.map((r) => r.label)).toEqual([
    'Cocoon Berry',
    'Cocoon Sage',
  ])
})

test('groupRowsByProductSlug returns the same row references (no copying)', () => {
  // The orchestrator uses these rows verbatim — they shouldn't be
  // cloned because `createPacketWithRenders` and `mergeRowsIntoPacket`
  // expect the original objects with their original component-array
  // identities for diffing.
  const r1 = row('switch2', 'Switch 2 Sage')
  const groups = groupRowsByProductSlug([r1])
  expect(groups[0].rows[0]).toBe(r1)
})
