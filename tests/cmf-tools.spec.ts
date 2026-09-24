/**
 * CMF files through Claude: the render, the grade and the PDF check, each held to the plugin
 * repository's scripts and each refusing before anything is paid for.
 *
 *   - the CMF grading prompt: every CMF fixture in the kit's conformance file, by sha256, and its
 *     example byte for byte (`tools/kit.py`, `assemble_cmf_grading_prompt`)
 *   - cmf_render: every refusal `render.py` makes, one model call per image, the clown the only
 *     image and the payload's prompt sent as it is
 *   - the tools themselves, through their injected reach: CMF access, the payload verbatim, the
 *     refusals word for word
 *   - the creative worker: a stub server that checks the signature the way the worker does
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import type { AddressInfo } from 'net'
import path from 'path'
import { ConformanceSchema, KitSchema, type Conformance, type Kit } from '../src/lib/creative/kit-schema'
import type { LoadedKit } from '../src/lib/creative/kit'
import { kitPins, type PinRow } from '../src/lib/creative/pins'
import type { GradeDeps } from '../src/lib/creative/grade'
import type { GeminiPart } from '../src/lib/creative/gemini'
import { CmfError, cmfKit, payloadFor, resolveTab, type CmfGradingParts, type CmfKit } from '../src/lib/creative/cmf/kit-cmf'
import { assembleCmfGradingPrompt, checkCmfTarget, gradeCmfCandidate } from '../src/lib/creative/cmf/grading'
import { checkClownBytes, cmfDrawRequest, cmfManifestLine, executeCmfDraws, planCmfRender, CMF_MAX_DRAWS } from '../src/lib/creative/cmf/render'
import { checkPdfInVesper, checkPdfOnWorker, resolveSku } from '../src/lib/creative/cmf/check-pdf'
import { signWorkerRequest, workerConfigFromEnv, WorkerError, type WorkerConfig } from '../src/lib/creative/cmf/worker-client'
import type { Spec } from '../src/lib/creative/cmf/spec-diff'
import { CmfAccessError, cmfCheckPdfHandler, cmfListHandler, cmfPromptHandler, cmfRenderHandler, setCmfToolDeps, type CmfToolDeps } from '../src/lib/headless/tools/cmf'
import { McpProgressReporter } from '../src/lib/headless/mcp-progress'
import type { ToolContext } from '../src/lib/headless/tools/types'
import { MemoryJobStore } from './helpers/memory-job-store'

const FIX = path.join(__dirname, 'fixtures')
const read = (...p: string[]) => fs.readFileSync(path.join(FIX, ...p))
const kit: Kit = KitSchema.parse(JSON.parse(read('creative', 'kit.v1.sample.json').toString('utf8')))
const conformance: Conformance = ConformanceSchema.parse(JSON.parse(read('creative', 'conformance.v1.sample.json').toString('utf8')))
const conf = conformance as any
const parts: CmfGradingParts = JSON.parse(read('creative', 'cmf-grading.v1.sample.json').toString('utf8'))
const PAYLOAD_E = 'experience-2-cc--E--case-experience2--front'
const payloadBytes = read('cmf', `${PAYLOAD_E}.payload.json`)
const payloadE = JSON.parse(payloadBytes.toString('utf8'))
const PARITY = JSON.parse(read('cmf', 'spec-diff-parity.json').toString('utf8'))
const REAL = PARITY.cases[0] as {
  name: string
  spec: Spec
  columns: string[]
  layout: 'vesper'
  rows: unknown[]
  counts: Record<string, number>
  cells_compared: number
  assertions: Record<string, boolean>
}
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const cmf: CmfKit = cmfKit(kit)

function withKit(edit: (k: any) => void): { kit: Kit; cmf: CmfKit } {
  const k = clone(kit) as any
  edit(k)
  return { kit: k as Kit, cmf: cmfKit(k as Kit) }
}

function payloadWith(edit: (p: any) => void): Buffer {
  const p = clone(payloadE)
  edit(p)
  return Buffer.from(JSON.stringify(p), 'utf8')
}

function refusal(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(CmfError)
    return (err as Error).message
  }
  throw new Error('expected a refusal')
}

async function refusalOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a refusal')
}

// ------------------------------------------------------------------ the grading prompt

test.describe('the CMF grading prompt, as kit.py assembles it', () => {
  test('every CMF fixture in the conformance file, by sha256; the example byte for byte', () => {
    const fixtures = conf.products.cmf.grading_prompt.fixtures as Array<{ inputs: { spec: string; column: string; key: string | null }; sha256: string; length: number }>
    expect(fixtures.length).toBeGreaterThanOrEqual(5)
    for (const f of fixtures) {
      const prompt = assembleCmfGradingPrompt(cmf.product, parts, f.inputs)
      expect(prompt.length, JSON.stringify(f.inputs)).toBe(f.length)
      expect(sha(prompt), JSON.stringify(f.inputs)).toBe(f.sha256)
    }
    const ex = conf.products.cmf.grading_prompt.example
    expect(assembleCmfGradingPrompt(cmf.product, parts, ex.inputs)).toBe(ex.prompt)
  })

  test('says Vesper measured nothing on the pixels', () => {
    const prompt = assembleCmfGradingPrompt(cmf.product, parts, { spec: 'experience-2-cc', column: 'E', key: 'case-experience2--front' })
    expect(prompt).toContain('no code measured this picture')
  })
})

// ------------------------------------------------------------------ the target

test.describe('a tab, column and key, checked against the kit', () => {
  test('a tab with no SKU in scope is refused: there is no row to grade against', () => {
    expect(refusal(() => checkCmfTarget(cmf, parts, 'dream', 'C', 'dream--default'))).toContain('has no SKU in scope')
  })

  test('a column out of scope is refused, naming the columns in scope', () => {
    const msg = refusal(() => checkCmfTarget(cmf, parts, 'experience-2-cc', 'G', 'case-experience2--front'))
    expect(msg).toContain('column G is not in scope; in scope: C, D, E, F')
  })

  test('a key of another product, or no such key, is refused', () => {
    expect(refusal(() => checkCmfTarget(cmf, parts, 'experience-2-cc', 'E', 'link--v609'))).toContain('is for link; Experience 2 CC is case-experience2')
    expect(refusal(() => checkCmfTarget(cmf, parts, 'experience-2-cc', 'E', 'case-experience2--side'))).toContain("no clown key 'case-experience2--side'")
  })

  test("a tab by its sheet name or its slug; an unknown tab names the kit's tabs", () => {
    expect(resolveTab(cmf, 'Experience 2 CC').slug).toBe('experience-2-cc')
    expect(resolveTab(cmf, 'experience-2-cc').spec.tab).toBe('Experience 2 CC')
    expect(refusal(() => resolveTab(cmf, 'Experience 3'))).toContain("no CMF tab 'Experience 3'")
  })

  test('a draft key has no payload; a column the kit has no payload for says so', () => {
    expect(refusal(() => payloadFor(cmf, 'experience-2-cc', 'E', 'case-experience2--back'))).toContain('is a draft')
    expect(refusal(() => payloadFor(cmf, 'experience-2-cc', 'G', 'case-experience2--front'))).toContain('not in scope')
    expect(payloadFor(cmf, 'experience-2-cc', 'E', 'case-experience2--front').status).toBe('ready')
  })
})

// ------------------------------------------------------------------ cmf_render, before paying

test.describe('cmf_render refuses what render.py refuses, before anything is paid for', () => {
  const entryE = cmf.payloads[PAYLOAD_E]

  test("the committed payload plans: the clown's aspect, 2K, the lane's model, the prompt as it is", () => {
    const plan = planCmfRender(cmf, entryE, payloadBytes, {})
    expect(plan.payloadId).toBe(PAYLOAD_E)
    expect(plan.prompt).toBe(payloadE.prompt)
    expect(plan.promptSha256).toBe(entryE.prompt_sha256)
    expect(plan.aspect).toBe('1:1')
    expect(plan.imageSize).toBe('2K')
    expect(plan.model).toBe('gemini-3-pro-image')
    expect(plan.n).toBe(1)
    expect(plan.keyConfirmed).toBe(false)
    expect(plan.skuName).toBe('Ice blu classic matte')
    expect(planCmfRender(cmf, entryE, payloadBytes, { lane: 'draft', n: 9, image_size: '4K' })).toMatchObject({
      model: 'gemini-3.1-flash-image',
      n: CMF_MAX_DRAWS,
      imageSize: '4K',
    })
  })

  const refusals: Array<[string, () => unknown, string]> = [
    [
      'a payload prompt_build.py refused',
      () => planCmfRender(cmf, { ...entryE, status: 'refused', reasons: ['Product Name is empty'] }, payloadBytes, {}),
      'Product Name is empty',
    ],
    [
      'a draft key',
      () => {
        const x = withKit((k) => (k.products.cmf.keys['case-experience2--front'].draft = true))
        return planCmfRender(x.cmf, entryE, payloadBytes, {})
      },
      "the key 'case-experience2--front' is a draft",
    ],
    ['more than one image', () => planCmfRender(cmf, entryE, payloadWith((p) => (p.image.count = 2)), {}), 'names 2 images'],
    ['another template', () => planCmfRender(cmf, entryE, payloadWith((p) => (p.template_sha256 = '0'.repeat(64))), {}), 'rebuild the payloads'],
    [
      'a rewritten prompt',
      () => planCmfRender(cmf, entryE, payloadWith((p) => (p.prompt = `${p.prompt} Soft studio lighting.`)), {}),
      'the prompt is not the one the payload hashed',
    ],
    [
      "a prompt that is not the kit's",
      () =>
        planCmfRender(
          cmf,
          entryE,
          payloadWith((p) => {
            p.prompt = `${p.prompt}!`
            p.prompt_sha256 = sha(p.prompt)
          }),
          {}
        ),
      'the prompt is not the one the kit names for this payload',
    ],
    [
      'a clown that changed since its key was sampled',
      () => {
        const x = withKit((k) => (k.products.cmf.keys['case-experience2--front'].clown.sha256 = 'f'.repeat(64)))
        return planCmfRender(x.cmf, entryE, payloadBytes, {})
      },
      'the clown changed; its key must be sampled again',
    ],
  ]
  for (const [name, fn, reason] of refusals) {
    test(`refuses ${name}`, () => {
      const msg = refusal(fn)
      expect(msg).toContain(reason)
      if (name !== 'a payload prompt_build.py refused') expect(msg.startsWith('not sent (nothing was paid for)')).toBe(true)
    })
  }

  test("the clown's bytes are checked against the payload just before the call", () => {
    const plan = planCmfRender(cmf, entryE, payloadBytes, {})
    expect(refusal(() => checkClownBytes(plan, Buffer.from('another picture')))).toContain('the clown changed; its key must be sampled again. Nothing was paid for.')
    const bytes = Buffer.from('the clown')
    expect(() => checkClownBytes({ clown: { ...plan.clown, sha256: sha(bytes) } }, bytes)).not.toThrow()
  })
})

// ------------------------------------------------------------------ one image, the prompt unchanged

test.describe('a CMF draw', () => {
  const plan = planCmfRender(cmf, cmf.payloads[PAYLOAD_E], payloadBytes, { n: 3 })

  test('sends the clown as the only image and the prompt byte for byte', () => {
    const clownPart = { file_data: { mime_type: 'image/png', file_uri: 'files/clown' } }
    const req = cmfDrawRequest(plan, clownPart)
    expect(req.references).toEqual([clownPart])
    expect(req.prompt).toBe(payloadE.prompt)
    expect(sha(req.prompt)).toBe(payloadE.prompt_sha256)
    expect(req).toEqual({ model: 'gemini-3-pro-image', prompt: payloadE.prompt, references: [clownPart], aspect: '1:1', size: '2K' })
  })

  test('one model call per image; a failed image is reported, not hidden', async () => {
    const calls: number[] = []
    const out = await executeCmfDraws(plan, async (index) => {
      calls.push(index)
      if (index === 2) throw new Error('the model returned no image')
      return { bytes: Buffer.from(`img${index}`), mimeType: 'image/png', model: plan.model, settings: {} }
    })
    expect(calls.sort()).toEqual([1, 2, 3])
    expect(out.images.map((i) => i.index)).toEqual([1, 3])
    expect(out.failures).toEqual(['render 2: the model returned no image'])
    const err = await refusalOf(executeCmfDraws(plan, async () => Promise.reject(new Error('quota'))))
    expect(err.message).toContain('no render came back')
  })

  test("the manifest line is render.py's, with source vesper and the prompt as sent", () => {
    const line = cmfManifestLine(plan, { index: 1, file: 'https://x/0.png', model: plan.model, settings: { aspectRatio: '1:1' }, timestamp: '2026-09-24T10:00:00Z' })
    expect(line).toMatchObject({
      source: 'vesper',
      tab: 'Experience 2 CC',
      column: 'E',
      key: 'case-experience2--front',
      key_confirmed: false,
      lane: 'final',
      draw: 1,
      prompt: payloadE.prompt,
      prompt_sha256: payloadE.prompt_sha256,
    })
    expect(line.clown).toEqual({ id: 'case-experience2--front', sha256: payloadE.clown.sha256 })
  })
})

// ------------------------------------------------------------------ the CMF grade

function cmfRows(opts: { status?: PinRow['status'] } = {}): PinRow[] {
  return kitPins(kit)
    .filter((s) => s.product === 'cmf')
    .map((spec) => ({
      product: spec.product,
      pinId: spec.pinId,
      source: spec.source,
      title: spec.title,
      sha256: spec.sha256,
      bytes: spec.bytes,
      width: spec.width,
      height: spec.height,
      mime: 'image/png',
      storagePath: `pins/${spec.sha256}.png`,
      previewPath: null,
      derivedPath: null,
      derivedSha256: null,
      derivedRecipe: null,
      geminiFileUri: `files/${spec.sha256.slice(0, 10)}`,
      geminiFileExpiresAt: new Date(Date.now() + 24 * 3600_000),
      status: opts.status ?? 'ok',
      error: null,
      syncedAt: new Date(),
    }))
}

function gradeDeps(rows: PinRow[]): GradeDeps & { calls: GeminiPart[][] } {
  const calls: GeminiPart[][] = []
  const checks = cmf.product.rubric.checks
  return {
    calls,
    pinRows: rows,
    candidatePart: async (c) => ({ inline_data: { mime_type: c.mimeType, data: c.bytes.toString('base64') } }),
    pinPart: async (row) => ({ file_data: { mime_type: 'image/png', file_uri: row.geminiFileUri! } }),
    read: async (p) => {
      calls.push(p)
      return { json: { checks: Object.fromEntries(checks.map((c) => [c.id, true])) }, model: 'gemini-flash-latest' }
    },
  }
}

const candidate = { bytes: Buffer.from('a render'), mimeType: 'image/png', sha256: sha('a render') }

test.describe('grading a CMF render', () => {
  test('the render first, the clown second, the prompt last; three reads; reporting only', async () => {
    const deps = gradeDeps(cmfRows())
    const out = await gradeCmfCandidate({ kit, cmf, parts, candidate, spec: 'experience-2-cc', column: 'E', key: 'case-experience2--front' }, deps)
    expect(deps.calls).toHaveLength(3)
    const sent = deps.calls[0]
    expect(sent).toHaveLength(3)
    expect(sent[0]).toEqual({ inline_data: { mime_type: 'image/png', data: candidate.bytes.toString('base64') } })
    const clownSha = cmf.keys['case-experience2--front'].clown!.sha256
    expect(sent[1]).toEqual({ file_data: { mime_type: 'image/png', file_uri: `files/${clownSha.slice(0, 10)}` } })
    expect(sent[2]).toEqual({ text: conf.products.cmf.grading_prompt.example.prompt })
    expect(out.references).toEqual([{ n: 2, pin_id: 'case-experience2--front', title: 'case-experience2--front', role: 'clown', colourway: null, sha256: clownSha }])
    expect(out.view).toBe('clown')
    expect(out.colourway).toBe('Ice blu classic matte')
    expect(out.reporting_only).toBe(true)
    expect(out.aggregate.verdict).toBe('PASS')
  })

  test('never without its clown, never the clown itself, never a column out of scope', async () => {
    const req = { kit, cmf, parts, candidate, spec: 'experience-2-cc', column: 'E', key: 'case-experience2--front' }
    const notPinned = await refusalOf(gradeCmfCandidate(req, gradeDeps(cmfRows({ status: 'pending' }))))
    expect(notPinned.message).toContain('is not pinned yet')
    const clownSha = cmf.keys['case-experience2--front'].clown!.sha256
    const itself = await refusalOf(gradeCmfCandidate({ ...req, candidate: { ...candidate, sha256: clownSha } }, gradeDeps(cmfRows())))
    expect(itself.message).toContain('the clown itself')
    const outOfScope = await refusalOf(gradeCmfCandidate({ ...req, column: 'G' }, gradeDeps(cmfRows())))
    expect(outOfScope.message).toContain('not in scope')
  })
})

// ------------------------------------------------------------------ the tools

const loaded: LoadedKit = {
  kit,
  conformance,
  ref: 'creative-v0.2.1',
  commit: 'd90c9bb',
  blobSha: 'blob',
  fetchedAt: new Date(),
  stale: false,
  staleReason: null,
}

function ctx(): ToolContext {
  return {
    principal: { credentialId: 'c', ownerId: 'damien', allowedTools: [], allowedModels: ['*'] },
    progress: new McpProgressReporter(),
    jobs: { store: new MemoryJobStore(), waitUntil: () => undefined },
    recordBackgroundUsage: async () => undefined,
    env: {} as unknown as NodeJS.ProcessEnv,
  }
}

function kitFiles(k: Kit = kit): CmfToolDeps['readKitFile'] {
  const c = cmfKit(k)
  return async (_loaded, file) => {
    if (file.path === c.product.grading_prompt?.parts_file?.path) return read('creative', 'cmf-grading.v1.sample.json')
    if (file.path === c.payloads[PAYLOAD_E].path) return payloadBytes
    if (file.path === c.specs['experience-2-cc'].path) return Buffer.from(JSON.stringify(REAL.spec), 'utf8')
    throw new Error(`the test serves no ${file.path}`)
  }
}

function useDeps(over: Partial<CmfToolDeps> = {}): { kitLoads: number } {
  const seen = { kitLoads: 0 }
  setCmfToolDeps({
    loadKit: async () => {
      seen.kitLoads++
      return loaded
    },
    readKitFile: kitFiles(),
    ownerAccess: async () => ({ admin: false, cmf: true }),
    pinRows: async () => cmfRows(),
    pinBytes: async () => null,
    fetchPdf: async () => Buffer.from('%PDF-1.7 not read'),
    packetPdf: async () => null,
    worker: () => null,
    ...over,
  })
  return seen
}

const TARGET = { tab: 'Experience 2 CC', column: 'E', clown: 'case-experience2--front' }

test.describe('the CMF tools', () => {
  test.afterEach(() => setCmfToolDeps(null))

  test('every tool refuses without CMF access, before the kit is read', async () => {
    const seen = useDeps({ ownerAccess: async () => ({ admin: false, cmf: false }) })
    const calls: Array<[typeof cmfListHandler, Record<string, unknown>]> = [
      [cmfListHandler, {}],
      [cmfPromptHandler, TARGET],
      [cmfRenderHandler, TARGET],
      [cmfCheckPdfHandler, { tab: 'Experience 2 CC', pdf_url: 'https://example.com/a.pdf' }],
    ]
    for (const [handler, args] of calls) {
      const err = await refusalOf(handler.run(args, ctx()))
      expect(err).toBeInstanceOf(CmfAccessError)
    }
    expect(seen.kitLoads).toBe(0)
  })

  test('cmf_list names the tabs, their SKUs in scope, their keys and the prompts ready', async () => {
    useDeps()
    const res = await cmfListHandler.run({}, ctx())
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('Experience 2 CC (experience-2-cc): in scope C c, D Ice blu marble, E Ice blu classic matte, F Ice blu marble')
    expect(text).toContain('case-experience2--back (draft)')
    expect(text).toContain('case-experience2--front (named, not confirmed)')
    expect(text).toContain(
      'prompts ready C through case-experience2--front, D through case-experience2--front, E through case-experience2--front, F through case-experience2--front'
    )
    expect(text).toContain('Dream (dream): in scope none')
    const tabs = (res.structuredContent as { tabs: unknown[] }).tabs
    expect(tabs).toHaveLength(Object.keys(cmf.specs).length)
  })

  test('cmf_list with a tab lists every SKU column, in scope or not, with why', async () => {
    useDeps()
    const res = await cmfListHandler.run({ tab: 'experience-2-cc' }, ctx())
    const tab = (res.structuredContent as { tabs: Array<{ skus: Array<{ column: string; in_scope: boolean; scope_reason: string | null }> }> }).tabs[0]
    expect(tab.skus.map((s) => s.column)).toEqual(['C', 'D', 'E', 'F'])
    expect(tab.skus[0].scope_reason).toBe('header not renamed; Product Name filled')
  })

  test("cmf_prompt gives prompt_build.py's payload verbatim", async () => {
    useDeps()
    const res = await cmfPromptHandler.run({ ...TARGET, column: 'e' }, ctx())
    const s = res.structuredContent as Record<string, unknown>
    expect(s.refused).toBe(false)
    expect(s.prompt).toBe(payloadE.prompt)
    expect(s.prompt_sha256).toBe(payloadE.prompt_sha256)
    expect(s.payload_id).toBe(PAYLOAD_E)
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain(`\n\n${payloadE.prompt}\n\n`)
    expect(text).toContain('named, not yet confirmed by Damien')
  })

  test("cmf_prompt gives prompt_build.py's refusal word for word, and a draft key's", async () => {
    const x = withKit((k) => {
      const p = k.products.cmf.payloads[PAYLOAD_E]
      p.status = 'refused'
      p.reasons = ['Shell - Front: the colour cell is empty']
      delete p.path
      delete p.sha256
    })
    useDeps({ loadKit: async () => ({ ...loaded, kit: x.kit }), readKitFile: kitFiles(x.kit) })
    const res = await cmfPromptHandler.run(TARGET, ctx())
    expect(res.structuredContent).toMatchObject({ refused: true, reasons: ['Shell - Front: the colour cell is empty'] })
    useDeps()
    const draft = await refusalOf(cmfPromptHandler.run({ ...TARGET, clown: 'case-experience2--back' }, ctx()))
    expect(draft.message).toContain('is a draft')
  })

  test('cmf_render takes no reference, image or prompt of its own', async () => {
    useDeps()
    const err = await refusalOf(cmfRenderHandler.run({ ...TARGET, prompt: 'better words' }, ctx()))
    expect(err.message).toContain('cmf_render takes no prompt')
  })

  test('cmf_render refuses a clown that is not pinned, or whose bytes changed, before paying', async () => {
    useDeps({ pinRows: async () => [] })
    expect((await refusalOf(cmfRenderHandler.run(TARGET, ctx()))).message).toContain('is not pinned in Vesper yet (an admin syncs the pins). Nothing was paid for.')
    useDeps({ pinBytes: async () => Buffer.from('a clown re-exported since') })
    expect((await refusalOf(cmfRenderHandler.run(TARGET, ctx()))).message).toContain('the clown changed; its key must be sampled again. Nothing was paid for.')
    useDeps()
    expect((await refusalOf(cmfRenderHandler.run({ ...TARGET, clown: 'case-experience2--back' }, ctx()))).message).toContain('is a draft')
  })

  test('cmf_check_pdf names the PDF one way, and says when the worker is not configured', async () => {
    useDeps()
    expect((await refusalOf(cmfCheckPdfHandler.run({ tab: 'Experience 2 CC' }, ctx()))).message).toContain('name the PDF by pdf_url or by cmf_packet_id')
    const noWorker = await refusalOf(cmfCheckPdfHandler.run({ tab: 'Experience 2 CC', pdf_url: 'https://example.com/a.pdf', engine: 'worker' }, ctx()))
    expect(noWorker.message).toContain('the creative worker is not configured')
    const noPacket = await refusalOf(cmfCheckPdfHandler.run({ tab: 'Experience 2 CC', cmf_packet_id: '6f1c2f0e-8a4b-4c1e-9d7a-1b2c3d4e5f60' }, ctx()))
    expect(noPacket.message).toContain('not one you can see')
  })
})

// ------------------------------------------------------------------ SKUs

test('a SKU by its column letter always, by its name only when one column has it', () => {
  expect(resolveSku(REAL.spec, 'e')).toBe('E')
  expect(resolveSku(REAL.spec, 'Ice blu classic matte')).toBe('E')
  expect(resolveSku(REAL.spec, 'SKU 3')).toBe('E')
  expect(refusal(() => resolveSku(REAL.spec, 'Ice blu marble'))).toContain('names 2 columns in Experience 2 CC: D, F')
  expect(refusal(() => resolveSku(REAL.spec, 'Teal'))).toContain("no SKU 'Teal'")
})

// ------------------------------------------------------------------ the creative worker

interface Stub {
  cfg: WorkerConfig
  seen: Array<{ body: any; url: string }>
  close(): Promise<void>
}

/** The worker's side of the contract: a fresh timestamp and a matching HMAC, else 401. */
async function workerStub(secret: string): Promise<Stub> {
  const seen: Stub['seen'] = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const ts = String(req.headers['x-creative-timestamp'] ?? '')
      const given = String(req.headers['x-creative-signature'] ?? '')
      const want = `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex')}`
      const fresh = Math.abs(Date.now() / 1000 - Number(ts)) <= 300
      res.setHeader('content-type', 'application/json')
      if (!fresh || given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
        res.statusCode = 401
        res.end(JSON.stringify({ error: 'unauthorized', message: 'bad signature' }))
        return
      }
      const body = JSON.parse(raw)
      seen.push({ body, url: req.url ?? '' })
      res.end(
        JSON.stringify({
          tab: body.tab,
          columns: REAL.columns,
          layout: body.layout,
          rows: REAL.rows,
          counts: REAL.counts,
          cells_compared: REAL.cells_compared,
          assertions: REAL.assertions,
          notes: [],
          clean: false,
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    cfg: { url: `http://127.0.0.1:${port}`, secret },
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

test.describe('the creative worker', () => {
  test('the signature is an HMAC of the timestamp and the raw body', () => {
    const want = crypto.createHmac('sha256', 's3cret').update('1790000000.{"a":1}').digest('hex')
    expect(signWorkerRequest('s3cret', 1790000000, '{"a":1}')).toBe(`sha256=${want}`)
    expect(workerConfigFromEnv({ CREATIVE_WORKER_URL: 'https://worker.example/', CREATIVE_WORKER_SECRET: 'x' } as unknown as NodeJS.ProcessEnv)).toEqual({
      url: 'https://worker.example',
      secret: 'x',
    })
    expect(workerConfigFromEnv({ CREATIVE_WORKER_URL: 'https://worker.example' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })

  test("a signed request gets the script's rows; a wrong secret is refused", async () => {
    const stub = await workerStub('the-worker-secret')
    try {
      const spec = { path: cmf.specs['experience-2-cc'].path, sha256: cmf.specs['experience-2-cc'].sha256, content: '{}' }
      const args = { pdfUrl: 'https://store.example/a.pdf', pdfSha256: 'ab'.repeat(32), spec, tab: 'Experience 2 CC', layout: 'vesper' as const }
      const out = await checkPdfOnWorker(stub.cfg, { ...args, columns: ['E'] })
      expect(out.engine).toBe('worker')
      expect(out.rows).toEqual(REAL.rows)
      expect(out.clean).toBe(false)
      expect(out.pdf_sha256).toBe('ab'.repeat(32))
      expect(Object.keys(out.summary).sort()).toEqual(['(legend)', 'C', 'D', 'E', 'F'])
      expect(stub.seen).toHaveLength(1)
      expect(stub.seen[0].url).toBe('/v1/spec-diff')
      expect(stub.seen[0].body).toEqual({ pdf: { url: 'https://store.example/a.pdf', sha256: 'ab'.repeat(32) }, spec, tab: 'Experience 2 CC', columns: ['E'], layout: 'vesper' })

      const wrong = await refusalOf(checkPdfOnWorker({ ...stub.cfg, secret: 'not-the-secret' }, args))
      expect(wrong).toBeInstanceOf(WorkerError)
      expect((wrong as WorkerError).status).toBe(401)
      expect(wrong.message).toContain('bad signature')
      expect(stub.seen).toHaveLength(1)
    } finally {
      await stub.close()
    }
  })

  test('cmf_check_pdf with engine worker sends the spec, and the PDF by url and sha256', async () => {
    const stub = await workerStub('the-worker-secret')
    const pdf = Buffer.from('%PDF-1.7 the export')
    try {
      useDeps({ fetchPdf: async () => pdf, worker: () => stub.cfg })
      const res = await cmfCheckPdfHandler.run({ tab: 'Experience 2 CC', pdf_url: 'https://store.example/a.pdf', engine: 'worker', columns: ['E'] }, ctx())
      const s = res.structuredContent as Record<string, unknown>
      expect(s.engine).toBe('worker')
      expect(s.clean).toBe(false)
      expect((res.content[0] as { text: string }).text).toContain('must not go out')
      const sent = stub.seen[0].body
      expect(sent.pdf).toEqual({ url: 'https://store.example/a.pdf', sha256: sha(pdf) })
      expect(sent.spec.path).toBe(cmf.specs['experience-2-cc'].path)
      expect(sent.spec.sha256).toBe(cmf.specs['experience-2-cc'].sha256)
      expect(JSON.parse(sent.spec.content).tab).toBe('Experience 2 CC')
      expect(sent.columns).toEqual(['E'])
    } finally {
      setCmfToolDeps(null)
      await stub.close()
    }
  })
})

// ------------------------------------------------------------------ the check in Vesper, on the real PDF

const PDF_NAME = 'tml-2027-loop-experience-2-carry-case--2026-09-22.pdf'

function findCasePdf(): string | null {
  const roots = [
    process.env.LOOP_ASSET_REVIEWER_DIR,
    path.join(__dirname, '..', '..', '..', 'loop-asset reviewer'),
    path.join(__dirname, '..', '..', '..', 'loop-asset-reviewer-cmf'),
  ].filter((p): p is string => !!p)
  for (const root of roots) {
    const p = path.join(root, 'workstreams', 'cmf', 'references', 'renders', 'pdf', PDF_NAME)
    if (fs.existsSync(p) && sha(fs.readFileSync(p)) === PARITY.pdf.sha256) return p
  }
  return null
}

const CASE_PDF = findCasePdf()

test.describe('the check in Vesper, on the spec case PDF', () => {
  test.skip(!CASE_PDF, 'the spec case PDF is not on this machine (it is never committed)')

  test("gives spec_diff.py's rows and does not let the PDF go out", async () => {
    const out = await checkPdfInVesper({ pdf: fs.readFileSync(CASE_PDF!), spec: REAL.spec, columns: REAL.columns, layout: 'vesper' })
    expect(out.engine).toBe('vesper')
    expect(out.rows).toEqual(REAL.rows)
    expect(out.counts).toEqual(REAL.counts)
    expect(out.cells_compared).toBe(REAL.cells_compared)
    expect(out.clean).toBe(false)
  })
})
