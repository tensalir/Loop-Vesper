/**
 * The supplier CMF PDF built by code (src/lib/creative/cmf/supplier-pdf.ts) and the gate it passes
 * before it is saved (supplier-pdf-check.ts): the PDF's own bytes read back and compared with the
 * workbook's cells, to the product repository's spec-fields.md.
 *
 *   - always: the committed Experience 2 CC spec (tests/fixtures/cmf/prompt-parity.json), columns D
 *     (Ice blu marble: a marble finish, a compound colour cell) and E (Ice blu classic matte: a
 *     carry case with Outer and Inner Shell), through the product repository's front key
 *   - where the real 2026-09-22 workbook is on the machine (never committed): five SKUs of mixed
 *     complexity parsed from it, standing in until Damien names his five
 *   - where the product repository and pypdf are on the machine: spec_diff.py --layout ours on the
 *     same PDFs, row for row
 *
 * The real workbook still holds placeholders in five banner cells of every SKU (CMF number,
 * Product Code, EAN code, Checked by 1 and 2). The clean runs fill those five cells in the test,
 * labelled TEST-FILLED, and nothing else; the unfilled workbook is shown to refuse, naming each.
 */

import { test, expect } from '@playwright/test'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as XLSX from 'xlsx'
import { buildSupplierPdf, footerTrace, legendFromKey, type SupplierPdfInput } from '../src/lib/creative/cmf/supplier-pdf'
import { checkSupplierPdf, supplierCheckText } from '../src/lib/creative/cmf/supplier-pdf-check'
import { collapse, effective, parseOursPage, printedFromPages, runSpecCheck, type ClownKey, type Spec } from '../src/lib/creative/cmf/spec-diff'
import { coreModified, parseWorkbookBytes, workbookInfoForUpload, type WorkbookInfo } from '../src/lib/creative/cmf/workbook'
import type { ClownKeyFile } from '../src/lib/creative/cmf/prompt-fill'
import { CmfError } from '../src/lib/creative/cmf/kit-cmf'
import { clone, findRealWorkbook, pendingBannerCells, png, specToXlsx, testConfirmed, testKeyFor, withTestFilledBanner, TEST_FILLED } from './helpers/cmf-supplier'

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cmf', 'prompt-parity.json'), 'utf8'))
const E2CC = FIX.specs['references/workbook/spec/experience-2-cc.json'] as Spec
const FRONT = testConfirmed(FIX.keys['case-experience2--front'] as ClownKeyFile)
const FOOTER_MARK = /^--\s*\d+\s+of\s+\d+\s*--$/

async function built(spec: Spec, columns: string[], key: ClownKeyFile, workbook: WorkbookInfo = spec.workbook as WorkbookInfo) {
  const renders: SupplierPdfInput['renders'] = {}
  for (let i = 0; i < columns.length; i++) renders[columns[i]] = { bytes: await png(40 + i * 40, 90, 160), mimeType: 'image/png' }
  const pdf = await buildSupplierPdf({ spec, columns, key: { id: String(key.clown?.id), file: key }, renders, clown: { bytes: await png(213, 28, 27, 128, 128), mimeType: 'image/png' }, workbook })
  const check = await checkSupplierPdf({ bytes: pdf.bytes, spec, columns, key: key as ClownKey, workbook })
  return { pdf, check }
}

async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(CmfError)
    return (err as Error).message
  }
  throw new Error('expected a refusal')
}

// ------------------------------------------------------------------ always: the committed Experience 2 CC spec

