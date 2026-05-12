import { test, expect } from '@playwright/test'
import * as XLSX from 'xlsx'
import {
  buildCmfTemplateWorkbook,
  getFlatRawRows,
  parseCmfWorkbook,
  XlsxParseError,
} from '../src/lib/cmf/xlsx'
import { normaliseParsedSheets, normaliseRawRows } from '../src/lib/cmf/schema'

/* ── Flat (legacy) format ────────────────────────────────────────────────── */

test('buildCmfTemplateWorkbook produces a workbook the parser accepts', () => {
  const buffer = buildCmfTemplateWorkbook('switch2')
  expect(buffer.length).toBeGreaterThan(100)
  const parsed = parseCmfWorkbook(buffer)
  expect(parsed.format).toBe('flat')

  // The flat path keeps the legacy column-keyed shape behind getFlatRawRows.
  const rows = getFlatRawRows(buffer)
  expect(rows).toHaveLength(1)
  expect(rows[0].label).toBe('Switch 2 Sage')
  expect(rows[0].product_slug).toBe('switch2')
  expect(rows[0].pom_ring_pantone).toBe('PANTONE 17-5641 TCX')

  const normalised = normaliseRawRows(rows)
  expect(normalised.errors).toHaveLength(0)
  expect(normalised.rows[0].label).toBe('Switch 2 Sage')
  expect(normalised.rows[0].productSlug).toBe('switch2')
})

test('parseCmfWorkbook throws an XlsxParseError for non-workbook bytes', () => {
  expect(() => parseCmfWorkbook(Buffer.from('not an xlsx file'))).toThrow(
    XlsxParseError
  )
})

/* ── Transposed format ───────────────────────────────────────────────────── */

function buildTransposedFixture(opts?: { skuCount?: number }): Buffer {
  const skuCount = opts?.skuCount ?? 3
  const skuColumns = Array.from({ length: skuCount }).map((_, i) => `SKU ${i + 1}`)

  // Switch 2 tab — only SKU 1 is filled, the rest are placeholders.
  const switch2 = [
    ['', 'Common specs', ...skuColumns],
    ['BANNER', '', ...new Array(skuCount).fill('')],
    ['CMF number', '', 'CMF-001234revA', ...new Array(skuCount - 1).fill('CMF-xxxxxx rev x')],
    ['Collection', 'Switch 2', ...new Array(skuCount).fill('')],
    ['Product Name', '', 'Switch 2 Emerald', ...new Array(skuCount - 1).fill('xxxxxxxxxxx')],
    ['Product Code', '', 'en-sw-emb-02', ...new Array(skuCount - 1).fill('xxxxxxxxxxx')],
    ['EAN code', '', '5407009941993', ...new Array(skuCount - 1).fill('xxxxxxxxxxx')],
    ['Edit Date', '', '2024-06-03', ...new Array(skuCount - 1).fill('xx/xx/xxxx')],
    ['Drawn by', 'Damien', ...new Array(skuCount).fill('')],
    ['POM RING', '', ...new Array(skuCount).fill('')],
    ['Material', 'POM', ...new Array(skuCount).fill('')],
    ['Finish', 'Matte', ...new Array(skuCount).fill('')],
    [
      'Colour',
      '',
      'Pantone 7720C',
      ...new Array(skuCount - 1).fill('Pantone xxxxxxxxxxx'),
    ],
    ['COSMETIC CAP', '', ...new Array(skuCount).fill('')],
    ['Material', 'ABS', ...new Array(skuCount).fill('')],
    ['Outer surface finish', 'NCVM', 'Satin', ...new Array(skuCount - 1).fill('xxxxxxxxxxx')],
    [
      'Colour',
      '',
      'Pantone 7720C',
      ...new Array(skuCount - 1).fill('Pantone xxxxxxxxxxx'),
    ],
  ]

  const aphroditeCC = [
    ['', 'Common specs', ...skuColumns],
    ['BANNER', '', ...new Array(skuCount).fill('')],
    ['Collection', 'Aphrodite Carry Case', ...new Array(skuCount).fill('')],
    ['CARRY CASE (1-11)', '', ...new Array(skuCount).fill('')],
    ['1. Case lid housing', '', ...new Array(skuCount).fill('')],
    ['Material', 'PC or PC/ABS', ...new Array(skuCount).fill('')],
    ['Colour', '', 'Pantone 18-1664', ...new Array(skuCount - 1).fill('Pantone xxxxxxxxxxx')],
    ['Finish', 'High-gloss', ...new Array(skuCount).fill('')],
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(switch2), 'Switch 2')
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(aphroditeCC),
    'Aphrodite CC'
  )
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}

test('parseCmfWorkbook detects the transposed schema and maps sheets to products', () => {
  const buffer = buildTransposedFixture()
  const parsed = parseCmfWorkbook(buffer)
  expect(parsed.format).toBe('transposed')
  expect(parsed.unmappedSheets).toEqual([])
  expect(parsed.sheets.map((s) => s.productSlug).sort()).toEqual(
    ['case-aphrodite', 'switch2'].sort()
  )
})

