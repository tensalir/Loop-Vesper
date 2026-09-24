import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import crypto from 'node:crypto'
import { ConformanceSchema, KitSchema, type Kit, type KitProduct } from '../src/lib/creative/kit-schema'
import { kitPins, type PinRow } from '../src/lib/creative/pins'
import { fillSkeleton, SkeletonError } from '../src/lib/creative/skeleton'
import { assembleGradingPrompt, fillText, GradingPromptError } from '../src/lib/creative/grading-prompt'
import { aggregateReads, readAnswer, type ReadResult } from '../src/lib/creative/aggregate'
import { verdictFromKit } from '../src/lib/creative/ladder'
import { gradeCandidate, type GradeDeps } from '../src/lib/creative/grade'
import { DrawError, executeDraws, manifestLine, planDraw } from '../src/lib/creative/draw'
import { drawImage, gradeJson, imagePart, type GeminiPart } from '../src/lib/creative/gemini'
import { pinPart } from '../src/lib/creative/pin-parts'
import { drawnAs, loadCandidate, CandidateError } from '../src/lib/creative/candidate'
import { brusselsDate, verdictLine } from '../src/lib/creative/verdict-line'
import { parseLine } from '../src/lib/creative/grammar'
import { parseDrawArgs } from '../src/lib/headless/tools/creative-draw'
import { gradeText } from '../src/lib/headless/tools/creative-grade'

/**
 * Vesper draws and grades Loop products from the creative kit alone, and must
 * do it the way the plugin repository's own scripts do. Parity first: every
 * fixture in the kit's conformance file (written by the product's scripts)
 * is reproduced here, byte for byte or by sha256.
 */

const FIX = join(__dirname, 'fixtures', 'creative')
const kit: Kit = KitSchema.parse(JSON.parse(readFileSync(join(FIX, 'kit.v1.sample.json'), 'utf8')))
const conf = ConformanceSchema.parse(JSON.parse(readFileSync(join(FIX, 'conformance.v1.sample.json'), 'utf8'))) as any
const eclipse = kit.products.eclipse as KitProduct
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')

function rowsFor(product: string, opts: { unusable?: string[]; mismatch?: string[] } = {}): PinRow[] {
  return kitPins(kit)
    .filter((s) => s.product === product)
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
      previewPath: `previews/${spec.sha256}.jpg`,
      derivedPath: spec.derived ? `derived/${spec.sha256}.png` : null,
      derivedSha256: null,
      derivedRecipe: null,
      geminiFileUri: `files/${spec.sha256.slice(0, 10)}`,
      geminiFileExpiresAt: new Date(Date.now() + 24 * 3600_000),
      status: opts.mismatch?.includes(spec.pinId) ? 'sha_mismatch' : opts.unusable?.includes(spec.pinId) ? 'pending' : 'ok',
      error: null,
      syncedAt: new Date(),
    }))
}

// ------------------------------------------------------------------ parity with the repository