test.describe('the supplier PDF from the committed Experience 2 CC spec', () => {
  const COLS = ['D', 'E']
  const filled = withTestFilledBanner(E2CC, COLS)

  test('D (marble, a compound colour cell) and E (Outer and Inner Shell): every value read back equals its cell', async () => {
    const { pdf, check } = await built(filled, COLS, FRONT)
    const bad = check.rows.filter((r) => r.state !== 'match')
    expect(bad, supplierCheckText(filled, check)).toEqual([])
    expect(check.clean).toBe(true)
    // Nine header cells and every component field of both SKUs.
    const fields = E2CC.components.reduce((n, c) => n + c.fields.length, 0)
    expect(check.cells_compared).toBe(COLS.length * (9 + fields))
    expect(pdf.fileName).toBe('CMF-TEST01_rev_A_Experience_2_Carry_Case_CMF_Ice_blu_marble_Ice_blu_classic_matte.pdf')
    // The compound cell is printed whole.
    const insert = check.rows.find((r) => r.column === 'D' && r.component === 'Insert' && r.field === 'Colour')!
    expect(insert.pdf).toBe('Silicon mix marble imitation Pantone 544C + 427C + 5405 + white')
  })

  test('the page order: one page per SKU in the sheet order, then one part-breakdown page; the legend is the key, in its order', async () => {
    const { pdf, check } = await built(filled, ['E', 'D'].sort(), FRONT)
    expect(pdf.pages).toEqual([
      { kind: 'sku', column: 'D' },
      { kind: 'sku', column: 'E' },
      { kind: 'breakdown', column: null },
    ])
    const kinds = check.pages.map((p) => parseOursPage(p, filled).kind)
    expect(kinds).toEqual(['sku', 'sku', 'breakdown'])
    expect(check.pages.map((p) => parseOursPage(p, filled).title)).toEqual(['Ice blu marble', 'Ice blu classic matte', null])
    const want = legendFromKey(FRONT).map((l) => l.component)
    expect(want).toEqual(['Shell - Front', 'Shell - Back', 'Insert'])
    // Component, label and zone are one list: each line carries the chip of every zone that marks it.
    expect(legendFromKey(FRONT).map((l) => l.hexes)).toEqual([['#D51C1B', '#206893'], ['#D51C1B', '#206893'], ['#C6B807']])
    expect(parseOursPage(check.pages[2], filled).legend).toEqual(want)
    expect(pdf.legend).toEqual(want)
    const legendRow = check.rows.find((r) => r.component === 'LEGEND')!
    expect(legendRow.state).toBe('match')
    // What is not on the clown is said, apart from the legend.
    expect(check.pages[2]).toContain('Not on this clown: Cord, ARTWORK')
  })

  test('the footer on every page names the workbook file, its modified time and its sha256', async () => {
    const { check } = await built(filled, COLS, FRONT)
    const trace = footerTrace(E2CC.workbook as WorkbookInfo)
    expect(trace).toBe('8b5140d2-aa0b-442e-a35c-c3f7778f954b.xlsx · modified 2026-09-22T09:20:42Z · sha256 a13964bfc229')
    expect(check.pages).toHaveLength(3)
    check.pages.forEach((lines, i) => {
      expect(lines[0].startsWith(`${trace} · time: `), `page ${i + 1}`).toBe(true)
      expect(lines.filter((l) => FOOTER_MARK.test(l)), `page ${i + 1}`).toEqual([`-- ${i + 1} of 3 --`])
      const ft = parseOursPage(lines, filled).footer!
      expect(ft).toEqual({ workbook: '8b5140d2-aa0b-442e-a35c-c3f7778f954b.xlsx', modified: '2026-09-22T09:20:42Z', sha256: 'a13964bfc229' })
    })
  })

  test('the text read out of the PDF equals the cells, once whitespace is collapsed', async () => {
    const { check } = await built(filled, COLS, FRONT)
    const { byColumn } = printedFromPages(check.pages, filled, 'ours')
    for (const col of COLS) {
      const page = byColumn[col]
      for (const comp of filled.components) {
        for (const f of comp.fields) {
          const rec = effective(f, col)
          const cell = rec && rec.value !== null && rec.value !== undefined ? collapse(rec.value) : ''
          expect(collapse(page.components?.[comp.header]?.[f.name] ?? ''), `${col} ${comp.header} · ${f.name}`).toBe(cell)
        }
      }
      expect(page.header?.['Edit Date']).toBe(col === 'D' ? '2026-07-08' : '2026-07-07')
      expect(page.header?.['Drawn by']).toBe('Damien')
      expect(page.header?.['Collection']).toBe('Experience 2 Carry Case')
    }
  })

  test("the part-breakdown page: no per-colourway colour, and the cells every SKU shares, each checked", async () => {
    const { check } = await built(filled, COLS, FRONT)
    const breakdown = check.rows.filter((r) => r.part === 'breakdown')
    expect(breakdown.length).toBeGreaterThan(9)
    expect(breakdown.every((r) => r.state === 'match')).toBe(true)
    const page = check.pages[2].join('\n')
    expect(page).not.toMatch(/Pantone/)
    expect(page).toContain('Antistatic Coating + Grinding')
  })

  test('the real, unfilled cells refuse, naming every placeholder cell of each SKU', async () => {
    const { check } = await built(E2CC, COLS, FRONT)
    expect(check.clean).toBe(false)
    const blocked = check.rows.filter((r) => r.state === 'empty_in_sheet').map((r) => `${r.where} (${r.field})`)
    const want = COLS.flatMap((c) => pendingBannerCells(E2CC, c))
    expect(want).toHaveLength(COLS.length * TEST_FILLED.length)
    expect(blocked.sort()).toEqual(want.sort())
    const text = supplierCheckText(E2CC, check)
    expect(text).toContain('SKU D (Ice blu marble) · BANNER · CMF number · cell Experience 2 CC!D3: workbook "CMF-xxxxxx rev x"')
    expect(text).toContain('SKU E (Ice blu classic matte) · BANNER · Checked by 2 · cell Experience 2 CC!E11')
  })

  test('a deliberately broken cell refuses with its name: a required cell emptied', async () => {
    const broken = clone(filled)
    const colour = broken.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Colour')!
    colour.by_sku.D = { ...colour.by_sku.D!, raw: null, value: null, codes: [], colour_name: null }
    const { check } = await built(broken, COLS, FRONT)
    expect(check.clean).toBe(false)
    const bad = check.rows.filter((r) => r.state !== 'match')
    expect(bad.map((r) => [r.column, r.component, r.field, r.where, r.state])).toEqual([['D', 'Insert', 'Colour', 'Experience 2 CC!D26', 'empty_in_sheet']])
    expect(supplierCheckText(broken, check)).toContain('SKU D (Ice blu marble) · Insert · Colour · cell Experience 2 CC!D26: workbook "", PDF "" (the cell is empty or a placeholder in the workbook')
  })

  test('a value that is not its cell refuses, naming SKU, component, field, cell and both values', async () => {
    // The PDF is built from one copy of the cells and checked against the upload's: one cell differs.
    const printed = clone(filled)
    const outer = printed.components.find((c) => c.header === 'Shell - Front')!.fields.find((f) => f.name === 'Outer Shell')!
    outer.by_sku.E = { ...outer.by_sku.E!, value: 'VDI 24 — Matte Pantone 544' }
    const renders = { D: { bytes: await png(1, 2, 3), mimeType: 'image/png' }, E: { bytes: await png(1, 2, 3), mimeType: 'image/png' } }
    const pdf = await buildSupplierPdf({ spec: printed, columns: COLS, key: { id: 'case-experience2--front', file: FRONT }, renders, clown: null, workbook: E2CC.workbook as WorkbookInfo })
    const check = await checkSupplierPdf({ bytes: pdf.bytes, spec: filled, columns: COLS, key: FRONT as ClownKey, workbook: E2CC.workbook as WorkbookInfo })
    const bad = check.rows.filter((r) => r.state !== 'match')
    expect(bad.map((r) => [r.column, r.component, r.field, r.where, r.sheet, r.pdf, r.state, r.cause])).toEqual([
      ['E', 'Shell - Front', 'Outer Shell', 'Experience 2 CC!E14', 'VDI 24 — Matte Pantone 544C', 'VDI 24 — Matte Pantone 544', 'mismatch', 'truncated_code'],
    ])
    expect(supplierCheckText(filled, check)).toContain(
      'SKU E (Ice blu classic matte) · Shell - Front · Outer Shell · cell Experience 2 CC!E14: workbook "VDI 24 — Matte Pantone 544C", PDF "VDI 24 — Matte Pantone 544" (mismatch, truncated_code)'
    )
  })

  test('a workbook with no modified time, or a value the font cannot print, makes no PDF', async () => {
    const noTime = { ...(E2CC.workbook as WorkbookInfo), modified: null, modified_source: 'none' }
    expect(await refusal(built(filled, COLS, FRONT, noTime))).toContain("the workbook's modified time is not known")
    const odd = clone(filled)
    const mat = odd.components[0].fields.find((f) => f.name === 'Material')!
    mat.by_sku.D = { ...(mat.common as any), value: 'ABS → PC' }
    expect(await refusal(built(odd, COLS, FRONT))).toContain(`Experience 2 CC!D${mat.row} holds '→' (U+2192), which the PDF's font cannot print`)
  })
})

