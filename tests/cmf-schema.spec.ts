import { test, expect } from '@playwright/test'
import { normaliseRawRows } from '../src/lib/cmf/schema'

/**
 * Unit tests for the CMF schema normaliser. The function takes spreadsheet-
 * style raw rows (header-keyed objects) and produces validated SKU rows plus
 * a structured error report. These tests pin its behaviour for the column-name
 * synonyms designers actually use in workbooks.
 */

test.describe('normaliseRawRows', () => {
  test('parses a clean Switch 2 row with three components', () => {
    const result = normaliseRawRows([
      {
        label: 'Switch 2 Sage',
        product_slug: 'switch2',
        colorway_name: 'Sage',
        product_code: 'SW2-SAGE-001',
        ean: '5400000000017',
        cmf_code: 'CMF-001234revA',
        packet_name: 'Switch 2 Spring 2026',
        clown_slug: 'switch2-clown-1',
        pom_ring_pantone: 'PANTONE 17-5641 TCX',
        pom_ring_material: 'POM',
        pom_ring_finish: 'Matte',
        cosmetic_cap_pantone: 'PANTONE 11-0602 TCX',
        cosmetic_cap_material: 'PC/ABS',
        cosmetic_cap_finish: 'Satin',
        silicone_tip_pantone: 'PANTONE 14-4313 TCX',
        silicone_tip_material: 'Silicone',
        silicone_tip_finish: 'Matte',
      },
    ])

    expect(result.errors).toEqual([])
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    expect(row.productSlug).toBe('switch2')
    expect(row.colorwayName).toBe('Sage')
    expect(row.productCode).toBe('SW2-SAGE-001')
    expect(row.cmfCode).toBe('CMF-001234revA')
    expect(row.components).toHaveLength(3)
    const pom = row.components.find((c) => c.region === 'pom_ring')
    expect(pom).toBeTruthy()
    expect(pom?.pantone).toBe('PANTONE 17-5641 TCX')
    expect(pom?.material).toBe('POM')
    expect(pom?.finish).toBe('Matte')
    // The parser should have enriched colorHex from the Pantone code so
    // the downstream prompt has a numeric colour anchor without further
    // plumbing. PANTONE 17-5641 TCX → #009969 in our extensions table.
    expect(pom?.colorHex?.toLowerCase()).toBe('#009969')
  })

  test('enriches colorHex from a known Pantone code when the workbook leaves it blank', () => {
    // Workbooks usually carry the Pantone code but no hex column. The
    // parser is the right place to fill that gap so the enriched value
    // propagates to the DB, the prompt, and the PDF swatches with no
    // further plumbing.
    const result = normaliseRawRows([
      {
        label: 'Switch 2 Emerald',
        product_slug: 'switch2',
        colorway_name: 'Emerald',
        pom_ring_pantone: 'Pantone 7720 C',
        pom_ring_material: 'POM',
        pom_ring_finish: 'Matte',
      },
    ])
    expect(result.errors).toEqual([])
    const pom = result.rows[0].components.find((c) => c.region === 'pom_ring')
    expect(pom?.colorHex?.toLowerCase()).toBe('#247b5e')
  })

  test('respects an explicit hex value over the Pantone-derived one', () => {
    // When the workbook does carry a hex, it wins — designers may have
    // calibrated values per-batch that differ from the generic Pantone
    // approximation.
    const result = normaliseRawRows([
      {
        label: 'Switch 2 Emerald',
        product_slug: 'switch2',
        colorway_name: 'Emerald',
        pom_ring_pantone: 'Pantone 7720 C',
        pom_ring_color_hex: '#aabbcc',
        pom_ring_material: 'POM',
        pom_ring_finish: 'Matte',
      },
    ])
    expect(result.errors).toEqual([])
    const pom = result.rows[0].components.find((c) => c.region === 'pom_ring')
    expect(pom?.colorHex?.toLowerCase()).toBe('#aabbcc')
  })

  test('accepts case-insensitive headers and trims whitespace', () => {
    const result = normaliseRawRows([
      {
        Label: '  Engage 2 Boreas  ',
        Product: 'engage2',
        'Colorway Name': '  Boreas  ',
        'POM Ring Pantone': 'PANTONE 18-4622 TCX',
      },
    ])
    expect(result.errors).toEqual([])
    expect(result.rows[0].label).toBe('Engage 2 Boreas')
    expect(result.rows[0].colorwayName).toBe('Boreas')
    expect(result.rows[0].components[0].region).toBe('pom_ring')
  })

  test('accepts hex values without # prefix', () => {
    const result = normaliseRawRows([
      {
        product_slug: 'switch2',
        pom_ring_color_hex: '6b4eff',
      },
    ])
    expect(result.errors).toEqual([])
    expect(result.rows[0].components[0].colorHex).toBe('#6b4eff')
  })

  test('reports missing productSlug as a structured error', () => {
    const result = normaliseRawRows([{ label: 'No product', pom_ring_pantone: '17-5641' }])
    expect(result.rows).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].field).toBe('productSlug')
  })

  test('reports unknown productSlug as a structured error', () => {
    const result = normaliseRawRows([{ product_slug: 'galaxy_brain', label: 'X' }])
    expect(result.rows).toEqual([])
    expect(result.errors[0].message).toContain('unknown product slug')
  })

  test('drops rows where every component is empty', () => {
    const result = normaliseRawRows([{ product_slug: 'switch2', label: 'Empty SKU' }])
    expect(result.rows).toEqual([])
    expect(result.errors[0].message).toContain('at least one component')
  })

  test('rejects malformed hex values with a row-level error', () => {
    const result = normaliseRawRows([
      {
        product_slug: 'switch2',
        pom_ring_color_hex: 'GG',
      },
    ])
    // The bad colorHex is dropped during component build; the row then has
    // no components and fails Zod validation with the friendly message.
    expect(result.rows).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('multiple rows: keeps good rows and reports per-row errors', () => {
    const result = normaliseRawRows([
      {
        product_slug: 'switch2',
        label: 'OK row',
        pom_ring_pantone: '17-5641',
      },
      { product_slug: 'unknown_product', label: 'Bad row' },
    ])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].label).toBe('OK row')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].rowIndex).toBe(1)
  })
})
