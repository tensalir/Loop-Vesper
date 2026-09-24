/**
 * Packaging looks through Claude, held to the plugin repository:
 *
 *   - the packaging grading prompt: every packaging fixture in the kit's conformance file, by
 *     sha256, and its example byte for byte (`tools/kit.py`, `assemble_packaging_grading_prompt`)
 *   - the grade: the candidate first, then the cell's composite, white render, dieline and front
 *     panel in the kit's grade plan; the kit's calibration note on every result
 *   - the tools, through their injected reach: packaging access, the worker, the refusals
 *   - the flow against a fake creative worker that checks the signature the way the worker does:
 *     mockup, finish inputs, the model call in Vesper with the references in binding order and the
 *     lane's settings, unpad, surface; a draw that moved is reported and not kept
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { ConformanceSchema, KitSchema, type Conformance, type Kit } from '../src/lib/creative/kit-schema'
import type { LoadedKit } from '../src/lib/creative/kit'
import { kitPins, type PinRow } from '../src/lib/creative/pins'
import type { GeminiPart } from '../src/lib/creative/gemini'
import type { LoadedCandidate } from '../src/lib/creative/candidate'
import { cellKey, laneRuledOut, neededPanelImages, packagingKit, resolveCell, PackagingError, type PackagingKit } from '../src/lib/creative/packaging/kit-packaging'
import { assemblePackagingGradingPrompt, gradePackagingCandidate } from '../src/lib/creative/packaging/grading'
import { workerFrom, type DrawCall, type FlowStorage } from '../src/lib/creative/packaging/flow'
import { callWorker, signWorkerRequest, workerHealth, type WorkerConfig } from '../src/lib/creative/cmf/worker-client'
import { adapterSizeFor } from '../src/lib/models/adapters/openai'
import {
  compositeFromParameters,
  executePackagingGrade,
  packagingFinishHandler,
  packagingGradeLines,
  packagingGradeStructured,
  packagingListLooksHandler,
  packagingMockupHandler,
  PackagingAccessError,
  setPackagingToolDeps,
  type PackagingToolDeps,
} from '../src/lib/headless/tools/packaging'
import type { RecordMcpGenerationInput } from '../src/lib/headless/record-generation'
import { McpProgressReporter } from '../src/lib/headless/mcp-progress'
import type { ToolContext } from '../src/lib/headless/tools/types'
import { MemoryJobStore } from './helpers/memory-job-store'

const FIX = path.join(__dirname, 'fixtures')
const read = (...p: string[]) => fs.readFileSync(path.join(FIX, ...p))
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const kit: Kit = KitSchema.parse(JSON.parse(read('creative', 'kit.v1.sample.json').toString('utf8')))
const conformance: Conformance = ConformanceSchema.parse(JSON.parse(read('creative', 'conformance.v1.sample.json').toString('utf8')))
const conf = conformance as any
const pk: PackagingKit = packagingKit(kit)

// A kit whose packaging pins are the test's own bytes, so every sha256 the flow checks holds.
const PIN_BYTES = new Map<string, Buffer>()
const testKit: Kit = (() => {
  const k = clone(kit) as any
  for (const pin of k.products.packaging.references.pins) {
    const bytes = Buffer.from(`PIN ${pin.id}`)
    PIN_BYTES.set(pin.id, bytes)
    pin.sha256 = sha(bytes)
  }
  return KitSchema.parse(k)
})()
const testPk = packagingKit(testKit)

function pinRows(k: Kit = testKit, except: string[] = []): PinRow[] {
  return kitPins(k)
    .filter((s) => s.product === 'packaging' && !except.includes(s.pinId))
    .map((s) => ({
      product: s.product,
      pinId: s.pinId,
      source: s.source,
      title: s.title,
      sha256: s.sha256,
      bytes: s.bytes,
      width: s.width,
      height: s.height,
      mime: 'image/png',
      storagePath: `pins/${s.sha256}.png`,
      previewPath: null,
      derivedPath: null,
      derivedSha256: null,
      derivedRecipe: null,
      geminiFileUri: null,
      geminiFileExpiresAt: null,
      status: 'ok' as const,
      error: null,
      syncedAt: new Date(),
    }))
}

async function refusalOf(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a refusal')
}

// ------------------------------------------------------------------ the prompt

test.describe('the packaging grading prompt', () => {
  test('every packaging fixture in the conformance file, from the kit alone', () => {
    const fixtures = conf.products.packaging.grading_prompt.fixtures
    expect(fixtures.length).toBeGreaterThan(0)
    for (const f of fixtures) {
      expect(sha(assemblePackagingGradingPrompt(pk.product, f.inputs)), JSON.stringify(f.inputs)).toBe(f.sha256)
    }
    const ex = conf.products.packaging.grading_prompt.example
    expect(assemblePackagingGradingPrompt(pk.product, ex.inputs)).toBe(ex.prompt)
  })

  test('a cell is read from the kit; the only look is taken, a wrong colourway is refused by name', () => {
    expect(resolveCell(pk, { box: 'experience', colourway: 'teal-plum' })).toEqual({ look: 'coachella', box: 'experience', colourway: 'teal-plum' })
    expect(() => resolveCell(pk, { box: 'experience', colourway: 'mint' })).toThrow("no colourway of coachella on experience 'mint'")
    expect(() => resolveCell(pk, { colourway: 'teal-plum' })).toThrow('name the box')
  })

  test("the router rules GPT Image 2 out for packaging, in the kit's own words", () => {
    expect(laneRuledOut(pk, 'gpt-image-2')).toContain('not a lane for packaging')
    expect(laneRuledOut(pk, 'gemini-3-pro-image')).toBeNull()
    expect(laneRuledOut(pk, 'gemini-3.1-flash-image')).toBeNull()
  })

  test("the mockup's panel pictures are the ones the dieline names for the box", () => {
    const dieline = JSON.parse(read('packaging', 'coachella-teal-plum.json').toString('utf8'))
    const panels = JSON.parse(read('packaging', 'white-open.json').toString('utf8'))
    expect(neededPanelImages(dieline, panels, 'experience')).toEqual(['references/figma/front-teal-plum.png'])
  })

  test("GPT Image 2's size reaches the adapter exactly", () => {
    expect(adapterSizeFor('1536x1024')).toEqual({ aspectRatio: '3:2', resolution: 1024 })
    expect(adapterSizeFor('999x999')).toBeNull()
  })
})

// ------------------------------------------------------------------ the grade

function candidate(bytes = Buffer.from('a finished box')) {
  return { bytes, mimeType: 'image/png', sha256: sha(bytes) }
}

function gradeDeps(rows: PinRow[], seen: GeminiPart[][]) {
  return {
    pinRows: rows,
    candidatePart: async (c: { sha256: string }): Promise<GeminiPart> => ({ text: `picture ${c.sha256.slice(0, 8)}` }),
    pinPart: async (row: PinRow): Promise<GeminiPart> => ({ text: `pin ${row.pinId}` }),
    read: async (parts: GeminiPart[]) => {
      seen.push(parts)
      return { json: { checks: Object.fromEntries(pk.product.rubric.checks.map((c) => [c.id, true])) }, model: 'gemini-flash-latest' }
    },
  }
}

test.describe('the packaging grade', () => {
  const cell = { look: 'coachella', box: 'experience', colourway: 'teal-plum' }
  const composite = { outputId: 'out-composite', sha256: sha('the composite'), bytes: Buffer.from('the composite'), mimeType: 'image/png' }

  test('the candidate first, then the composite, the white render, the dieline and the front panel', async () => {
    const seen: GeminiPart[][] = []
    const out = await gradePackagingCandidate({ kit: testKit, pk: testPk, cell, candidate: candidate(), composite }, gradeDeps(pinRows(), seen))
    expect(out.references.map((r) => [r.n, r.role])).toEqual([
      [2, 'composite'],
      [3, 'source_render'],
      [4, 'dieline'],
      [5, 'front_panel'],
    ])
    const parts = seen[0].map((p) => ('text' in p ? p.text.split(' ')[0] + ' ' + p.text.split(' ')[1] : '?'))
    expect(parts.slice(0, 5)).toEqual([`picture ${candidate().sha256.slice(0, 8)}`, `picture ${composite.sha256.slice(0, 8)}`, 'pin white-open', 'pin dieline-teal-plum', 'pin front-teal-plum'])
    expect(out.aggregate.verdict).toBe('PASS')
    expect(out.judge_label).toBe('judge gemini-flash-latest vesper x3')
    expect(out.calibration).toBe(pk.calibration)
    expect(out.calibration).toMatch(/^uncalibrated/)
  })

  test('the composite graded as itself is not attached to itself; a picture not pinned is named', async () => {
    const seen: GeminiPart[][] = []
    const out = await gradePackagingCandidate(
      { kit: testKit, pk: testPk, cell, candidate: candidate(composite.bytes), composite: null },
      gradeDeps(pinRows(testKit, ['front-teal-plum']), seen)
    )
    expect(out.references.map((r) => r.role)).toEqual(['source_render', 'dieline'])
    expect(out.missing).toEqual([
      { role: 'composite', why: 'it is the picture under review' },
      { role: 'front_panel', why: 'not pinned yet' },
    ])
    expect(out.prompt).toContain('it is the picture under review')
  })

  test("every result carries the calibration note and says the decider is not named", async () => {
    const out = await gradePackagingCandidate({ kit: testKit, pk: testPk, cell, candidate: candidate(), composite }, gradeDeps(pinRows(), []))
    const x = { outcome: out, composite: { output_id: composite.outputId, sha256: composite.sha256 }, gradeId: 'g1', pk: testPk }
    const lines = packagingGradeLines(x).join('\n')
    expect(lines).toContain('Uncalibrated: first Vesper grades are compared with the round 1 and 2 judge files')
    expect(lines).toContain('The head of design decides, and is not named yet')
    const s = packagingGradeStructured(x)
    expect(s.calibration).toBe(pk.calibration)
    expect(s.decider_named).toBe(false)
  })
})

// ------------------------------------------------------------------ the tools and the flow

const loaded: LoadedKit = {
  kit: testKit,
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
    principal: { credentialId: 'cred', ownerId: 'studio', allowedTools: [], allowedModels: ['*'] },
    progress: new McpProgressReporter(),
    jobs: { store: new MemoryJobStore(), waitUntil: () => undefined },
    recordBackgroundUsage: async () => undefined,
    env: {} as unknown as NodeJS.ProcessEnv,
  }
}

/** Storage as the worker sees it: signed URLs that name a bucket and a path. */
class FakeStorage implements FlowStorage {
  files = new Map<string, Buffer>()
  async signedGet(t: { bucket: string; path: string }) {
    return `https://store.test/get/${t.bucket}/${t.path}`
  }
  async signedPut(t: { bucket: string; path: string }) {
    return { upload_url: `https://store.test/put/${t.bucket}/${t.path}`, content_type: 'image/png' }
  }
  async read(t: { bucket: string; path: string }) {
    return this.files.get(`${t.bucket}/${t.path}`) ?? null
  }
  async write(t: { bucket: string; path: string }, bytes: Buffer) {
    this.files.set(`${t.bucket}/${t.path}`, bytes)
  }
  publicUrl(t: { bucket: string; path: string }) {
    return `https://store.test/public/${t.bucket}/${t.path}`
  }
  keyOf(url: string): string {
    const m = url.match(/^https:\/\/store\.test\/(?:get|put|public)\/(.+)$/)
    if (!m) throw new Error(`not a store URL: ${url}`)
    return m[1]
  }
}