test.describe('parity with the repository\'s own scripts', () => {
  test('every skeleton fixture is filled byte for byte, and a value with a newline is refused', () => {
    const fixtures = conf.products.eclipse.skeleton as Array<{ inputs: any; prompt: string; sha256: string }>
    expect(fixtures.length).toBeGreaterThanOrEqual(6)
    for (const f of fixtures) {
      const out = fillSkeleton(eclipse, f.inputs)
      expect(out).toBe(f.prompt)
      expect(sha(out)).toBe(f.sha256)
    }
    expect(() => fillSkeleton(eclipse, { ...fixtures[0].inputs, scene: 'two\nlines' })).toThrow(SkeletonError)
    expect(() => fillSkeleton(eclipse, { ...fixtures[0].inputs, light: 'a {{colourway}} light' })).toThrow(SkeletonError)
  })

  test('every grading-prompt fixture and the example are assembled from the kit alone', () => {
    const gp = conf.products.eclipse.grading_prompt as { fixtures: Array<{ inputs: any; sha256: string; length: number }>; example: { inputs: any; prompt: string } }
    expect(gp.fixtures.length).toBeGreaterThanOrEqual(6)
    for (const f of gp.fixtures) {
      const out = assembleGradingPrompt(eclipse, f.inputs)
      expect(out.length).toBe(f.length)
      expect(sha(out)).toBe(f.sha256)
    }
    expect(assembleGradingPrompt(eclipse, gp.example.inputs)).toBe(gp.example.prompt)
  })

  test('fillText fills named tokens in one pass and leaves every other brace', () => {
    expect(fillText('{"checks":{ids},"x":"{y}"}', { ids: '{"A1":bool}' })).toBe('{"checks":{"A1":bool},"x":"{y}"}')
    expect(fillText('{a}{b}', { a: '{b}', b: 'B' })).toBe('{b}B')
  })

  test('a product without a grader in the kit is refused with the reason', () => {
    expect(() => assembleGradingPrompt(kit.products.packaging as KitProduct, { view: 'both', asset_class: '', attached: [], missing: [] })).toThrow(
      GradingPromptError
    )
  })

  test('one read failing exactly a ladder vector\'s checks gets that vector\'s verdict', () => {
    for (const slug of ['eclipse', 'packaging', 'cmf']) {
      const checks = (kit.products[slug] as KitProduct).rubric.checks
      for (const v of conf.products[slug].ladder as Array<{ failed: string[]; verdict: string }>) {
        expect(verdictFromKit(kit.ladder, checks, v.failed)).toBe(v.verdict)
        const known = v.failed.filter((id) => checks.some((c) => c.id === id))
        if (known.length !== v.failed.length) continue // an unknown id cannot be failed by a read
        const answer = readAnswer({ checks: Object.fromEntries(checks.map((c) => [c.id, !known.includes(c.id)])) }, checks)
        const agg = aggregateReads([{ ok: true, model: 'm', answer, ms: 1 }], checks, kit.ladder)
        expect(agg.verdict).toBe(v.verdict)
      }
    }
  })
})

// ------------------------------------------------------------------ three reads into one grade

const checks = eclipse.rubric.checks
const allPass = () => Object.fromEntries(checks.map((c) => [c.id, true])) as Record<string, boolean>
const read = (fail: string[], extra: Record<string, unknown> = {}): ReadResult => ({
  ok: true,
  model: 'gemini-flash-latest',
  answer: readAnswer({ checks: { ...allPass(), ...Object.fromEntries(fail.map((id) => [id, false])) }, ...extra }, checks),
  ms: 10,
})
const erred: ReadResult = { ok: false, error: 'http 500', ms: 10 }
const bySeverity = (s: string) => checks.filter((c) => c.severity === s).map((c) => c.id)

test.describe('three reads become one grade', () => {
  test('a check fails on strictly more than half the reads: two of three, three of five', () => {
    const [crit] = bySeverity('critical')
    expect(aggregateReads([read([crit]), read([crit]), read([])], checks, kit.ladder).failed).toEqual([crit])
    expect(aggregateReads([read([crit]), read([]), read([])], checks, kit.ladder).failed).toEqual([])
    const five = [read([crit]), read([crit]), read([crit]), read([]), read([])]
    expect(aggregateReads(five, checks, kit.ladder).failed).toEqual([crit])
    expect(aggregateReads([read([crit]), read([crit]), read([]), read([]), read([])], checks, kit.ladder).failed).toEqual([])
  })

  test('an unanswered check fails that read, and "true" as text passes', () => {
    const [id] = bySeverity('critical')
    const given = { ...allPass() } as Record<string, unknown>
    delete given[id]
    given[checks[0].id] = 'true'
    const a = readAnswer({ checks: given }, checks)
    expect(a.checks[id]).toBe(false)
    expect(a.unanswered).toEqual([id])
    expect(a.checks[checks[0].id]).toBe(true)
    const agg = aggregateReads([{ ok: true, model: 'm', answer: a, ms: 1 }, { ok: true, model: 'm', answer: a, ms: 1 }, read([])], checks, kit.ladder)
    expect(agg.failed).toEqual([id])
    expect(agg.unanswered[id]).toBe(2)
  })

  test('an erred read fails every check; more than half erred is ERROR, never a verdict', () => {
    const one = aggregateReads([erred, read([]), read([])], checks, kit.ladder)
    expect(one.status).toBe('graded')
    expect(one.errors).toBe(1)
    expect(Object.values(one.fails).every((n) => n === 1)).toBe(true)
    expect(one.verdict).toBe('PASS')
    const most = aggregateReads([erred, erred, read([])], checks, kit.ladder)
    expect(most.status).toBe('ERROR')
    expect(most.verdict).toBe('ERROR')
  })

  test('three reads each failing a different minor: PASS by check, PASS_WITH_NOTES by read, both reported', () => {
    const minors = bySeverity('minor').slice(0, 3)
    expect(minors.length).toBe(3)
    const agg = aggregateReads(minors.map((m) => read([m])), checks, kit.ladder)
    expect(agg.verdict).toBe('PASS')
    expect(agg.per_read_verdicts).toEqual(['PASS_WITH_NOTES', 'PASS_WITH_NOTES', 'PASS_WITH_NOTES'])
    expect(agg.verdict_majority).toBe('PASS_WITH_NOTES')
    expect(agg.unstable).toBe(false)
  })

  test('no verdict with a majority is unstable and shows the worst', () => {
    const [gate] = bySeverity('gate')
    const [crit] = bySeverity('critical')
    const agg = aggregateReads([read([gate]), read([crit]), read([])], checks, kit.ladder)
    expect(agg.unstable).toBe(true)
    expect(agg.verdict_majority).toBe('FAIL')
  })

  test('advisory failures are reported apart and never counted', () => {
    const adv = bySeverity('advisory')
    test.skip(adv.length === 0, 'the rubric has no advisory check')
    const agg = aggregateReads([read([adv[0]]), read([adv[0]]), read([])], checks, kit.ladder)
    expect(agg.failed_advisory).toEqual([adv[0]])
    expect(agg.failed).toEqual([])
    expect(agg.verdict).toBe('PASS')
  })
})

