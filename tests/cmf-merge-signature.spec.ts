import { test, expect } from '@playwright/test'
import { packetRowSignature } from '../src/lib/cmf/service'
import {
  CMF_PRODUCT_CATALOG,
  getCmfProduct,
  listCmfChildProducts,
} from '../src/lib/cmf/products'

/**
 * Smart-merge signature contract. When a workbook is re-uploaded
 * WITHOUT a `cmfCode`, `createPacketFromRows` falls back to matching
 * existing packets by their SKU signature. These cases pin the
 * properties of `packetRowSignature` so a future refactor can't
 * silently widen or break the merge key.
 */

test('packetRowSignature is order-independent across rows', () => {
  const a = packetRowSignature([
    { label: 'Loop Aphrodite — SKU 1' },
    { label: 'Loop Aphrodite — SKU 2' },
    { label: 'Loop Aphrodite — SKU 3' },
  ])
  const b = packetRowSignature([
    { label: 'Loop Aphrodite — SKU 3' },
    { label: 'Loop Aphrodite — SKU 1' },
    { label: 'Loop Aphrodite — SKU 2' },
  ])
  expect(a).toBe(b)
})

test('packetRowSignature prefers productCode over label when present', () => {
  const sigByCode = packetRowSignature([
    { productCode: 'EAR-001', label: 'Anything goes here' },
  ])
  const sigByLabel = packetRowSignature([{ label: 'EAR-001' }])
  expect(sigByCode).toBe(sigByLabel)
})

test('packetRowSignature ignores casing and punctuation differences', () => {
  // The dev workbook produces labels like "Loop Aphrodite — SKU 1"
  // (em-dash). A re-upload that normalises to "Loop Aphrodite - SKU
  // 1" (hyphen) should still merge.
  const emDash = packetRowSignature([{ label: 'Loop Aphrodite — SKU 1' }])
  const hyphen = packetRowSignature([{ label: 'loop aphrodite - SKU 1' }])
  expect(emDash).toBe(hyphen)
})

test('packetRowSignature differs when the SKU set differs by even one entry', () => {
  const three = packetRowSignature([
    { label: 'A' },
    { label: 'B' },
    { label: 'C' },
  ])
  const four = packetRowSignature([
    { label: 'A' },
    { label: 'B' },
    { label: 'C' },
    { label: 'D' },
  ])
  expect(three).not.toBe(four)
})

test('packetRowSignature returns empty string for rows without identifiers', () => {
  // The dedupe + smart-merge code skips empty signatures so two
  // packets that both have unidentifiable SKUs don't get folded
  // together by accident.
  expect(packetRowSignature([])).toBe('')
  expect(packetRowSignature([{ label: '' }, { productCode: '   ' }])).toBe('')
})

/* ── Catalog parent/child wiring ─────────────────────────────────── */

test('every case-* / pouch-* product declares a parentSlug', () => {
  for (const product of CMF_PRODUCT_CATALOG) {
    if (
      product.slug.startsWith('case-') ||
      product.slug.startsWith('pouch-')
    ) {
      expect(
        product.parentSlug,
        `${product.slug} must declare a parentSlug`
      ).toBeTruthy()
      // The parent must exist in the catalog.
      expect(getCmfProduct(product.parentSlug!)).not.toBeNull()
    }
  }
})

test('every parentSlug points at a top-tier earplug or sensewear product', () => {
  for (const product of CMF_PRODUCT_CATALOG) {
    if (!product.parentSlug) continue
    const parent = getCmfProduct(product.parentSlug)
    expect(parent).not.toBeNull()
    expect(['earplug', 'sensewear']).toContain(parent!.category)
    // The parent must NOT itself be a case (no "carry case for the
    // carry case" recursion).
    expect(parent!.parentSlug).toBeUndefined()
  }
})

test('listCmfChildProducts returns the expected case for each parent', () => {
  expect(listCmfChildProducts('switch2').map((p) => p.slug)).toEqual(['case-switch2'])
  expect(listCmfChildProducts('aphrodite').map((p) => p.slug)).toEqual(['case-aphrodite'])
  expect(listCmfChildProducts('link').map((p) => p.slug)).toEqual(['pouch-link'])
  // Cocoon and Eclipse don't have cases.
  expect(listCmfChildProducts('cocoon')).toEqual([])
  expect(listCmfChildProducts('eclipse')).toEqual([])
})

test('the generic `case` slug stays at top level (no parent)', () => {
  // Backward-compatible: legacy data keyed only on `case` should
  // continue to surface as a top-tier node so it's never hidden.
  expect(getCmfProduct('case')?.parentSlug).toBeUndefined()
})
