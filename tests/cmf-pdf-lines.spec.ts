/**
 * A PDF's lines as pypdf gives them to spec_diff.py, read with pdf.js (src/lib/creative/cmf/pdf-lines.ts).
 *
 * The rule is tested on synthetic pdf.js items everywhere. On a machine that holds the spec case's
 * PDF (Vesper's export of 2026-09-22, never committed; the plugin repository's
 * `workstreams/cmf/references/renders/pdf/`), the whole path is checked on it: every line equal to
 * pypdf's, the pages read into the same printed values, and the case's expected.json matched. It is
 * skipped elsewhere, as the repository skips it.
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { linesFromItems, pdfPages } from '../src/lib/creative/cmf/pdf-lines'
import { expectedMatch, printedFromPages, runSpecCheck } from '../src/lib/creative/cmf/spec-diff'

const PARITY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cmf', 'spec-diff-parity.json'), 'utf8'))
const PDF_NAME = 'tml-2027-loop-experience-2-carry-case--2026-09-22.pdf'

function findCasePdf(): string | null {
  const roots = [
    process.env.LOOP_ASSET_REVIEWER_DIR,
    path.join(__dirname, '..', '..', '..', 'loop-asset reviewer'),
    path.join(__dirname, '..', '..', '..', 'loop-asset-reviewer-cmf'),
  ].filter((p): p is string => !!p)
  for (const root of roots) {
    const p = path.join(root, 'workstreams', 'cmf', 'references', 'renders', 'pdf', PDF_NAME)
    if (fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') === PARITY.pdf.sha256) return p
  }
  return null
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

test('an empty item or a wide gap ends a line; a word space and a wrapped line do not', () => {
  const at = (str: string, x: number, w: number, extra: Record<string, unknown> = {}) => ({ str, width: w, height: 8, transform: [8, 0, 0, 8, x, 100], ...extra })
  const items = [
    at('', 46, 0, { hasEOL: true }),
    at('Material', 46, 28.4),
    at(' ', 74.4, 31.6),
    at('ABS', 106, 16),
    at('', 46, 0, { hasEOL: true }),
    at('Experience carry case', 36, 100.8),
    at(' ', 136.8, 4.8),
    at('back', 141.6, 19.2, { hasEOL: true }),
    at('clown', 36, 24),
    at('', 46, 0, { hasEOL: true }),
    at('Pantone', 46, 30),
    at('544C', 76, 18),
  ]
  expect(linesFromItems(items)).toEqual(['Material', 'ABS', 'Experience carry case back clown', 'Pantone544C'])
})

const CASE_PDF = findCasePdf()

test.describe('the spec case PDF, read with pdf.js', () => {
  test.skip(!CASE_PDF, 'the spec case PDF is not on this machine (it is never committed)')

  test("every line equals pypdf's, and the check matches the case's expected rows", async () => {
    const pages = await pdfPages(fs.readFileSync(CASE_PDF!))
    expect(pages.map((p) => p.length)).toEqual((PARITY.pypdf_pages as string[][]).map((p) => p.length))
    pages.forEach((p, i) => expect(p.map(collapse)).toEqual((PARITY.pypdf_pages[i] as string[]).map(collapse)))
    const real = PARITY.cases[0]
    const { byColumn, legend } = printedFromPages(pages, real.spec, 'vesper')
    expect(byColumn).toEqual(real.printed)
    const out = runSpecCheck(real.spec, byColumn, legend, real.columns, 'vesper')
    const [ok, problems] = expectedMatch(out.rows, real.expected, real.columns, out.assertions)
    expect(problems).toEqual([])
    expect(ok).toBe(true)
  })
})