// ------------------------------------------------------------------ one grade, end to end with fakes

function fakeGradeDeps(answers: Array<Record<string, unknown> | Error>, rows = rowsFor('eclipse')): GradeDeps & { calls: GeminiPart[][] } {
  const calls: GeminiPart[][] = []
  let i = 0
  return {
    calls,
    pinRows: rows,
    candidatePart: async (c) => ({ inline_data: { mime_type: c.mimeType, data: c.bytes.toString('base64') } }),
    pinPart: async (row) => ({ file_data: { mime_type: row.mime ?? 'image/png', file_uri: row.geminiFileUri! } }),
    read: async (parts) => {
      calls.push(parts)
      const a = answers[i++ % answers.length]
      if (a instanceof Error) throw a
      return { json: a, model: 'gemini-flash-latest' }
    },
  }
}

const candidate = { bytes: Buffer.from('candidate-bytes'), mimeType: 'image/png', sha256: sha('candidate-bytes') }

test.describe('grading a picture', () => {
  test('candidate first, the grader\'s references in the kit\'s order, the prompt last; three reads', async () => {
    const deps = fakeGradeDeps([{ checks: allPass() }])
    const out = await gradeCandidate(
      { kit, slug: 'eclipse', product: eclipse, candidate, colourway: 'Teal', view: 'profile', claim: 'Teal', claimSource: 'prompt' },
      deps
    )
    expect(deps.calls.length).toBe(3)
    const parts = deps.calls[0]
    expect('inline_data' in parts[0]).toBe(true)
    const expected = eclipse.references!.attach.Teal.profile
    expect(out.references.map((r) => r.pin_id)).toEqual(expected)
    expect(out.references.map((r) => r.n)).toEqual(expected.map((_, i) => i + 2))
    expect(parts.length).toBe(expected.length + 2)
    expect((parts[parts.length - 1] as { text: string }).text).toBe(out.prompt)
    expect(out.prompt).toContain('Trusted colourway claim: Teal (from the prompt).')
    expect(out.aggregate.verdict).toBe('PASS')
    expect(out.judge_label).toBe('judge gemini-flash-latest vesper x3')
    expect(out.view_assumed).toBe(false)
  })

  test('a pin not pinned yet is named as missing, and a pin that is the candidate is left out', async () => {
    const ids = eclipse.references!.attach.Teal.profile
    const pins = eclipse.references!.pins
    const second = pins.find((p) => p.id === ids[1])!
    const same = { ...candidate, sha256: second.sha256! }
    const deps = fakeGradeDeps([{ checks: allPass() }], rowsFor('eclipse', { unusable: [ids[0]] }))
    const out = await gradeCandidate({ kit, slug: 'eclipse', product: eclipse, candidate: same, colourway: 'Teal', view: 'profile', claim: null, claimSource: null }, deps)
    expect(out.references.map((r) => r.pin_id)).toEqual(ids.slice(2))
    expect(out.missing.map((m) => m.why)).toEqual(['not pinned yet', 'it is the picture under review'])
    expect(out.prompt).toContain('Some pinned references are missing locally and are not attached:')
    expect(out.prompt).toContain('There is no trusted colourway claim and the colourway could not be read')
  })

  test('with no view the kit\'s frontal is assumed and said; most reads erring is ERROR', async () => {
    const deps = fakeGradeDeps([new Error('http 503'), new Error('http 503'), { checks: allPass() }])
    const out = await gradeCandidate({ kit, slug: 'eclipse', product: eclipse, candidate, colourway: null, view: null, claim: null, claimSource: null }, deps)
    expect(out.view).toBe('frontal')
    expect(out.view_assumed).toBe(true)
    expect(out.aggregate.status).toBe('ERROR')
    const text = gradeText({ slug: 'eclipse', product: eclipse, outcome: out, gradeId: null, header: { kit_version: '0.2.0', kit_tag: 't', kit_ref: 'r', kit_commit: 'abcdef1234', kit_stale: false } })
    expect(text).toContain('No verdict: 2 of 3 reads erred')
    expect(text).toContain('View frontal assumed')
  })

  test('packaging and CMF are refused until their grader reaches the kit', async () => {
    for (const slug of ['packaging', 'cmf']) {
      await expect(
        gradeCandidate({ kit, slug, product: kit.products[slug] as KitProduct, candidate, colourway: null, view: null, claim: null, claimSource: null }, fakeGradeDeps([{}]))
      ).rejects.toThrow('carries no grader')
    }
  })

  test('the answer names the decider, the judge label, the plain-language captions and the grade id', async () => {
    const [crit] = bySeverity('critical')
    const deps = fakeGradeDeps([{ checks: { ...allPass(), [crit]: false } }])
    const out = await gradeCandidate({ kit, slug: 'eclipse', product: eclipse, candidate, colourway: 'Black', view: 'frontal', claim: 'Black', claimSource: 'reviewer' }, deps)
    const text = gradeText({ slug: 'eclipse', product: eclipse, outcome: out, gradeId: 'g-1', header: { kit_version: '0.2.0', kit_tag: 't', kit_ref: 'r', kit_commit: 'abcdef1234', kit_stale: false } })
    expect(text).toContain('advisory; the art director decides')
    expect(text).toContain('judge gemini-flash-latest vesper x3')
    const caption = checks.find((c) => c.id === crit)!.caption!
    expect(text).toContain(`| ${crit} | critical | ${caption} | 3 of 3 |`)
    expect(text).toContain('grade_id g-1')
  })
})