// ------------------------------------------------------------------ the footer's time

test.describe("the footer's modified time: the file's own, else the stored upload's, never the import clock", () => {
  test('a file with its own save time (docProps/core.xml) gives that time', () => {
    const bytes = specToXlsx(E2CC, { modified: new Date('2026-09-20T14:02:11Z') })
    expect(coreModified(bytes)).toBe('2026-09-20T14:02:11Z')
    const info = workbookInfoForUpload({ bytes, fileName: 'TML2027 CMF.xlsx', storedLastModified: new Date('2026-09-29T08:00:00Z') })
    expect(info.modified).toBe('2026-09-20T14:02:11Z')
    expect(info.modified_source).toContain('docProps/core.xml')
  })

  test('with no save time and no stored Last-Modified, there is no time and no PDF', () => {
    const bytes = specToXlsx(E2CC)
    const info = workbookInfoForUpload({ bytes, fileName: 'x.xlsx', storedLastModified: null })
    expect(info.modified).toBeNull()
  })

  const REAL = findRealWorkbook()
  test('a Google Sheets download with no core.xml: Vesper records the same modified time as the committed spec', () => {
    test.skip(!REAL, 'the real workbook is not on this machine (it is never committed)')
    expect(coreModified(REAL!.bytes)).toBeNull()
    // The stored upload's Last-Modified, as storage reports it; workbook.py read the same instant from the upload's URL.
    const info = workbookInfoForUpload({ bytes: REAL!.bytes, fileName: REAL!.committed.file, storedLastModified: new Date('2026-09-22T09:20:42.000Z') })
    expect(info.modified).toBe(REAL!.committed.modified)
    expect(info.sha256).toBe(REAL!.committed.sha256)
    expect(info.modified_source).toContain("upload's Last-Modified")
  })
})

