/**
 * THE ROW and THE KEY built by code from a parsed sheet (`grading-row.ts`), held to the product
 * repository's `qa.row_lines` and `qa.key_lines` as the kit commits them: for the committed
 * Experience 2 CC spec, every in-scope column's row and every key block is the kit's, line for
 * line, and the grading prompt assembled from them is the kit's conformance fixture, by sha256.
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { ConformanceSchema, ProductKitSchema } from '../src/lib/creative/kit-schema'
import { cmfKit, type CmfGradingParts } from '../src/lib/creative/cmf/kit-cmf'
import { assembleCmfGradingPrompt } from '../src/lib/creative/cmf/grading'
import { gradingPartsFor, gradingRow, keyLines, rowLines } from '../src/lib/creative/cmf/grading-row'
import type { ClownKeyFile } from '../src/lib/creative/cmf/prompt-fill'
import { clone } from './helpers/cmf-supplier'
import { E2CC, FRONT, KEY_ID } from './helpers/cmf-upload'

const FIX = path.join(__dirname, 'fixtures', 'creative')
const parts: CmfGradingParts = JSON.parse(fs.readFileSync(path.join(FIX, 'product-cmf-grading.v1.sample.json'), 'utf8'))
const kit = ProductKitSchema.parse(JSON.parse(fs.readFileSync(path.join(FIX, 'product-kit.v1.sample.json'), 'utf8')))
const conformance = ConformanceSchema.parse(JSON.parse(fs.readFileSync(path.join(FIX, 'product-conformance.v1.sample.json'), 'utf8'))) as any
const cmf = cmfKit(kit)
const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

/** The back key as the kit's parts describe it: a draft of two unnamed zones. */
const BACK: ClownKeyFile = {
  product: 'case-experience2',
  clown: { id: 'case-experience2--back', sha256: cmf.keys['case-experience2--back'].clown!.sha256, width: 1280, height: 1280 },
  confirmed_by: null,
  confirmed_at: null,
  zones: [
    { hex: '#CD0B0B', components: [] },
    { hex: '#24BC08', components: [] },
  ],
  not_on_clown: [],
}

test.describe("THE ROW and THE KEY, as the product repository's qa.py builds them", () => {
  test('every in-scope column of the committed spec gives the kit row, line for line', () => {
    for (const col of ['C', 'D', 'E', 'F']) {
      expect(rowLines(gradingRow(E2CC, col, {})), col).toEqual(parts.rows[`experience-2-cc--${col}`].row_lines)
    }
  })

  test('a named key and a draft key give the kit blocks, line for line', () => {
    for (const col of ['C', 'D', 'E', 'F']) {
      const row = gradingRow(E2CC, col, {})
      expect(keyLines(FRONT, KEY_ID, row), col).toEqual(parts.keys[`experience-2-cc--${col}--${KEY_ID}`].key_lines)
      expect(keyLines(BACK, 'case-experience2--back', row), col).toEqual(parts.keys[`experience-2-cc--${col}--case-experience2--back`].key_lines)
    }
    expect(keyLines(null, null, null)).toEqual(parts.no_key_lines)
  })

  test("the grading prompt from an upload's parts is the kit's conformance fixture, by sha256", () => {
    const fixtures = conformance.products.cmf.grading_prompt.fixtures as Array<{ inputs: { spec: string; column: string; key: string | null }; sha256: string }>
    const cases: Array<[string, ClownKeyFile]> = [
      ['E', FRONT],
      ['D', BACK],
    ]
    for (const [col, key] of cases) {
      const keyId = key.clown!.id!
      const f = fixtures.find((x) => x.inputs.spec === 'experience-2-cc' && x.inputs.column === col && x.inputs.key === keyId)!
      expect(f, `${col} ${keyId}`).toBeTruthy()
      const built = gradingPartsFor({ spec: E2CC, specSlug: 'experience-2-cc', column: col, keyId, key, pantone: {}, noKeyLines: parts.no_key_lines })
      expect(sha(assembleCmfGradingPrompt(cmf.product, built, f.inputs))).toBe(f.sha256)
    }
  })

  test('a hex is named only where a person confirmed it, or the sheet wrote one', () => {
    const lookup = { 'pantone 544 c': { hex: '8fb8c9', confirmed_by: 'Damien' }, 'pantone 2160 c': { hex: '6a8fa6' } }
    const lines = rowLines(gradingRow(E2CC, 'E', lookup))
    expect(lines[1]).toContain('Codes: Pantone 544C (confirmed hex #8FB8C9).')
    expect(lines[4]).toContain('Codes: Pantone 2160C (no confirmed hex).')
  })

  test('a required cell left empty is shown as empty, never filled from Common specs', () => {
    const spec = clone(E2CC)
    const material = spec.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Material')!
    material.common = { raw: 'Silicone', value: 'Silicone', placeholder: null, required: false, codes: [] }
    material.by_sku.E = { raw: null, value: null, placeholder: null, required: true, codes: [] }
    const line = rowLines(gradingRow(spec, 'E', {})).find((l) => l.startsWith('- Insert:'))!
    expect(line).toContain('Material: (empty in the sheet, required)')
  })
})