// ------------------------------------------------------------------ drawing

const drawArgs = { colourway: 'Teal', view: 'profile', scene: 'A woman asleep on her side in a hotel bed.', light: 'Soft window light from the left.' }

test.describe('drawing a product', () => {
  test('the render first, the wear photo second, the skeleton filled by code, the lane\'s model', () => {
    const plan = planDraw(kit, 'eclipse', eclipse, { ...drawArgs, lane: 'final', n: 2 }, rowsFor('eclipse'))
    const gen = (eclipse.generation as any).attach.Teal.profile as string[]
    expect(plan.references.map((r) => r.pin_id)).toEqual(gen)
    expect(plan.references[0].role).toBe('render')
    expect(plan.references.length).toBeLessThanOrEqual((eclipse.generation as any).max_references)
    expect(plan.model).toBe('gpt-image-2')
    expect(plan.n).toBe(2)
    expect(plan.prompt).toBe(fillSkeleton(eclipse, { n_refs: 2, colourway: 'Teal', scene: drawArgs.scene, light: drawArgs.light, format: '4:5' }))
    expect(plan.prompt).toContain('image 1')
    expect(planDraw(kit, 'eclipse', eclipse, { ...drawArgs, lane: 'second' }, rowsFor('eclipse')).model).toBe('gemini-3-pro-image')
    expect(planDraw(kit, 'eclipse', eclipse, { ...drawArgs, n: 4 }, rowsFor('eclipse')).n).toBe(2) // draws_per_call
  })

  test('a wear photo not pinned yet is left out and the one-reference skeleton is used', () => {
    const gen = (eclipse.generation as any).attach.Teal.profile as string[]
    const plan = planDraw(kit, 'eclipse', eclipse, drawArgs, rowsFor('eclipse', { unusable: [gen[1]] }))
    expect(plan.references.map((r) => r.pin_id)).toEqual([gen[0]])
    expect(plan.skeleton_key).toBe('1')
    expect(plan.left_out.join()).toContain('not pinned')
    expect(plan.prompt).not.toContain('image 2')
  })

  test('no render, or a render whose bytes are not the kit\'s, and nothing is drawn', () => {
    const gen = (eclipse.generation as any).attach.Teal.profile as string[]
    expect(() => planDraw(kit, 'eclipse', eclipse, drawArgs, rowsFor('eclipse', { mismatch: [gen[0]] }))).toThrow(DrawError)
    expect(() => planDraw(kit, 'eclipse', eclipse, drawArgs, rowsFor('eclipse', { unusable: [gen[0]] }))).toThrow('a draw starts from it')
  })

  test('packaging and CMF are drawn with their own tools', () => {
    expect(() => planDraw(kit, 'packaging', kit.products.packaging as KitProduct, drawArgs, [])).toThrow('packaging_mockup')
    expect(() => planDraw(kit, 'cmf', kit.products.cmf as KitProduct, drawArgs, [])).toThrow('cmf_render')
  })

  test('one call per image, all at once; a failed image is reported and the others kept', async () => {
    const plan = planDraw(kit, 'eclipse', eclipse, { ...drawArgs, n: 2 }, rowsFor('eclipse'))
    const seen: number[] = []
    const out = await executeDraws(plan, {
      drawOne: async (p, index) => {
        seen.push(index)
        expect(p.prompt).toBe(plan.prompt) // never rewritten between calls
        if (index === 2) throw new Error('refused')
        return { bytes: Buffer.from('png'), mimeType: 'image/png', model: p.model, settings: {} }
      },
    })
    expect(seen.sort()).toEqual([1, 2])
    expect(out.images.map((i) => i.index)).toEqual([1])
    expect(out.failures[0]).toContain('draw 2: refused')
  })

  test('the manifest line carries the full prompt, the references in order and source vesper', () => {
    const plan = planDraw(kit, 'eclipse', eclipse, drawArgs, rowsFor('eclipse'))
    const line = manifestLine(plan, { index: 1, file: 'https://x/0.png', model: 'gpt-image-2', settings: { quality: 'high' }, timestamp: '2026-10-02T09:00:00Z' })
    expect(line.prompt).toBe(plan.prompt)
    expect(line.source).toBe('vesper')
    expect(line.colourway_source).toBe('prompt')
    expect((line.reference_pins as any[]).map((r) => r.pin_id)).toEqual(plan.references.map((r) => r.pin_id))
    expect(JSON.stringify(line)).not.toContain('input_fidelity')
  })

  test('the arguments take no reference: naming one is refused by name', () => {
    expect(() => parseDrawArgs({ product: 'eclipse', ...drawArgs, referenceImage: 'https://x' })).toThrow('takes no reference')
    expect(() => parseDrawArgs({ product: 'eclipse', ...drawArgs, output_id: 'x' })).toThrow('never the next draw')
    expect(() => parseDrawArgs({ product: 'eclipse', ...drawArgs, sharpen: true })).toThrow('Invalid arguments')
    expect(parseDrawArgs({ product: 'eclipse', ...drawArgs }).async).toBe(false)
  })
})