// ------------------------------------------------------------------ five SKUs from the real workbook

const REAL = findRealWorkbook()

/**
 * Five SKUs of mixed complexity, standing in until Damien names his five:
 *   Link C (Coachella desert sun)            compound colour cells: `Pantone 121C + Pantone 2026C`, and
 *                                            a two-sided cell `RIght: Pantone 121C / Left: Pantone 2026C`
 *   Experience 2 CC D (Ice blu marble)        a marble finish: `Silicon mix marble imitation Pantone 544C
 *                                            + 427C + 5405 + white`
 *   Experience 2 CC E (Ice blu classic matte) a carry case with Outer Shell and Inner Shell
 *   Switch 2 G (Switch 2 Navy)                a simple earplug
 *   Experience 2 C (Ice blu satin)            a simple earplug
 */
const FIVE: Array<{ tab: string; columns: string[]; key: string }> = [
  { tab: 'Link', columns: ['C'], key: 'link--test' },
  { tab: 'Experience 2 CC', columns: ['D', 'E'], key: 'case-experience2--front' },
  { tab: 'Switch 2', columns: ['G'], key: 'switch2--test' },
  { tab: 'Experience 2', columns: ['C'], key: 'experience2--test' },
]

function realSpecs() {
  const info = workbookInfoForUpload({ bytes: REAL!.bytes, fileName: REAL!.committed.file, storedLastModified: new Date('2026-09-22T09:20:42.000Z') })
  return { info, specs: parseWorkbookBytes(REAL!.bytes, info) }
}

