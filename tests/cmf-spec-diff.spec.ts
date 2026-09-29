/**
 * The CMF spec check in Vesper, held to the plugin repository's own scripts.
 *
 * `tests/fixtures/cmf/spec-diff-parity.json` was written from `codes.py` and `spec_diff.py`
 * themselves (the plugin repository at the commit it names): every cell text in the committed
 * specs, the pages of Vesper's 2026-09-22 export as pypdf read them, and whole comparisons on
 * the real case and on the repository's synthetic cases. The TypeScript port must answer the same.
 */

import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { extractCodes, colourName, isPlaceholder } from '../src/lib/creative/cmf/codes'
import { parseVesperPage, printedFromPages, runSpecCheck, expectedMatch, type Spec, type Printed } from '../src/lib/creative/cmf/spec-diff'

const PARITY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cmf', 'spec-diff-parity.json'), 'utf8'))

test.describe('codes, as codes.py reads a cell', () => {
  test('every cell text in the committed specs gives the same codes, colour name and placeholder', () => {
    expect(PARITY.codes.length).toBeGreaterThan(200)
    for (const v of PARITY.codes as Array<{ text: string; codes: unknown[]; colour_name: string | null; placeholder: string | null }>) {
      const codes = extractCodes(v.text)
      expect(codes, v.text).toEqual(v.codes)
      expect(colourName(v.text, codes), v.text).toBe(v.colour_name)
      expect(isPlaceholder(v.text), v.text).toBe(v.placeholder)
    }
  })
})

interface ParityCase {
  name: string
  spec: Spec
  printed: Record<string, Printed>
  legend: string[] | null
  columns: string[]
  layout: string
  key: unknown
  rows: unknown[]
  counts: Record<string, number>
  cells_compared: number
  assertions: { footer_names_sheet_and_time: boolean; legend_from_clown_key: boolean }
  expected?: unknown
  expected_result?: { ok: boolean; problems: string[] }
  notes?: string[]
}

test.describe("spec_diff.py's reading and comparing, ported", () => {
  test("Vesper's pages parse as parse_vesper_page parses them", () => {
    for (const v of PARITY.vesper_pages as Array<{ lines: string[]; parsed: unknown }>) {
      expect(parseVesperPage(v.lines)).toEqual(v.parsed)
    }
  })

  test('the real export, read from its pages, gives the same printed values and the same notes', () => {
    const real = (PARITY.cases as ParityCase[])[0]
    const { byColumn, legend, notes } = printedFromPages(PARITY.pypdf_pages, real.spec, 'vesper')
    expect(byColumn).toEqual(real.printed)
    expect(legend).toEqual(real.legend)
    expect(notes).toEqual(real.notes ?? [])
  })

  test('every case gives the same rows, counts, assertions and expected-case verdict', () => {
    expect((PARITY.cases as ParityCase[]).length).toBeGreaterThanOrEqual(10)
    for (const c of PARITY.cases as ParityCase[]) {
      const out = runSpecCheck(c.spec, c.printed, c.legend, c.columns, c.layout, (c.key ?? null) as never)
      expect(out.rows, c.name).toEqual(c.rows)
      expect(out.counts, c.name).toEqual(c.counts)
      expect(out.cells_compared, c.name).toBe(c.cells_compared)
      expect(out.assertions, c.name).toEqual(c.assertions)
      if (c.expected_result) {
        const [ok, problems] = expectedMatch(out.rows, c.expected as never, c.columns, out.assertions)
        expect([ok, problems], c.name).toEqual([c.expected_result.ok, c.expected_result.problems])
      }
    }
  })

  test("the real case matches its expected.json: 117 rows and both page assertions", () => {
    const real = (PARITY.cases as ParityCase[])[0]
    const out = runSpecCheck(real.spec, real.printed, real.legend, real.columns, 'vesper')
    const [ok, problems] = expectedMatch(out.rows, real.expected as never, real.columns, out.assertions)
    expect(problems).toEqual([])
    expect(ok).toBe(true)
    expect(out.clean).toBe(false)
  })
})