// ------------------------------------------------------------------ Gemini, faked

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: any }> = []
  let i = 0
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
    const r = responses[Math.min(i++, responses.length - 1)]
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status })
  }) as unknown as typeof fetch
  return { impl, calls }
}
const answer = (text: string) => ({ candidates: [{ content: { parts: [{ text }] } }] })

test.describe('the Gemini client', () => {
  test('a gone model moves to the next; 429 waits and tries again; fences are stripped; temperature 0', async () => {
    const { impl, calls } = fakeFetch([
      { status: 404, body: 'not found' },
      { status: 429, body: 'slow down' },
      { status: 200, body: answer('```json\n{"checks":{"A1":true}}\n```') },
    ])
    const slept: number[] = []
    const out = await gradeJson(
      { apiKey: 'k', fetchImpl: impl, sleep: async (ms) => void slept.push(ms) },
      { models: ['gone-model', 'gemini-flash-latest'], parts: [{ text: 'x' }], deadline: Date.now() + 60_000, perCallMs: 10_000 }
    )
    expect(out).toEqual({ json: { checks: { A1: true } }, model: 'gemini-flash-latest' })
    expect(calls[0].url).toContain('/gone-model:generateContent')
    expect(calls[2].body.generationConfig).toEqual({ responseMimeType: 'application/json', temperature: 0 })
    expect(slept).toEqual([6000])
  })

  test('a refused image or a rejected key ends the read at once', async () => {
    const refused = fakeFetch([{ status: 400, body: 'Unable to process input image' }])
    await expect(gradeJson({ apiKey: 'k', fetchImpl: refused.impl, sleep: async () => {} }, { models: ['a', 'b'], parts: [], deadline: Date.now() + 9e4, perCallMs: 9e4 })).rejects.toThrow(
      'refused the image itself'
    )
    expect(refused.calls.length).toBe(1)
    const key = fakeFetch([{ status: 403, body: 'no' }])
    await expect(gradeJson({ apiKey: 'k', fetchImpl: key.impl, sleep: async () => {} }, { models: ['a'], parts: [], deadline: Date.now() + 9e4, perCallMs: 9e4 })).rejects.toThrow('GEMINI_API_KEY')
  })

  test('the draw sends references first in order, then the prompt; an aspect error falls back to a bare config', async () => {
    const png = Buffer.from('fake-png').toString('base64')
    const { impl, calls } = fakeFetch([
      { status: 400, body: 'unknown field imageConfig' },
      { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { data: png, mimeType: 'image/png' } }] } }] } },
    ])
    const refs: GeminiPart[] = [
      { file_data: { mime_type: 'image/png', file_uri: 'files/render' } },
      { file_data: { mime_type: 'image/png', file_uri: 'files/wear' } },
    ]
    const out = await drawImage({ apiKey: 'k', fetchImpl: impl, sleep: async () => {} }, { model: 'gemini-3-pro-image', prompt: 'P', references: refs, aspect: '4:5', size: '2K', deadline: Date.now() + 60_000 })
    expect(out.bytes.toString()).toBe('fake-png')
    const parts = calls[0].body.contents[0].parts
    expect(parts.map((p: any) => p.file_data?.file_uri ?? p.text)).toEqual(['files/render', 'files/wear', 'P'])
    expect(calls[0].body.generationConfig.imageConfig).toEqual({ aspectRatio: '4:5', imageSize: '2K' })
    expect(calls[1].body.generationConfig).toEqual({ responseModalities: ['IMAGE'] })
  })

  test('a small picture goes inline, a large one is uploaded once, never re-encoded', async () => {
    const small = Buffer.alloc(10, 1)
    const big = Buffer.alloc(100, 2)
    const uploads: Buffer[] = []
    const upload = async (b: Buffer) => {
      uploads.push(b)
      return 'files/up'
    }
    expect(await imagePart(small, 'image/png', { inlineLimit: 50, upload })).toEqual({ inline_data: { mime_type: 'image/png', data: small.toString('base64') } })
    expect(await imagePart(big, 'image/png', { inlineLimit: 50, upload })).toEqual({ file_data: { mime_type: 'image/png', file_uri: 'files/up' } })
    expect(uploads).toEqual([big])
  })

  test('a pin goes by its live URI, else its stored copy, uploaded and remembered when large', async () => {
    const [row] = rowsFor('eclipse')
    const spec = { derived: false, pinId: row.pinId, product: 'eclipse' }
    expect(await pinPart(row, spec, { storage: { get: async () => null }, inlineLimit: 10 })).toEqual({ file_data: { mime_type: 'image/png', file_uri: row.geminiFileUri! } })
    const lapsed = { ...row, geminiFileExpiresAt: new Date(Date.now() + 60_000) }
    const remembered: PinRow[] = []
    const part = await pinPart(lapsed, spec, {
      storage: { get: async () => Buffer.alloc(100) },
      upload: async () => ({ uri: 'files/fresh', expiresAt: new Date(Date.now() + 48 * 3600_000) }),
      remember: async (r) => void remembered.push(r),
      inlineLimit: 10,
    })
    expect(part).toEqual({ file_data: { mime_type: 'image/png', file_uri: 'files/fresh' } })
    expect(remembered[0].geminiFileUri).toBe('files/fresh')
  })
})