function keyFor(spec: Spec, id: string): ClownKeyFile {
  return id === 'case-experience2--front' ? FRONT : testKeyFor(spec, id)
}

test.describe('five SKUs of mixed complexity from the real workbook (stand-ins until Damien names his five)', () => {
  test.skip(!REAL, 'the real workbook is not on this machine (it is never committed)')

  test('each PDF reads back 100% equal to the workbook, the five TEST-FILLED banner cells aside', async () => {
    const { info, specs } = realSpecs()
    let skus = 0
    for (const one of FIVE) {
      const spec = withTestFilledBanner(specs[one.tab], one.columns)
      const { pdf, check } = await built(spec, one.columns, keyFor(spec, one.key), info)
      expect(check.rows.filter((r) => r.state !== 'match'), `${one.tab} ${one.columns.join(',')}\n${supplierCheckText(spec, check)}`).toEqual([])
      expect(pdf.pages.filter((p) => p.kind === 'sku').map((p) => p.column)).toEqual(one.columns)
      skus += one.columns.length
    }
    expect(skus).toBe(5)
  })

  test('the real, unfilled workbook refuses all five, naming every placeholder cell', async () => {
    const { info, specs } = realSpecs()
    for (const one of FIVE) {
      const spec = specs[one.tab]
      const { check } = await built(spec, one.columns, keyFor(spec, one.key), info)
      const blocked = check.rows.filter((r) => r.state === 'empty_in_sheet').map((r) => `${r.where} (${r.field})`)
      expect(blocked.sort(), one.tab).toEqual(one.columns.flatMap((c) => pendingBannerCells(spec, c)).sort())
      expect(check.rows.filter((r) => r.state !== 'match' && r.state !== 'empty_in_sheet'), one.tab).toEqual([])
    }
  })

  test("the compound and two-sided cells print whole", async () => {
    const { info, specs } = realSpecs()
    const spec = withTestFilledBanner(specs['Link'], ['C'])
    const { check } = await built(spec, ['C'], keyFor(spec, 'link--test'), info)
    const cord = check.rows.find((r) => r.column === 'C' && r.component === 'Cord' && r.field === 'Colour')!
    expect(cord.pdf).toBe('Pantone 121C + Pantone 2026C')
    const stem = check.rows.find((r) => r.column === 'C' && r.component === 'Connector (Stem)' && r.field === 'Colour')!
    expect(stem.pdf).toBe('RIght: Pantone 121C Left: Pantone 2026C')
    expect(stem.state).toBe('match')
  })
})

// ------------------------------------------------------------------ spec_diff.py, on the same PDFs

function findSpecDiff(): { script: string; python: string } | null {
  const roots = [process.env.LOOP_PRODUCT_PLUGINS_DIR, path.join(__dirname, '..', '..', '..', '00_loop-product-plugins-pd'), path.join(__dirname, '..', '..', '..', 'loop-product-plugins')].filter(
    (p): p is string => !!p
  )
  for (const root of roots) {
    const script = path.join(root, 'workstreams', 'cmf', 'scripts', 'spec_diff.py')
    if (!fs.existsSync(script)) continue
    for (const python of ['python', 'python3']) {
      const probe = spawnSync(python, ['-c', 'import pypdf'], { encoding: 'utf8' })
      if (probe.status === 0) return { script, python }
    }
  }
  return null
}

