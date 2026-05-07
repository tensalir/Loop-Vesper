import { test, expect } from '@playwright/test'
import {
  buildCmfTemplateWorkbook,
  parseCmfWorkbook,
  XlsxParseError,
} from '../src/lib/cmf/xlsx'

/**
 * Round-trip test for the XLSX template helper. Build a template, parse it
 * back, and confirm the example row survives. This pins our header
 * convention so a future SheetJS version that changes default options
 * doesn't quietly break imports.
 */

test('buildCmfTemplateWorkbook produces a workbook the parser accepts', () => {
  const buffer = buildCmfTemplateWorkbook('switch2')
  expect(buffer.length).toBeGreaterThan(100)
  const parsed = parseCmfWorkbook(buffer)
  expect(parsed.sheetName).toBe('CMF')
  expect(parsed.headers).toContain('label')
  expect(parsed.headers).toContain('product_slug')
  expect(parsed.rows).toHaveLength(1)
  expect(parsed.rows[0].label).toBe('Switch 2 Sage')
  expect(parsed.rows[0].product_slug).toBe('switch2')
  expect(parsed.rows[0].pom_ring_pantone).toBe('PANTONE 17-5641 TCX')
})

test('parseCmfWorkbook throws an XlsxParseError for non-workbook bytes', () => {
  expect(() => parseCmfWorkbook(Buffer.from('not an xlsx file'))).toThrow(
    XlsxParseError
  )
})