// ------------------------------------------------------------------ the picture under review

test.describe('the picture under review', () => {
  const deps = {
    findOwnOutput: async (id: string, owner: string) =>
      id === '11111111-1111-4111-8111-111111111111' && owner === 'me'
        ? { fileUrl: 'https://supabase/x.png', parameters: { creative: { product: 'eclipse', colourway: 'Plum', view: 'profile' } } }
        : null,
    fetchUrl: async () => ({ bytes: Buffer.from('bytes'), contentType: 'image/png' }),
    fetchFrontify: async () => ({ bytes: Buffer.from('frontify'), contentType: 'image/png' }),
  }

  test('an own draw brings what it was drawn as; someone else\'s is refused; exactly one source', async () => {
    const own = await loadCandidate({ output_id: '11111111-1111-4111-8111-111111111111' }, 'me', deps)
    expect(own.drawn).toEqual({ product: 'eclipse', colourway: 'Plum', view: 'profile' })
    expect(own.sha256).toBe(sha('bytes'))
    await expect(loadCandidate({ output_id: '11111111-1111-4111-8111-111111111111' }, 'someone-else', deps)).rejects.toThrow(CandidateError)
    await expect(loadCandidate({ output_id: 'a', image_url: 'https://b' }, 'me', deps)).rejects.toThrow('exactly one')
    await expect(loadCandidate({ image_url: 'http://plain' }, 'me', deps)).rejects.toThrow('https')
    expect(drawnAs({ other: 1 })).toBeNull()
  })
})