test('transposed parser ignores placeholder SKU columns', () => {
  const buffer = buildTransposedFixture({ skuCount: 3 })
  const parsed = parseCmfWorkbook(buffer)
  const switch2 = parsed.sheets.find((s) => s.productSlug === 'switch2')
  expect(switch2).toBeTruthy()
  // Only SKU 1 was filled — the other two are pure placeholders.
  expect(switch2!.skus).toHaveLength(1)
  expect(switch2!.skus[0].banner.productName).toBe('Switch 2 Emerald')
  expect(switch2!.skus[0].banner.productCode).toBe('en-sw-emb-02')
})

test('transposed parser captures component spec with common + per-SKU values', () => {
  const buffer = buildTransposedFixture({ skuCount: 1 })
  const parsed = parseCmfWorkbook(buffer)
  const switch2 = parsed.sheets.find((s) => s.productSlug === 'switch2')!
  const sku = switch2.skus[0]

  const pom = sku.components.find((c) => /pom/i.test(c.region))!
  expect(pom).toBeTruthy()
  expect(pom.material).toBe('POM')
  expect(pom.finish).toBe('Matte')
  expect(pom.pantone).toBe('Pantone 7720C')

  const cap = sku.components.find((c) => /cosmetic/i.test(c.region))!
  expect(cap.material).toBe('ABS')
  expect(cap.pantone).toBe('Pantone 7720C')
})

test('normaliseParsedSheets produces validated CmfSkuRows', () => {
  const buffer = buildTransposedFixture({ skuCount: 1 })
  const parsed = parseCmfWorkbook(buffer)
  const result = normaliseParsedSheets(parsed.sheets)
  expect(result.errors).toHaveLength(0)
  expect(result.rows).toHaveLength(2) // Switch 2 + Aphrodite CC

  const switch2Row = result.rows.find((r) => r.productSlug === 'switch2')!
  expect(switch2Row.colorwayName).toBe('Switch 2 Emerald')
  expect(switch2Row.productCode).toBe('en-sw-emb-02')
  expect(switch2Row.cmfCode).toBe('CMF-001234revA')
  expect(switch2Row.components.length).toBeGreaterThanOrEqual(2)
})

/* ── Multi-product (Damien's Switch 2 + Cocoon ask) ──────────────────── */

/**
 * Damien asked: "what if I filled the Switch 2 + Cocoon in my Excel for
 * example? Because I have the feeling it's product per product the render
 * generation". The data flow is intentionally product-per-packet — a
 * single workbook with both tabs produces one packet per product, each
 * scoped to that product's SKUs. This fixture pins that property at the
 * parser/normaliser level so future changes don't quietly collapse the
 * two products into one packet.
 */
function buildSwitch2PlusCocoonFixture(): Buffer {
  const switch2 = [
    ['', 'Common specs', 'SKU 1'],
    ['BANNER', '', ''],
    ['CMF number', '', 'CMF-001234revA'],
    ['Collection', 'Switch 2', ''],
    ['Product Name', '', 'Switch 2 Emerald'],
    ['Product Code', '', 'en-sw-emb-02'],
    ['POM RING', '', ''],
    ['Material', 'POM', ''],
    ['Finish', 'Matte', ''],
    ['Colour', '', 'Pantone 7720C'],
  ]
  const cocoon = [
    ['', 'Common specs', 'SKU 1'],
    ['BANNER', '', ''],
    ['CMF number', '', 'CMF-002000revA'],
    ['Collection', 'Cocoon', ''],
    ['Product Name', '', 'Cocoon Berry'],
    ['Product Code', '', 'cc-ber-01'],
    ['EAR CUSHION', '', ''],
    ['Material', 'Fabric', ''],
    ['Finish', 'Soft', ''],
    ['Colour', '', 'Pantone 1777C'],
    ['FOAM', '', ''],
    ['Material', 'PU foam', ''],
    ['Colour', '', 'Black'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(switch2), 'Switch 2')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cocoon), 'Cocoon')
  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}

test('a Switch 2 + Cocoon workbook produces one normalised row per product', () => {
  const buffer = buildSwitch2PlusCocoonFixture()
  const parsed = parseCmfWorkbook(buffer)
  expect(parsed.format).toBe('transposed')
  expect(parsed.sheets.map((s) => s.productSlug).sort()).toEqual(['cocoon', 'switch2'])

  const result = normaliseParsedSheets(parsed.sheets)
  expect(result.errors).toHaveLength(0)
  // One row per product (one filled SKU column on each tab).
  expect(result.rows).toHaveLength(2)
  const slugs = result.rows.map((r) => r.productSlug).sort()
  expect(slugs).toEqual(['cocoon', 'switch2'])
})

test('bucketing rows by productSlug preserves the multi-product split that createPacketFromRows relies on', () => {
  // The packet creator groups by `productSlug` into one packet per product.
  // Replicate that grouping here so the property stays explicitly tested
  // without dragging Prisma into a unit test.
  const buffer = buildSwitch2PlusCocoonFixture()
  const parsed = parseCmfWorkbook(buffer)
  const result = normaliseParsedSheets(parsed.sheets)

  const buckets = new Map<string, number>()
  for (const row of result.rows) {
    buckets.set(row.productSlug, (buckets.get(row.productSlug) ?? 0) + 1)
  }
  expect(buckets.size).toBe(2)
  expect(buckets.get('switch2')).toBe(1)
  expect(buckets.get('cocoon')).toBe(1)
})
