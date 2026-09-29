/**
 * The CMF workbook read the way workbook.py reads it (src/lib/creative/cmf/workbook.ts).
 *
 * The rules are tested on grids built here. On a machine that holds the real workbook (the upload
 * of 2026-09-22 the plugin repository's specs were built from; never committed), every product tab
 * is read and held to the committed spec file cell by cell: value, placeholder, fill, flags and
 * codes. It is skipped elsewhere.
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { parseTab, parseWorkbookBytes } from '../src/lib/creative/cmf/workbook'
import { effective } from '../src/lib/creative/cmf/spec-diff'
import { C, F, grid, H, Y } from './helpers/cmf-grid'

test('the structure comes from the fills; a yellow cell is required; a gap stays a gap', () => {
  const spec = parseTab(
    grid('Switch 2', [
      [H(null), H('Common specs'), H('SKU 1'), H('Sage')],
      [C('BANNER'), null, null, null],
      [F('  Product Name'), null, Y('Switch 2 Cream'), Y('xxxxxxxxxxx')],
      [C('POM Ring'), null, null, null],
      [F('  Material'), 'POM', Y(null), Y('PC')],
      [F('  Colour'), null, Y('Pantone Warm Grey 9C'), Y('Pantone 544C + 427C + white')],
    ]),
    { file: 'w.xlsx', sha256: 'ab'.repeat(32), modified: '2026-09-22T09:20:42Z' }
  )
  expect(spec.tab).toBe('Switch 2')
  expect(spec.skus.map((s) => [s.column, s.header, s.name, s.in_scope])).toEqual([
    ['C', 'SKU 1', 'Switch 2 Cream', true],
    ['D', 'Sage', null, true],
  ])
  const comp = spec.components[0]
  expect(comp.header).toBe('POM Ring')
  const material = comp.fields.find((f) => f.name === 'Material')!
  expect(material.common?.value).toBe('POM')
  expect(material.by_sku.C?.required).toBe(true)
  // A yellow cell left empty is not filled from Common specs: the check refuses it.
  expect(effective(material, 'C')).toBeNull()
  const colour = comp.fields.find((f) => f.name === 'Colour')!
  expect(colour.by_sku.C?.value).toBe('Pantone Warm Grey 9C')
  expect((colour.by_sku.D?.codes ?? []).map((c) => c.raw)).toEqual(['Pantone 544C', '427C'])
})

test('without fills, an unindented row with nothing beside it is a header and an indented one a field', () => {
  const spec = parseTab(
    grid('Cocoon', [
      [null, 'Common specs', 'SKU 1'],
      ['BANNER', null, null],
      ['  Product Name', null, 'Berry'],
      ['Headband', null, null],
      ['  Material', null, 'TPE'],
      ['  Finish', null, 'Matte'],
    ])
  )
  expect(spec.components.map((c) => [c.header, c.fields.map((f) => f.name)])).toEqual([['Headband', ['Material', 'Finish']]])
  expect(spec.skus[0].name).toBe('Berry')
})

test('a typed date reads as an ISO date; text dd/mm/yyyy in Edit Date too; an EAN loses its quote', () => {
  const spec = parseTab(
    grid('Link', [
      [H(null), H('Common specs'), H('SKU 1')],
      [C('BANNER'), null, null],
      [F('  Edit Date'), null, Y({ kind: 'date', y: 2026, m: 7, d: 7, time: { H: 0, M: 0, S: 0 } })],
      [F('  EAN code'), null, Y('"5400000000017')],
      [F('  Product Code'), null, Y(1234)],
    ])
  )
  const banner = spec.banner as Record<string, Record<string, { value: unknown; raw: unknown; flags: string[] }>>
  expect(banner['Edit Date'].C.value).toBe('2026-07-07')
  expect(banner['Edit Date'].C.raw).toBe('2026-07-07 00:00:00')
  expect(banner['EAN code'].C.value).toBe('5400000000017')
  expect(banner['EAN code'].C.flags).toEqual(['leading_quote'])
  expect(banner['Product Code'].C.value).toBe('1234')
})

// ------------------------------------------------------------------ the real workbook, where it is

function findWorkbook(): { xlsx: string; specDir: string; sha256: string } | null {
  const roots = [
    process.env.LOOP_ASSET_REVIEWER_DIR,
    path.join(__dirname, '..', '..', '..', 'loop-asset-reviewer-cmf'),
    path.join(__dirname, '..', '..', '..', 'loop-asset reviewer'),
  ].filter((p): p is string => !!p)
  for (const root of roots) {
    const dir = path.join(root, 'workstreams', 'cmf', 'references', 'workbook')
    const specDir = path.join(dir, 'spec')
    const probe = path.join(specDir, 'experience-2-cc.json')
    if (!fs.existsSync(probe)) continue
    const wb = JSON.parse(fs.readFileSync(probe, 'utf8')).workbook
    const xlsx = path.join(dir, wb.file)
    if (!fs.existsSync(xlsx)) continue
    const sha = crypto.createHash('sha256').update(fs.readFileSync(xlsx)).digest('hex')
    if (sha === wb.sha256) return { xlsx, specDir, sha256: sha }
  }
  return null
}

const REAL = findWorkbook()

function cellView(rec: unknown) {
  if (rec === null || rec === undefined) return rec
  const r = rec as Record<string, unknown>
  return {
    raw: r.raw,
    value: r.value,
    placeholder: r.placeholder,
    required: r.required,
    fill: r.fill,
    flags: r.flags,
    ...(r.codes !== undefined ? { codes: (r.codes as Array<{ raw: string }>).map((c) => c.raw), colour_name: r.colour_name } : {}),
  }
}

function specView(spec: Record<string, unknown>) {
  const banner: Record<string, unknown> = {}
  for (const [name, entry] of Object.entries((spec.banner ?? {}) as Record<string, Record<string, unknown>>)) {
    banner[name] = Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, k === 'row' ? v : cellView(v)]))
  }
  return {
    tab: spec.tab,
    header_row: spec.header_row,
    common_header: spec.common_header,
    collection: spec.collection,
    skus: (spec.skus as Array<Record<string, unknown>>).map((s) => ({ column: s.column, header: s.header, name: s.name, in_scope: s.in_scope, scope_reason: s.scope_reason })),
    banner,
    sections: spec.sections,
    components: (spec.components as Array<Record<string, unknown>>).map((c) => ({
      header: c.header,
      section: c.section,
      row: c.row,
      fields: (c.fields as Array<Record<string, unknown>>).map((f) => ({
        name: f.name,
        row: f.row,
        common: cellView(f.common),
        by_sku: Object.fromEntries(Object.entries(f.by_sku as Record<string, unknown>).map(([k, v]) => [k, cellView(v)])),
      })),
    })),
  }
}

test.describe('the real workbook, read in Vesper', () => {
  test.skip(!REAL, 'the workbook the committed specs were built from is not on this machine (it is never committed)')

  test('every product tab equals the spec workbook.py committed, cell by cell', () => {
    const specs = parseWorkbookBytes(fs.readFileSync(REAL!.xlsx))
    const files = fs.readdirSync(REAL!.specDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      const want = JSON.parse(fs.readFileSync(path.join(REAL!.specDir, file), 'utf8'))
      const got = specs[want.tab]
      expect(got, `tab ${want.tab}`).toBeTruthy()
      expect(specView(got as unknown as Record<string, unknown>), `tab ${want.tab}`).toEqual(specView(want))
    }
  })
})