// ------------------------------------------------------------------ the comment line

test.describe("the decider's answer as a comment line", () => {
  test('the date is Brussels\' and the line reads back field by field', () => {
    expect(brusselsDate(new Date('2026-10-01T22:30:00Z'))).toBe('2026-10-02')
    expect(brusselsDate(new Date('2026-12-31T22:30:00Z'))).toBe('2026-12-31')
    const line = verdictLine({
      product: 'eclipse',
      answer: 'no',
      remark: 'the strap stops | at the ear',
      decoded: ['B3'],
      decodedUnconfirmed: ['C4'],
      grade: { verdict: 'PASS_WITH_NOTES', failed: ['B3'], judgeModel: 'gemini-flash-latest', surface: 'vesper', reads: 3, rubricVersion: '0.5.3' },
      rubricVersion: '0.5.3',
      at: new Date('2026-10-02T09:00:00Z'),
    })
    expect(line).toBe('[creative eclipse 2026-10-02] no | decoded B3,C4? | grade PASS_WITH_NOTES B3 | judge gemini-flash-latest vesper x3 | rubric 0.5.3 | the strap stops | at the ear')
    const back = parseLine(line)!
    expect(back.surface).toBe('vesper')
    expect(back.remark).toBe('the strap stops | at the ear')
  })

  test('an answer to a picture nobody graded says grade - and names who read it', () => {
    const line = verdictLine({ product: 'eclipse', answer: 'yes', remark: '', decoded: [], decodedUnconfirmed: [], grade: null, rubricVersion: '0.5.3', fallbackJudge: 'claude-opus-5-5', at: new Date('2026-10-02T09:00:00Z') })
    expect(line).toBe('[creative eclipse 2026-10-02] yes | decoded - | grade - | judge claude-opus-5-5 chat x1 | rubric 0.5.3 | -')
    const errored = verdictLine({ product: 'eclipse', answer: 'no', remark: 'x', decoded: [], decodedUnconfirmed: [], grade: { verdict: 'ERROR', failed: [], judgeModel: null, surface: 'vesper', reads: 3, rubricVersion: '0.5.3' }, rubricVersion: '0.5.3', at: new Date() })
    expect(errored).toContain('| grade - |')
  })

  test('no source file of the creative work tools sends input_fidelity', () => {
    for (const f of ['draw.ts', 'work-runtime.ts', 'gemini.ts']) {
      const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'creative', f), 'utf8')
      // Comments may say it is never sent; code may not name it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code).not.toContain('input_fidelity')
    }
  })
})