const SPEC_DIFF = findSpecDiff()

test.describe("the product repository's spec_diff.py --layout ours on the same PDF", () => {
  test.skip(!SPEC_DIFF, 'the product repository or pypdf is not on this machine')

  test('agrees row for row on every header cell, component field, footer and the legend', async () => {
    const cases: Array<{ spec: Spec; columns: string[]; key: ClownKeyFile; info: WorkbookInfo }> = [
      { spec: withTestFilledBanner(E2CC, ['D', 'E']), columns: ['D', 'E'], key: FRONT, info: E2CC.workbook as WorkbookInfo },
      { spec: E2CC, columns: ['E'], key: FRONT, info: E2CC.workbook as WorkbookInfo },
    ]
    if (REAL) {
      const { info, specs } = realSpecs()
      for (const one of FIVE) cases.push({ spec: withTestFilledBanner(specs[one.tab], one.columns), columns: one.columns, key: keyFor(specs[one.tab], one.key), info })
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmf-spec-diff-'))
    try {
      for (let n = 0; n < cases.length; n++) {
        const c = cases[n]
        const { pdf, check } = await built(c.spec, c.columns, c.key, c.info)
        const files = { pdf: path.join(dir, `${n}.pdf`), spec: path.join(dir, `${n}.spec.json`), key: path.join(dir, `${n}.key.json`), report: path.join(dir, `${n}.report.json`) }
        fs.writeFileSync(files.pdf, pdf.bytes)
        fs.writeFileSync(files.spec, JSON.stringify({ ...c.spec, workbook: c.info }))
        fs.writeFileSync(files.key, JSON.stringify(c.key))
        const run = spawnSync(
          SPEC_DIFF!.python,
          [SPEC_DIFF!.script, '--spec', files.spec, '--pdf', files.pdf, '--layout', 'ours', '--key', files.key, ...c.columns.flatMap((col: string) => ['--sku', col]), '--report', files.report],
          { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
        )
        expect(fs.existsSync(files.report), run.stderr).toBe(true)
        const py = JSON.parse(fs.readFileSync(files.report, 'utf8')).rows as Array<Record<string, unknown>>
        const ts = runSpecCheck(c.spec, printedFromPages(check.pages, c.spec, 'ours').byColumn, null, c.columns, 'ours', c.key as ClownKey).rows
        const view = (rows: Array<Record<string, unknown>>) =>
          rows.filter((r) => r.component !== 'LEGEND').map((r) => [r.column, r.component, r.field, r.sheet, r.pdf, r.state, r.cause, r.where])
        expect(view(py), `case ${n}`).toEqual(view(ts as unknown as Array<Record<string, unknown>>))
        // Both end the ours legend at "Shared by every SKU" (spec_diff.py since the product repository's e1e5105;
        // before, it stopped at the first component header and read the legend as empty).
        const pyLegend = py.find((r) => r.component === 'LEGEND')!
        expect(pyLegend.state).toBe('match')
        expect(check.rows.find((r) => r.component === 'LEGEND')!.state).toBe('match')
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// A workbook SheetJS writes back is read the same as the spec it came from, so the upload path can be tested without the real file.
test('a spec written as a workbook reads back with the same cells', () => {
  const back = parseWorkbookBytes(specToXlsx(E2CC))['Experience 2 CC']
  for (const comp of E2CC.components) {
    const got = back.components.find((c) => c.header === comp.header)!
    for (const f of comp.fields) {
      const g = got.fields.find((x) => x.name === f.name)!
      for (const col of ['C', 'D', 'E', 'F']) expect(g.by_sku[col]?.value ?? null, `${comp.header} · ${f.name} ${col}`).toBe(f.by_sku[col]?.value ?? null)
    }
  }
  expect(Object.keys(XLSX.read(specToXlsx(E2CC)).Sheets)).toEqual(['Experience 2 CC'])
})
