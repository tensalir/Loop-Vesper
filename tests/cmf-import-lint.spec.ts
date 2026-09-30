/**
 * The web CMF Studio stays on the CMF engine: no file of its door imports the web's retired CMF
 * modules or the model adapter.
 *
 * Why it is here (2026-09-30): the web CMF Studio built its own prompt (`src/lib/cmf/prompt.ts`),
 * drew through Vesper's model adapter with a Replicate fallback (`src/lib/cmf/render.ts`,
 * `src/lib/models/*`), parsed the workbook with its own importer (`src/lib/cmf/xlsx.ts`) and built
 * an unchecked PDF (`src/lib/cmf/pdf.ts`), so it drifted from what Claude does. It now calls the
 * CMF service (`src/lib/creative/cmf/service.ts`); this test fails the moment one of its files
 * reaches back for the old path, by any import form (static, re-export, dynamic, require).
 */

import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'src')

/** The web CMF door: its routes, its components, its hook, and the door modules they call. */
const WEB_CMF = ['src/app/api/cmf/v2', 'src/components/cmf', 'src/hooks/useCmf.ts', 'src/lib/creative/cmf/web-door.ts', 'src/lib/creative/cmf/web-jobs.ts', 'src/lib/creative/cmf/args.ts']

/** Modules the web door must not import: the retired CMF path and the model adapter. */
const FORBIDDEN: Array<{ module: RegExp; why: string }> = [
  { module: /^lib\/cmf\/prompt$/, why: "the web's own CMF prompt, retired" },
  { module: /^lib\/cmf\/render$/, why: "the web's own CMF render (clown rotation, Replicate fallback), retired" },
  { module: /^lib\/cmf\/pdf$/, why: "the web's unchecked packet PDF, retired" },
  { module: /^lib\/cmf\/xlsx$/, why: "the web's own workbook importer; uploads are read by the CMF engine's parse" },
  { module: /^lib\/models(\/|$)/, why: 'the model adapter; a CMF draw goes through the CMF service' },
]

function filesUnder(rel: string): string[] {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) return []
  if (fs.statSync(abs).isFile()) return [abs]
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => filesUnder(path.join(rel, e.name)))
}

/** Every module a source file imports, however: `import ... from`, `export ... from`, `import()`, `require()`. Type-only imports load nothing and are left out. */
function importsOf(source: string): string[] {
  const out: string[] = []
  const patterns = [
    /(?:^|[\s;])import\s+(?!type\s)(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|[\s;])export\s+(?!type\s)[^'"`;]*?\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) for (const m of source.matchAll(re)) out.push(m[1])
  return out
}

/** A specifier as a path under src/, without its extension: `@/lib/cmf/prompt` and `../../lib/cmf/prompt` are both `lib/cmf/prompt`. */
function underSrc(specifier: string, fromFile: string): string | null {
  let abs: string
  if (specifier.startsWith('@/')) abs = path.join(SRC, specifier.slice(2))
  else if (specifier.startsWith('.')) abs = path.resolve(path.dirname(fromFile), specifier)
  else return null
  const rel = path.relative(SRC, abs).split(path.sep).join('/')
  if (rel.startsWith('..')) return null
  return rel.replace(/\.(tsx?|jsx?)$/, '').replace(/\/index$/, '')
}

function violations(file: string, source: string): string[] {
  const found: string[] = []
  for (const spec of importsOf(source)) {
    const mod = underSrc(spec, file)
    if (!mod) continue
    const hit = FORBIDDEN.find((f) => f.module.test(mod))
    if (hit) found.push(`${path.relative(ROOT, file).split(path.sep).join('/')} imports ${spec}: ${hit.why}`)
  }
  return found
}

test.describe('the web CMF Studio imports none of the retired CMF path', () => {
  test('no file of the web door imports lib/cmf/{prompt,render,pdf,xlsx} or the model adapter', () => {
    const files = WEB_CMF.flatMap(filesUnder).filter((f) => /\.(tsx?|jsx?)$/.test(f))
    // The door is there to be checked: its routes, components, hook and modules.
    expect(files.some((f) => f.includes(path.join('api', 'cmf', 'v2')))).toBe(true)
    expect(files.some((f) => f.includes(path.join('components', 'cmf', 'studio')))).toBe(true)
    expect(files.some((f) => f.endsWith('useCmf.ts'))).toBe(true)
    const found = files.flatMap((f) => violations(f, fs.readFileSync(f, 'utf8')))
    expect(found).toEqual([])
  })

  test('no live route or component imports the retired prompt, render or PDF modules at all', () => {
    // Only the retired modules themselves (render imports prompt) and their tests may.
    const files = filesUnder('src').filter((f) => /\.(tsx?|jsx?)$/.test(f) && !path.relative(SRC, f).split(path.sep).join('/').match(/^lib\/cmf\/(prompt|render|pdf)\.ts$/))
    const found: string[] = []
    for (const f of files) {
      for (const spec of importsOf(fs.readFileSync(f, 'utf8'))) {
        const mod = underSrc(spec, f)
        if (mod && /^lib\/cmf\/(prompt|render|pdf)$/.test(mod)) found.push(`${path.relative(ROOT, f)} imports ${spec}`)
      }
    }
    expect(found).toEqual([])
  })

  test('the check itself catches each import form, and lets type-only imports and the CMF engine through', () => {
    const file = path.join(SRC, 'components', 'cmf', 'studio', 'Example.tsx')
    const caught = (src: string) => violations(file, src).length
    expect(caught(`import { buildCmfPrompt } from '@/lib/cmf/prompt'`)).toBe(1)
    expect(caught(`import {\n  runCmfRender,\n} from '../../../lib/cmf/render'`)).toBe(1)
    expect(caught(`export { buildCmfPacketPdf } from '@/lib/cmf/pdf'`)).toBe(1)
    expect(caught(`const x = await import('@/lib/cmf/xlsx')`)).toBe(1)
    expect(caught(`const r = require('@/lib/models/registry')`)).toBe(1)
    expect(caught(`import { getModel } from '@/lib/models/adapters/gemini'`)).toBe(1)
    expect(caught(`import type { CmfSkuRow } from '@/lib/cmf/xlsx'`)).toBe(0)
    expect(caught(`import { listCmf } from '@/lib/creative/cmf/service'`)).toBe(0)
    expect(caught(`import { toViewUrl } from '@/lib/storage/refs'`)).toBe(0)
  })
})