const SECRET = 'the-worker-secret'
const LANE_MODELS: Record<string, string> = { pro: 'gemini-3-pro-image', nb2: 'gemini-3.1-flash-image', gpt: 'gpt-image-2' }
const FRAME = { pad: [9, 9, 0, 0], padded: [4096, 2304], sent: [2048, 1152], frame: [4096, 2286] }

/** The worker's side: a fresh timestamp and a matching HMAC, inputs held to their sha256, outputs uploaded. */
function fakeWorker(store: FakeStorage, calls: string[]) {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const route = new URL(url).pathname
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (route === '/v1/health') return json(200, { ok: true, version: '0.2.0', commit: '552987e', signed: true })
    const headers = new Headers(init?.headers)
    const ts = Number(headers.get('X-Creative-Timestamp'))
    const body = String(init?.body ?? '')
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300 || headers.get('X-Creative-Signature') !== signWorkerRequest(SECRET, ts, body)) {
      return json(401, { error: 'unauthorised', message: 'bad signature' })
    }
    calls.push(route)
    const b = JSON.parse(body)
    const fetchRef = (ref: { url: string; sha256: string }, field: string) => {
      const bytes = store.files.get(store.keyOf(ref.url))
      if (!bytes) throw Object.assign(new Error(`${field}: nothing at ${ref.url}`), { status: 422 })
      if (sha(bytes) !== ref.sha256) throw Object.assign(new Error(`${field}: sha256 mismatch`), { status: 422 })
      return bytes
    }
    const put = (out: { upload_url: string }, bytes: Buffer) => {
      store.files.set(store.keyOf(out.upload_url), bytes)
      return { sha256: sha(bytes), bytes: bytes.length, width: 4096, height: 2286 }
    }
    try {
      if (route === '/v1/mockup') {
        fetchRef(b.render, 'render')
        fetchRef(b.dieline, 'dieline')
        expect(sha(b.panels_json.content)).toBe(b.panels_json.sha256)
        expect(sha(b.dieline_json.content)).toBe(b.dieline_json.sha256)
        for (const [p, ref] of Object.entries(b.images)) fetchRef(ref as { url: string; sha256: string }, `images.${p}`)
        const comp = put(b.output, Buffer.from(`COMPOSITE ${b.box} ${b.colourway}`))
        const mask = put(b.mask_output, Buffer.from(`MASK ${b.box} ${b.colourway}`))
        return json(200, { ...comp, composite: comp, mask, recipe: { panels: 9 }, notes: [], inputs: { render: b.render.sha256, dieline: b.dieline.sha256, dieline_json: b.dieline_json.sha256, panels_json: b.panels_json.sha256, images: Object.keys(b.images) } })
      }
      if (route === '/v1/finish-inputs') {
        if (!LANE_MODELS[b.lane]) return json(422, { error: 'input', field: 'lane', message: 'must be one of gpt, nb2, pro' })
        const comp = fetchRef(b.composite, 'composite')
        fetchRef(b.render, 'render')
        fetchRef(b.dieline, 'dieline')
        const padded = put(b.outputs.padded, Buffer.from(`PADDED ${b.lane} ${sha(comp).slice(0, 8)}`))
        const half = put(b.outputs.dieline_half, Buffer.from(`HALF ${b.box} ${b.colourway}`))
        const request = b.lane === 'gpt' ? { size: '1536x1024', quality: 'high' } : { aspectRatio: '16:9', imageSize: '2K' }
        return json(200, {
          lane: b.lane,
          model: LANE_MODELS[b.lane],
          provider: b.lane === 'gpt' ? 'openai' : 'gemini',
          request,
          settings: { ...request, ...FRAME },
          frame: FRAME,
          prompt: 'Using the provided mockup of Loop\'s retail box (image 1) as the exact picture ...',
          skeleton: { heading: 'Prompt skeleton (v2, 2026-09-24, round 2)', version: 'v2' },
          references: [
            { role: 'composite', ...padded, uploaded: 'outputs.padded' },
            { role: 'render', sha256: b.render.sha256, bytes: 1, width: 4096, height: 2286, uploaded: null },
            { role: 'dieline', ...half, uploaded: 'outputs.dieline_half' },
          ],
          inputs: {},
        })
      }
      if (route === '/v1/unpad') {
        expect(b.frame).toEqual(FRAME)
        const draw = fetchRef(b.draw, 'draw')
        return json(200, { ...put(b.output, Buffer.from(`UNPADDED ${draw.toString()}`)), frame: b.frame })
      }
      if (route === '/v1/surface') {
        fetchRef(b.composite, 'composite')
        fetchRef(b.mask, 'mask')
        const draw = fetchRef(b.draw, 'draw')
        if (draw.toString().includes('MOVED')) {
          return json(200, { skipped: true, shift: [6.2, 1.1], frame_shift_px: 6.3, settings: {}, why: 'the frame moved 6.3 px at 1024 wide' })
        }
        return json(200, { ...put(b.output, Buffer.from(`SURFACED ${draw.toString()}`)), skipped: false, shift: [0.4, 0.2], frame_shift_px: 0.45, settings: { k: 1, sigma: 3, clip: 0.05, max_shift: 4 } })
      }
      return json(404, { error: 'no route' })
    } catch (err) {
      return json((err as { status?: number }).status ?? 500, { error: 'input', message: (err as Error).message })
    }
  }) as typeof fetch
  const cfg: WorkerConfig = { url: 'https://worker.test', secret: SECRET, fetchImpl }
  return workerFrom(cfg, (c, route, body) => callWorker(c, route, body), (c) => workerHealth(c))
}

