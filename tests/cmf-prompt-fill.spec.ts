/**
 * Damien's template filled in Vesper (src/lib/creative/cmf/prompt-fill.ts), held to the product
 * repository's prompt_build.py.
 *
 *   - every payload the repository commits (`workstreams/cmf/references/payloads/INDEX.json`),
 *     copied into `tests/fixtures/cmf/prompt-parity.json` with the spec, key and template it was
 *     built from: the same prompt text and the same sha256, line records, omissions and warnings
 *   - where the repository is checked out beside Vesper, every INDEX entry read live, ready or
 *     refused
 *   - where the real workbook is on the machine, the same prompts from Vesper's own parse of it
 *   - the refusals Damien's brief asks for: a draft key, a component with no zone, a zone with no
 *     value, a code missing
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fillPrompt, isDraftKey, PromptRefusal, readTemplateBlock, type ClownKeyFile } from '../src/lib/creative/cmf/prompt-fill'
import { parseWorkbookBytes } from '../src/lib/creative/cmf/workbook'
import type { Spec } from '../src/lib/creative/cmf/spec-diff'

const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cmf', 'prompt-parity.json'), 'utf8'))
const KIT = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creative', 'product-kit.v1.sample.json'), 'utf8'))
const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const template = readTemplateBlock(FIX.template_block)

type Payload = {
  payload_file: string
  spec_file: string
  key: string
  column: string
  prompt: string
  prompt_sha256: string
  template_sha256: string
  key_confirmed: boolean
  clown: { aspect: string | null }
  lines: unknown[]
  omitted: unknown[]
  warnings: string[]
  sku_id: string
}

function refusalOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(PromptRefusal)
    return (err as PromptRefusal).reasons
  }
  throw new Error('expected a refusal')
}

test.describe("the template, filled as prompt_build.py fills it", () => {
  test("the template is the repository's block, and the kit's", () => {
    expect(template.sha256).toBe(FIX.index_template_sha256)
    const cmf = Object.values(KIT.products as Record<string, any>).find((p) => p.kind === 'cmf')
    expect(cmf.template.block_sha256).toBe(template.sha256)
    expect(template.head).toHaveLength(2)
    expect(template.tail).toHaveLength(1)
  })

  test('every payload the repository commits: the same prompt, byte for byte, and the same sha256', () => {
    const payloads = FIX.payloads as Payload[]
    expect(payloads.length).toBeGreaterThanOrEqual(4)
    for (const p of payloads) {
      const spec = FIX.specs[p.spec_file] as Spec
      const key = FIX.keys[p.key] as ClownKeyFile
      const got = fillPrompt(spec, p.column, key, template, `${p.key}.json`)
      expect(got.prompt, p.payload_file).toBe(p.prompt)
      expect(got.prompt_sha256, p.payload_file).toBe(p.prompt_sha256)
      expect(sha(got.prompt), p.payload_file).toBe(p.prompt_sha256)
      expect(got.template_sha256, p.payload_file).toBe(p.template_sha256)
      expect(got.lines, p.payload_file).toEqual(p.lines)
      expect(got.omitted, p.payload_file).toEqual(p.omitted)
      expect(got.warnings, p.payload_file).toEqual(p.warnings)
      expect(got.key_confirmed, p.payload_file).toBe(p.key_confirmed)
      expect(got.clown.aspect, p.payload_file).toBe(p.clown.aspect)
      expect(got.sku_id, p.payload_file).toBe(p.sku_id)
    }
  })

  test('a draft key refuses, naming each unnamed zone', () => {
    const p = FIX.payloads[0] as Payload
    const key = clone(FIX.keys[p.key]) as ClownKeyFile
    key.zones![1].components = []
    expect(isDraftKey(key)).toBe(true)
    const reasons = refusalOf(() => fillPrompt(FIX.specs[p.spec_file], p.column, key, template, `${p.key}.json`))
    expect(reasons).toContain(`${p.key}.json: zone #C6B807 names no component (the key is a draft; the lead CMF designer names it)`)
    expect(reasons).toContain(`Experience 2 CC component 'Insert' has no zone in ${p.key}.json and is not listed in its not_on_clown`)
  })

  test('a component with no zone refuses, by its name as the sheet writes it', () => {
    const p = FIX.payloads[0] as Payload
    const key = clone(FIX.keys[p.key]) as ClownKeyFile
    key.not_on_clown = ['ARTWORK']
    const reasons = refusalOf(() => fillPrompt(FIX.specs[p.spec_file], p.column, key, template, `${p.key}.json`))
    expect(reasons).toEqual([`Experience 2 CC component 'Cord' has no zone in ${p.key}.json and is not listed in its not_on_clown`])
  })

  test('a zone with no value refuses, naming the cell', () => {
    const p = (FIX.payloads as Payload[]).find((x) => x.column === 'E')!
    const spec = clone(FIX.specs[p.spec_file]) as Spec
    const insert = spec.components.find((c) => c.header === 'Insert')!
    const colour = insert.fields.find((f) => f.name === 'Colour')!
    // The yellow Colour cell of column E, emptied.
    colour.by_sku.E = { ...colour.by_sku.E!, raw: null, value: null, placeholder: null, codes: [], colour_name: null }
    const reasons = refusalOf(() => fillPrompt(spec, 'E', FIX.keys[p.key], template, `${p.key}.json`))
    expect(reasons).toEqual([
      `Experience 2 CC!E${colour.row} Insert · Colour: empty`,
      `Experience 2 CC!E${insert.row} Insert · Colour: no code and no ' / ' or 'N/A' (empty); a zone line needs the code as the sheet writes it`,
    ])
  })

  test('a colour in words with no code refuses, quoting the cell', () => {
    const p = (FIX.payloads as Payload[]).find((x) => x.column === 'E')!
    const spec = clone(FIX.specs[p.spec_file]) as Spec
    const insert = spec.components.find((c) => c.header === 'Insert')!
    const colour = insert.fields.find((f) => f.name === 'Colour')!
    colour.by_sku.E = { ...colour.by_sku.E!, raw: 'Ice blue', value: 'Ice blue', codes: [], colour_name: 'Ice blue' }
    const reasons = refusalOf(() => fillPrompt(spec, 'E', FIX.keys[p.key], template, `${p.key}.json`))
    // Word for word what prompt_build.py answers for the same cell.
    expect(reasons).toEqual([`Experience 2 CC!E${colour.row} Insert · Colour: no code and no ' / ' or 'N/A' (a colour in words only: 'Ice blue'); a zone line needs the code as the sheet writes it`])
  })
})

// ------------------------------------------------------------------ the repository itself, where it is checked out

function findProductRepo(): string | null {
  const roots = [
    process.env.LOOP_PRODUCT_PLUGINS_DIR,
    path.join(__dirname, '..', '..', '..', '00_loop-product-plugins-pd'),
    path.join(__dirname, '..', '..', '..', 'loop-product-plugins'),
  ].filter((p): p is string => !!p)
  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'workstreams', 'cmf', 'references', 'payloads', 'INDEX.json'))) return root
  }
  return null
}

const REPO = findProductRepo()

test.describe('the product repository, read live', () => {
  test.skip(!REPO, 'tensalir/loop-product-plugins is not checked out beside Vesper')

  test('every INDEX entry: a ready one gives its prompt and sha256, a refused one its reasons', () => {
    const ws = path.join(REPO!, 'workstreams', 'cmf')
    const skill = path.join(REPO!, 'plugins', 'product-design', 'skills', 'cmf-review')
    const md = fs.readFileSync(path.join(skill, 'references', 'prompt-template.md'), 'utf8').replace(/\r\n/g, '\n')
    const live = readTemplateBlock(/^```[^\n]*\n([\s\S]*?)\n```/m.exec(md)![1])
    const index = JSON.parse(fs.readFileSync(path.join(ws, 'references', 'payloads', 'INDEX.json'), 'utf8'))
    expect(live.sha256).toBe(index.template_sha256)
    let compared = 0
    for (const e of index.entries) {
      const spec = JSON.parse(fs.readFileSync(path.join(ws, 'references', 'workbook', 'spec', `${e.slug}.json`), 'utf8')) as Spec
      const key = JSON.parse(fs.readFileSync(path.join(skill, 'references', 'clown-keys', `${e.key}.json`), 'utf8')) as ClownKeyFile
      if (e.status === 'ready') {
        const want = JSON.parse(fs.readFileSync(path.join(ws, e.payload), 'utf8'))
        const got = fillPrompt(spec, e.column, key, live, `${e.key}.json`)
        expect(got.prompt, e.payload).toBe(want.prompt)
        expect(got.prompt_sha256, e.payload).toBe(want.prompt_sha256)
        expect(got.lines, e.payload).toEqual(want.lines)
      } else {
        expect(refusalOf(() => fillPrompt(spec, e.column, key, live, `${e.key}.json`)), `${e.slug} ${e.column} ${e.key}`).toEqual(e.reasons)
      }
      compared++
    }
    expect(compared).toBe(index.entries.length)
  })
})

// ------------------------------------------------------------------ the real workbook, where it is

function findWorkbook(): string | null {
  const roots = [process.env.LOOP_ASSET_REVIEWER_DIR, path.join(__dirname, '..', '..', '..', 'loop-asset-reviewer-cmf')].filter((p): p is string => !!p)
  for (const root of roots) {
    const dir = path.join(root, 'workstreams', 'cmf', 'references', 'workbook')
    const spec = FIX.specs['references/workbook/spec/experience-2-cc.json'] as Spec
    const file = path.join(dir, String(spec.workbook?.file))
    if (fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === spec.workbook?.sha256) return file
  }
  return null
}

const WORKBOOK = findWorkbook()

test.describe("Vesper's own parse of the real workbook", () => {
  test.skip(!WORKBOOK, 'the workbook the committed payloads were built from is not on this machine (it is never committed)')

  test('fills the same prompts the repository committed', () => {
    const specs = parseWorkbookBytes(fs.readFileSync(WORKBOOK!))
    for (const p of FIX.payloads as Payload[]) {
      const got = fillPrompt(specs['Experience 2 CC'], p.column, FIX.keys[p.key], template, `${p.key}.json`)
      expect(got.prompt_sha256, p.payload_file).toBe(p.prompt_sha256)
    }
  })
})