interface Harness {
  store: FakeStorage
  calls: string[]
  draws: DrawCall[]
  recorded: RecordMcpGenerationInput[]
  kitLoads: number
}

function useDeps(over: Partial<PackagingToolDeps> = {}, opts: { moved?: number[] } = {}): Harness {
  const h: Harness = { store: new FakeStorage(), calls: [], draws: [], recorded: [], kitLoads: 0 }
  for (const [id, bytes] of Array.from(PIN_BYTES.entries())) h.store.files.set(`creative-pins/pins/${sha(bytes)}.png`, bytes)
  const worker = fakeWorker(h.store, h.calls)
  const kitFiles: Record<string, string> = {
    'products/packaging/references/dielines/coachella-teal-plum.json': 'coachella-teal-plum.json',
    'products/packaging/references/dielines/coachella-pink-teal.json': 'coachella-pink-teal.json',
    'products/packaging/references/panels/white-open.json': 'white-open.json',
    'products/packaging/references/panels/white-closed.json': 'white-closed.json',
  }
  setPackagingToolDeps({
    loadKit: async () => {
      h.kitLoads++
      return loaded
    },
    readKitFile: async (_l, file) => {
      const name = kitFiles[file.path]
      if (!name) throw new Error(`the test serves no ${file.path}`)
      return read('packaging', name)
    },
    ownerAccess: async () => ({ admin: false, packaging: true }),
    pinRows: async () => pinRows(),
    storage: () => h.store,
    worker: () => worker,
    draw: () => async (call) => {
      h.draws.push(call)
      const n = h.draws.length
      return { bytes: Buffer.from(`DRAW ${n}${opts.moved?.includes(n) ? ' MOVED' : ''}`), mimeType: 'image/png' }
    },
    buckets: () => ({ pins: 'creative-pins', outputs: 'generated-images' }),
    async findComposite(_owner, cell, outputId) {
      for (const r of [...h.recorded].reverse()) {
        const c = (r.parameters.creative ?? {}) as Record<string, unknown>
        if (r.parameters.toolName !== 'packaging_mockup' || c.cell !== cell) continue
        const out = { id: `out-${r.generationId}`, fileUrl: r.outputs[0].url }
        if (outputId && out.id !== outputId) continue
        return compositeFromParameters(r.generationId, out, r.parameters)
      }
      return null
    },
    async outputParameters(outputId) {
      const r = h.recorded.find((x) => `out-${x.generationId}` === outputId)
      return r ? (r.parameters as Record<string, unknown>) : null
    },
    record: async (input) => {
      h.recorded.push(input)
      return { projectId: 'p', sessionId: 's', generationId: input.generationId, outputIds: input.outputs.map((_, i) => (i === 0 ? `out-${input.generationId}` : `out-${input.generationId}-${i}`)) }
    },
    anchorUrl: async () => 'https://store.test/anchor/white-open',
    ...over,
  })
  return h
}

const CELL = { box: 'experience', colourway: 'teal-plum' }

test.describe('the packaging tools', () => {
  test.afterEach(() => setPackagingToolDeps(null))

  test('every tool refuses without packaging access, before the kit is read', async () => {
    const h = useDeps({ ownerAccess: async () => ({ admin: false, packaging: false }) })
    for (const [handler, args] of [
      [packagingListLooksHandler, {}],
      [packagingMockupHandler, CELL],
      [packagingFinishHandler, CELL],
    ] as const) {
      const err = await refusalOf(handler.run({ ...args }, ctx()))
      expect(err).toBeInstanceOf(PackagingAccessError)
    }
    expect(h.kitLoads).toBe(0)
  })

  test('packaging_list_looks names every cell, what Vesper holds and your mockup', async () => {
    useDeps({ pinRows: async () => pinRows(testKit, ['front-pink-teal']) })
    const res = await packagingListLooksHandler.run({}, ctx())
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('coachella/experience/teal-plum')
    expect(text).toContain('not held yet: front-pink-teal')
    expect(text).toContain('The head of design decides, and is not named yet')
    const cells = (res.structuredContent as { cells: Array<{ cell: string; ready: boolean }> }).cells
    expect(cells.map((c) => c.cell)).toEqual(['coachella/experience/teal-plum', 'coachella/experience/pink-teal', 'coachella/link/teal-plum', 'coachella/link/pink-teal'])
    expect(cells.find((c) => c.cell === 'coachella/experience/teal-plum')!.ready).toBe(true)
    expect(cells.find((c) => c.cell === 'coachella/experience/pink-teal')!.ready).toBe(false)
  })

  test('the mockup and the finish refuse when the worker is not configured', async () => {
    useDeps({ worker: () => null })
    for (const handler of [packagingMockupHandler, packagingFinishHandler]) {
      const err = await refusalOf(handler.run({ ...CELL }, ctx()))
      expect(err.message).toContain('the creative worker is not configured')
    }
  })

  test('a picture Vesper does not hold yet stops the mockup before the worker is called', async () => {
    const h = useDeps({ pinRows: async () => pinRows(testKit, ['white-open']) })
    const err = await refusalOf(packagingMockupHandler.run({ ...CELL }, ctx()))
    expect(err.message).toContain('is not pinned in Vesper yet')
    expect(h.calls).toEqual([])
  })

  test('the mockup sends the kit\'s pins by signed URL and sha256, and records the composite as the control', async () => {
    const h = useDeps()
    const res = await packagingMockupHandler.run({ ...CELL }, ctx())
    expect(h.calls).toEqual(['/v1/mockup'])
    expect(h.recorded).toHaveLength(1)
    const r = h.recorded[0]
    expect(r.stream).toBe('packaging')
    expect(r.modelId).toBe('none')
    const c = r.parameters.creative as Record<string, any>
    expect(c.cell).toBe('coachella/experience/teal-plum')
    expect(c.lane).toBe('composite')
    expect(c.inputs.images).toEqual(['references/figma/front-teal-plum.png'])
    expect(c.mask.bucket).toBe('creative-pins')
    expect(c.worker).toEqual({ version: '0.2.0', commit: '552987e' })
    expect((r.parameters.anchor as Record<string, string>).sha256).toBe(sha(PIN_BYTES.get('white-open')!))
    expect((res.structuredContent as { output_id: string }).output_id).toBe(`out-${r.generationId}`)
  })

  test('the finish refuses with no mockup yet, an unknown lane, a prompt or a reference', async () => {
    useDeps()
    expect((await refusalOf(packagingFinishHandler.run({ ...CELL }, ctx()))).message).toContain('run packaging_mockup for this cell first')
    await packagingMockupHandler.run({ ...CELL }, ctx())
    expect((await refusalOf(packagingFinishHandler.run({ ...CELL, lane: 'midjourney' }, ctx()))).message).toMatch(/Invalid arguments.*'pro' \| 'nb2' \| 'gpt'/)
    expect((await refusalOf(packagingFinishHandler.run({ ...CELL, prompt: 'make it pop' }, ctx()))).message).toContain('takes no prompt')
    expect((await refusalOf(packagingFinishHandler.run({ ...CELL, reference: 'https://x' }, ctx()))).message).toContain('takes no reference')
  })

  test("GPT Image 2 is refused by the kit's router before any model call", async () => {
    const h = useDeps()
    await packagingMockupHandler.run({ ...CELL }, ctx())
    const err = await refusalOf(packagingFinishHandler.run({ ...CELL, lane: 'gpt' }, ctx()))
    expect(err).toBeInstanceOf(PackagingError)
    expect(err.message).toContain('not a lane for packaging')
    expect(err.message).toContain('Nothing was paid for')
    expect(h.draws).toHaveLength(0)
  })

  test('the finish: finish inputs, the model in Vesper, unpad then surface; a draw that moved is reported, not kept', async () => {
    const h = useDeps({}, { moved: [2] })
    await packagingMockupHandler.run({ ...CELL }, ctx())
    const composite = h.recorded[0]
    const res = await packagingFinishHandler.run({ ...CELL, lane: 'pro', n: 2 }, ctx())
    expect(h.calls).toEqual(['/v1/mockup', '/v1/finish-inputs', '/v1/unpad', '/v1/surface', '/v1/unpad', '/v1/surface'])
    expect(h.draws).toHaveLength(2)
    for (const d of h.draws) {
      expect(d.provider).toBe('gemini')
      expect(d.model).toBe('gemini-3-pro-image')
      expect(d.references.map((r) => r.role)).toEqual(['composite', 'render', 'dieline'])
      expect(d.references[1].pin?.spec.pinId).toBe('white-open')
      expect(d.references[0].bytes.toString()).toMatch(/^PADDED pro /)
      expect(d.request).toEqual({ aspectRatio: '16:9', imageSize: '2K' })
      expect(d.prompt).toMatch(/^Using the provided mockup/)
    }
    expect(h.recorded).toHaveLength(2)
    const finish = h.recorded[1]
    expect(finish.outputs).toHaveLength(1)
    expect(finish.modelId).toBe('gemini-nano-banana-pro')
    const c = finish.parameters.creative as Record<string, any>
    expect(c.frame).toEqual(FRAME)
    expect(c.worker).toEqual({ version: '0.2.0', commit: '552987e' })
    expect(c.control.output_id).toBe(`out-${composite.generationId}`)
    expect(c.references.map((r: { role: string }) => r.role)).toEqual(['composite', 'render', 'dieline'])
    const manifest = finish.parameters.manifest as Array<Record<string, any>>
    expect(manifest).toHaveLength(2)
    expect(manifest[1].surface.skipped).toBe(true)
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain('1 finished picture of coachella/experience/teal-plum')
    expect(text).toContain('Draw 2 was not kept: the frame moved 6.3 px')
    expect(text).toContain(`The control, the composite itself: output out-${composite.generationId}`)
    const draws = (res.structuredContent as { draws: Array<{ kept: boolean }> }).draws
    expect(draws.map((d) => d.kept)).toEqual([true, false])
  })

  test('the nb2 lane draws with Nano Banana 2 and its own settings', async () => {
    const h = useDeps()
    await packagingMockupHandler.run({ ...CELL }, ctx())
    await packagingFinishHandler.run({ ...CELL, lane: 'nb2' }, ctx())
    expect(h.draws).toHaveLength(1)
    expect(h.draws[0].model).toBe('gemini-3.1-flash-image')
    expect(h.draws[0].references[0].bytes.toString()).toMatch(/^PADDED nb2 /)
  })

  test('a mockup made from pictures the kit no longer names must be made again', async () => {
    const h = useDeps()
    await packagingMockupHandler.run({ ...CELL }, ctx())
    ;(h.recorded[0].parameters.creative as Record<string, any>).inputs.render = sha('an older render')
    const err = await refusalOf(packagingFinishHandler.run({ ...CELL }, ctx()))
    expect(err.message).toContain('the kit changed the white render since this mockup was made')
    expect(h.draws).toHaveLength(0)
  })

  test('grade_image for packaging refuses a picture with no mockup of its cell, and says how to make one', async () => {
    useDeps()
    const load = async (): Promise<LoadedCandidate> => ({
      bytes: Buffer.from('an agency picture'),
      mimeType: 'image/png',
      sha256: sha('an agency picture'),
      source: 'url',
      outputId: null,
      frontifyAssetId: null,
      imageUrl: 'https://store.test/x.png',
      drawn: null,
    })
    const err = await refusalOf(executePackagingGrade(ctx(), loaded, { image_url: 'https://store.test/x.png', ...CELL }, load))
    expect(err.message).toContain(`no mockup of ${cellKey({ look: 'coachella', ...CELL })} is recorded for you yet`)
    expect(err.message).toContain('run packaging_mockup')
  })
})
