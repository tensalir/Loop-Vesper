/**
 * One CMF, two doors: for the same kit, the same upload and the same person, each web CMF Studio
 * route (`src/lib/creative/cmf/web-door.ts`, `/api/cmf/v2/*`) and the matching Claude tool give
 * the same answer. No database, storage or model: the service's reach is the fake world the
 * service tests use (`setCmfServiceDeps`), and the web door's is swapped here (the person, the job
 * store, waitUntil, the allowance).
 *
 * Why it is here (2026-09-30): the two doors shared almost no code and drifted. Both now call one
 * service; this file fails the moment a door answers a step differently:
 *
 *   - the listing data (cmf_list, GET list), and an upload made in the web as Claude sees it
 *   - the prompt bytes (cmf_prompt, POST prompt), and the same refusals in the same words
 *   - the render plan (cmf_render, POST render): model, lane, size, the clown and its sha256, the
 *     draw request, and parameters.creative, which differ in the door only
 *   - the grade inputs (grade_image, POST grade): the row and key read against, every part the
 *     grader reads, and the grade row
 *   - the answer row and its decider (record_verdict, POST verdict)
 *   - the supplier PDF's bytes and its check (cmf_pdf and cmf_check_pdf, POST pdf and check-pdf)
 *
 * and, for the web door alone: a render runs as a job the page polls, the daily allowance refuses
 * before anything is drawn, and a person without CMF access is told what Claude is told.
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import { setCmfServiceDeps, type CmfActor, type CmfServiceDeps } from '../src/lib/creative/cmf/service'
import type { GeminiPart } from '../src/lib/creative/gemini'
import {
  setCmfWebDoorDeps,
  webCheckPdf,
  webGrade,
  webList,
  webPrompt,
  webReadUpload,
  webRender,
  webRenderJob,
  webSupplierPdf,
  webUpload,
  webVerdict,
} from '../src/lib/creative/cmf/web-door'
import type { CmfWebJob, CmfWebJobStore } from '../src/lib/creative/cmf/web-jobs'
import { cmfCheckPdfHandler, cmfListHandler, cmfPdfHandler, cmfPromptHandler, cmfRenderHandler } from '../src/lib/headless/tools/cmf'
import { gradeImageHandler } from '../src/lib/headless/tools/creative-grade'
import { recordVerdictHandler } from '../src/lib/headless/tools/creative-verdict'
import { setCreativeToolReach } from '../src/lib/headless/tools/creative-read'
import type { ToolContext } from '../src/lib/headless/tools/types'
import { clone, specToXlsx } from './helpers/cmf-supplier'
import { ctx as baseCtx, IMPORT, KEY_ID, UPLOAD_NAME } from './helpers/cmf-upload'
import { actor, DAMIEN, MAYA, OUTSIDER, serviceWorld, type ServiceWorld } from './helpers/cmf-service-world'

const env = {} as unknown as NodeJS.ProcessEnv
const TAB = 'Experience 2 CC'
const UPLOAD = { import_id: IMPORT, tab: TAB, sku_column: 'E', clown: KEY_ID }
const json = (x: unknown) => JSON.parse(JSON.stringify(x))
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

// ------------------------------------------------------------------ the two doors

/** The same person through Claude: the credential's owner. */
function claude(profileId: string): ToolContext {
  const c = baseCtx()
  return { ...c, principal: { ...c.principal, ownerId: profileId, credentialId: `cred-${profileId.slice(-4)}` } }
}

/** A Claude tool's answer as JSON, or the refusal it throws. */
async function viaClaude(handler: { run: (a: Record<string, unknown>, c: ToolContext) => Promise<{ structuredContent?: unknown; isError?: boolean }> }, args: Record<string, unknown>, who = DAMIEN) {
  try {
    const res = await handler.run(args, claude(who))
    return { ok: !res.isError, body: json(res.structuredContent ?? {}) as Record<string, any> }
  } catch (err) {
    return { ok: false, error: (err as Error).message, name: (err as Error).name }
  }
}

/** A web route's answer: its status and JSON. */
async function viaWeb(res: Promise<Response>) {
  const r = await res
  return { status: r.status, body: (await r.json()) as Record<string, any> }
}

const post = (route: string, body: unknown) => new Request(`http://vesper.test/api/cmf/v2/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const get = (route: string) => new Request(`http://vesper.test/api/cmf/v2/${route}`)

/** Cmf web jobs in memory, as `prismaCmfWebJobStore` keeps them. */
class MemoryWebJobs implements CmfWebJobStore {
  rows = new Map<string, CmfWebJob>()
  private n = 0
  async create(input: { ownerId: string; toolName: string; request: Record<string, unknown> }) {
    const id = `ffffffff-0000-4000-8000-${String(++this.n).padStart(12, '0')}`
    const now = new Date()
    this.rows.set(id, { id, ...input, status: 'processing', result: null, error: null, outputIds: [], startedAt: now, createdAt: now, updatedAt: now, completedAt: null })
    return { id }
  }
  async complete(id: string, result: Record<string, unknown>, outputIds: string[]) {
    this.rows.set(id, { ...this.rows.get(id)!, status: 'completed', result, outputIds, completedAt: new Date() })
  }
  async fail(id: string, message: string) {
    this.rows.set(id, { ...this.rows.get(id)!, status: 'failed', error: message, completedAt: new Date() })
  }
  async get(id: string, ownerId: string) {
    const row = this.rows.get(id)
    return row && row.ownerId === ownerId ? row : null
  }
  async running() {
    return Array.from(this.rows.values()).filter((r) => r.status === 'processing')
  }
}

interface Parity {
  w: ServiceWorld
  jobs: MemoryWebJobs
  pending: Array<Promise<unknown>>
  draws: Array<Record<string, unknown>>
  reads: GeminiPart[][]
  pdfs: Array<{ path: string; bytes: Buffer }>
  uploads: Map<string, { id: string; ownerId: string; fileName: string; storagePath: string | null; createdAt: Date; bytes?: Buffer }>
  as(profileId: string): void
  allowance: { refuse: boolean; asked: unknown[] }
}

/**
 * The service tests' world, watched: every draw request, every grader read and every saved PDF is
 * kept, uploads made in the web are kept in memory where every step reads uploads, and the web
 * door signs in whoever `as` names.
 */
async function parityWorld(): Promise<Parity> {
  const w = await serviceWorld({ confirmedKey: true })
  const draws: Parity['draws'] = []
  const reads: Parity['reads'] = []
  const pdfs: Parity['pdfs'] = []
  const uploads: Parity['uploads'] = new Map()
  const base = w.deps as CmfServiceDeps
  uploads.set(IMPORT, { id: IMPORT, ownerId: MAYA, fileName: UPLOAD_NAME, storagePath: `cmf/${MAYA}/imports/${IMPORT}.xlsx`, createdAt: new Date('2026-09-22T09:20:41Z') })
  let n = 0
  const deps: Partial<CmfServiceDeps> = {
    ...w.deps,
    draw: {
      ...base.draw,
      image: async (e, request) => {
        draws.push(json({ ...request, deadline: undefined }))
        return base.draw.image(e, request)
      },
    },
    grader: (e, limit, models) => {
      const g = base.grader(e, limit, models)
      return {
        ...g,
        read: async (parts, opts) => {
          reads.push(json(parts))
          return g.read(parts, opts)
        },
      }
    },
    pdf: {
      ...base.pdf,
      storePdf: async (p, bytes) => {
        pdfs.push({ path: p, bytes: Buffer.from(bytes) })
        return base.pdf.storePdf(p, bytes)
      },
    },
    fetchPdf: async () => pdfs[pdfs.length - 1].bytes,
    recentImports: async () =>
      Array.from(uploads.values())
        .filter((u) => u.storagePath)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(({ bytes: _b, ...row }) => row),
    workbook: {
      ...base.workbook,
      importRow: async (id) => {
        const u = uploads.get(id)
        return u ? { id: u.id, ownerId: u.ownerId, fileName: u.fileName, storagePath: u.storagePath, createdAt: u.createdAt } : null
      },
      bytes: async (p) => Array.from(uploads.values()).find((u) => u.storagePath === p)?.bytes ?? base.workbook.bytes(p),
    },
    uploads: {
      async create(input) {
        const id = `99999999-0000-4000-8000-${String(++n).padStart(12, '0')}`
        uploads.set(id, { id, ownerId: input.ownerId, fileName: input.fileName, storagePath: null, createdAt: new Date(Date.UTC(2026, 8, 30, 11, 0, n)) })
        return { id }
      },
      async store(p, bytes) {
        const u = Array.from(uploads.values()).find((x) => p.endsWith(`/${x.id}.xlsx`))!
        u.bytes = bytes
      },
      async setStoragePath(id, p) {
        uploads.get(id)!.storagePath = p
      },
    },
  }
  setCmfServiceDeps(deps)
  // grade_image and record_verdict find the product in the same kit, and read no admin flag.
  setCreativeToolReach({
    kitSet: () => ({
      studio: async () => {
        throw new Error('no creative kit in this test')
      },
      product: async () => w.loaded as any,
    }),
    isAdmin: async () => false,
  })
  const jobs = new MemoryWebJobs()
  const pending: Array<Promise<unknown>> = []
  const allowance = { refuse: false, asked: [] as unknown[] }
  let who: CmfActor = actor(DAMIEN, 'web')
  setCmfWebDoorDeps({
    actor: async () => ({ actor: who }),
    jobs,
    waitUntil: (p) => {
      pending.push(p)
    },
    allowance: async (input) => {
      allowance.asked.push(json(input))
      return allowance.refuse
        ? { ok: false, kind: 'image', used: 40, limit: 40, requested: 1, freesAt: null, message: 'You have used 40 of your 40 images through Claude and the CMF Studio together in the last 24 hours.' }
        : { ok: true }
    },
    env,
  })
  return {
    w,
    jobs,
    pending,
    draws,
    reads,
    pdfs,
    uploads,
    allowance,
    as(profileId) {
      who = actor(profileId, 'web')
    },
  }
}

/** A render through the web: 202, then the job drawn to its end. */
async function webRenderDone(p: Parity, body: Record<string, unknown>) {
  const started = await viaWeb(webRender(post('render', body)))
  expect(started.status, JSON.stringify(started.body)).toBe(202)
  await Promise.all(p.pending.splice(0))
  const job = await viaWeb(webRenderJob(started.body.job_id))
  expect(job.body.status, JSON.stringify(job.body)).toBe('completed')
  return { started: started.body, result: job.body.result as Record<string, any> }
}

/** The PDF's creation and modification times, which pdf-lib stamps from the clock. */
const undated = (b: Buffer) => b.toString('latin1').replace(/\/(CreationDate|ModDate) \(D:[^)]*\)/g, '/$1 (D:-)')

test.describe('one CMF, two doors: the web CMF Studio answers as Claude does', () => {
  test.afterEach(() => {
    setCmfServiceDeps(null)
    setCmfWebDoorDeps(null)
    setCreativeToolReach(null)
  })

  test('the listing: the same tabs, keys, uploads, renders and supplier PDFs', async () => {
    const p = await parityWorld()
    // Something of the team's to list, from each door.
    await viaClaude(cmfRenderHandler, { ...UPLOAD, sku_column: 'D' })
    await webRenderDone(p, UPLOAD)
    for (const tab of [undefined, 'experience-2-cc']) {
      const mcp = await viaClaude(cmfListHandler, tab ? { tab } : {})
      const web = await viaWeb(webList(get(`list${tab ? `?tab=${tab}` : ''}`)))
      expect(web.status).toBe(200)
      expect(mcp.ok).toBe(true)
      const { problems, rubric_version: _r, deciders, ...listing } = web.body
      expect(listing).toEqual(mcp.body)
      expect(problems).toEqual(mcp.body!.problems ?? [])
      expect(deciders).toEqual(['Damien'])
    }
    const listed = (await viaWeb(webList(get('list')))).body
    expect(listed.renders.map((r: any) => r.door)).toEqual(['web', 'mcp'])
    expect(listed.uploads.map((u: any) => u.import_id)).toEqual([IMPORT])
  })

  test('an upload made in the web is read by the same parse, and Claude names it and prompts from it as the web does', async () => {
    const p = await parityWorld()
    const form = new FormData()
    const bytes = specToXlsx(p.w.upload)
    form.append('file', new Blob([new Uint8Array(bytes)]), 'CMF_Schema_upload.xlsx')
    const up = await viaWeb(webUpload(new Request('http://vesper.test/api/cmf/v2/uploads', { method: 'POST', body: form })))
    expect(up.status, JSON.stringify(up.body)).toBe(201)
    const id = up.body.upload.import_id as string
    // Kept where every step reads an upload, and read back through that path.
    expect(p.uploads.get(id)).toMatchObject({ ownerId: DAMIEN, storagePath: `cmf/${DAMIEN}/imports/${id}.xlsx` })
    expect(sha(p.uploads.get(id)!.bytes!)).toBe(sha(bytes))
    expect(up.body.upload.sha256).toBe(sha(bytes))
    expect((await viaWeb(webReadUpload(id))).body.upload).toEqual(up.body.upload)
    // The tab and its SKUs by column letter are the parse's, not the old importer's.
    const tab = up.body.upload.tabs.find((t: any) => t.tab === TAB)
    expect(tab.slug).toBe('experience-2-cc')
    expect(tab.skus.map((s: any) => s.column)).toEqual(p.w.upload.skus.map((s) => s.column))
    expect(tab.keys.find((k: any) => k.id === KEY_ID)).toMatchObject({ draft: false, confirmed: true })
    // Claude lists it and fills the same prompt from it.
    const listed = await viaClaude(cmfListHandler, {})
    expect(listed.body!.uploads[0]).toMatchObject({ import_id: id, file: 'CMF_Schema_upload.xlsx' })
    const mcp = await viaClaude(cmfPromptHandler, { ...UPLOAD, import_id: id })
    const web = await viaWeb(webPrompt(post('prompt', { ...UPLOAD, import_id: id })))
    expect(web.body).toEqual(mcp.body)
    expect(web.body.workbook.import_id).toBe(id)
    // What is not a workbook is refused, and nothing is kept.
    const bad = new FormData()
    bad.append('file', new Blob(['not a workbook']), 'notes.txt')
    const refused = await viaWeb(webUpload(new Request('http://vesper.test/api/cmf/v2/uploads', { method: 'POST', body: bad })))
    expect(refused.status).toBe(422)
    expect(refused.body.error).toContain('notes.txt is not an .xlsx workbook')
    expect(p.uploads.size).toBe(2)
  })

  test('the prompt: the same bytes from an upload and from the kit, and the same refusals in the same words', async () => {
    const p = await parityWorld()
    for (const target of [UPLOAD, { ...UPLOAD, sku_column: 'D' }, { tab: TAB, column: 'E', clown: KEY_ID }]) {
      const mcp = await viaClaude(cmfPromptHandler, target)
      const web = await viaWeb(webPrompt(post('prompt', target)))
      expect(mcp.ok, mcp.error).toBe(true)
      expect(web.status).toBe(200)
      expect(web.body).toEqual(mcp.body)
      expect(Buffer.from(web.body.prompt, 'utf8').equals(Buffer.from(mcp.body!.prompt, 'utf8'))).toBe(true)
      expect(sha(web.body.prompt)).toBe(web.body.prompt_sha256)
    }
    // A draft key, a value where an identifier belongs, a column out of the tab.
    for (const target of [
      { ...UPLOAD, clown: 'case-experience2--back' },
      { ...UPLOAD, prompt: 'Recolour it' },
      { ...UPLOAD, sku_column: 'ZZ' },
    ]) {
      const mcp = await viaClaude(cmfPromptHandler, target)
      const web = await viaWeb(webPrompt(post('prompt', target)))
      expect(mcp.ok).toBe(false)
      expect(web.status).toBeGreaterThanOrEqual(400)
      expect(web.body.error).toBe(mcp.error)
    }
    // A cell the fill refuses: the same reasons, word for word.
    const words = clone(p.w.upload)
    const colour = words.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Colour')!
    colour.by_sku.E = { ...colour.by_sku.E!, raw: 'Ice blue', value: 'Ice blue', codes: [] }
    p.uploads.get(IMPORT)!.bytes = specToXlsx(words)
    const mcp = await viaClaude(cmfPromptHandler, UPLOAD)
    const web = await viaWeb(webPrompt(post('prompt', UPLOAD)))
    expect(mcp.body!.refused).toBe(true)
    expect(web.body).toEqual(mcp.body)
  })

  test('the render plan: the same model, lane, size, clown and draw, and the same parameters.creative but for the door', async () => {
    const p = await parityWorld()
    for (const lane of ['final', 'draft'] as const) {
      p.draws.length = 0
      const before = p.w.team.generations.length
      const mcp = await viaClaude(cmfRenderHandler, { ...UPLOAD, lane })
      expect(mcp.ok, mcp.error).toBe(true)
      const { started, result } = await webRenderDone(p, { ...UPLOAD, lane })
      const [gMcp, gWeb] = p.w.team.generations.slice(before)
      // The draw each door sent: model, prompt, the clown as the only reference, aspect and size.
      expect(p.draws).toHaveLength(2)
      expect(p.draws[1]).toEqual(p.draws[0])
      expect((p.draws[0] as any).references).toHaveLength(1)
      // What each render records about itself: the same creative, the door named apart.
      expect(gWeb.parameters.creative).toEqual(gMcp.parameters.creative)
      expect(gWeb.modelId).toBe(gMcp.modelId)
      expect(gWeb.prompt).toBe(gMcp.prompt)
      expect([gMcp.parameters.source, gWeb.parameters.source]).toEqual(['mcp', 'web'])
      const same = (g: typeof gMcp) => {
        const { source: _s, credentialId: _c, mcpJobId: _j, manifest, ...rest } = g.parameters as Record<string, any>
        return { ...rest, manifest: (manifest as any[]).map(({ file: _f, timestamp: _t, ...line }) => line) }
      }
      expect(same(gWeb)).toEqual(same(gMcp))
      const creative = gMcp.parameters.creative as Record<string, any>
      expect(creative).toMatchObject({ lane, key: KEY_ID, column: 'E', payload: { clown: { sha256: p.w.cmf.keys[KEY_ID].clown!.sha256 } } })
      // The plan each door answers with.
      const pick = (x: Record<string, any>) => ({ tab: x.tab, column: x.column, sku_name: x.sku_name, key: x.key, key_confirmed: x.key_confirmed, clown: x.clown, lane: x.lane, model: x.model, prompt_sha256: x.prompt_sha256, aspect: x.aspect, image_size: x.image_size, workbook: x.workbook })
      expect(pick(started.plan)).toEqual(pick(mcp.body!))
      expect(pick(result)).toEqual(pick(mcp.body!))
      expect(result.prompt).toBe(mcp.body!.prompt)
      expect(result.manifest.map(({ file: _f, timestamp: _t, ...l }: any) => l)).toEqual(mcp.body!.manifest.map(({ file: _f, timestamp: _t, ...l }: any) => l))
    }
    // The same refusals, before anything is drawn.
    p.draws.length = 0
    for (const bad of [{ ...UPLOAD, clown: 'case-experience2--back' }, { tab: TAB, column: 'E', clown: KEY_ID, prompt: 'better words' }, { ...UPLOAD, n: 9 }]) {
      const mcp = await viaClaude(cmfRenderHandler, bad)
      const web = await viaWeb(webRender(post('render', bad)))
      expect(mcp.ok).toBe(false)
      expect(web.body.error).toBe(mcp.error)
    }
    expect(p.draws).toHaveLength(0)
    expect(p.jobs.rows.size).toBe(2)
  })

  test('the grade inputs: the same row, key and parts read, and the same grade row, for a render from either door', async () => {
    const p = await parityWorld()
    const fromClaude = await viaClaude(cmfRenderHandler, UPLOAD)
    const fromWeb = await webRenderDone(p, { ...UPLOAD, sku_column: 'D' })
    for (const outputId of [fromClaude.body!.outputs[0].outputId as string, fromWeb.result.outputs[0].outputId as string]) {
      p.reads.length = 0
      const before = p.w.records.grades.length
      const mcp = await viaClaude(gradeImageHandler, { product: 'cmf', output_id: outputId, import_id: IMPORT })
      const readsMcp = p.reads.splice(0)
      const web = await viaWeb(webGrade(post('grade', { output_id: outputId, import_id: IMPORT })))
      const readsWeb = p.reads.splice(0)
      expect(mcp.ok, mcp.error).toBe(true)
      expect(web.status, JSON.stringify(web.body)).toBe(200)
      // What the grader read, part for part: the prompt with the row and the key, the render, the clown.
      expect(readsMcp.length).toBe(3)
      expect(readsWeb).toEqual(readsMcp)
      expect(web.body.cmf).toEqual(mcp.body!.cmf)
      expect(web.body.cmf).toMatchObject({ import_id: IMPORT, key: KEY_ID })
      for (const k of ['verdict', 'failed', 'fails', 'references', 'template_id', 'image_sha256', 'output_id', 'judge', 'judge_model', 'rubric_version']) {
        expect(web.body[k], k).toEqual(mcp.body![k])
      }
      const [gMcp, gWeb] = p.w.records.grades.slice(before)
      const row = ({ id: _i, createdAt: _c, credentialId: _cr, latencyMs: _l, runs: _r, ...g }: any) => g
      expect(row(gWeb)).toEqual(row(gMcp))
      expect([gMcp.credentialId, gWeb.credentialId]).toEqual([claude(DAMIEN).principal.credentialId, null])
    }
    // The same refusal for another upload than the render's.
    const other = '99999999-2222-4333-8444-555555555555'
    const mcp = await viaClaude(gradeImageHandler, { product: 'cmf', output_id: fromClaude.body!.outputs[0].outputId, import_id: other })
    const web = await viaWeb(webGrade(post('grade', { output_id: fromClaude.body!.outputs[0].outputId, import_id: other })))
    expect(web.body.error).toBe(mcp.error)
  })

  test("the answer: the same row and the same decider, the kit's or no one", async () => {
    const p = await parityWorld()
    const r = await viaClaude(cmfRenderHandler, UPLOAD)
    const outputId = r.body!.outputs[0].outputId as string
    for (const who of [DAMIEN, MAYA]) {
      const before = p.w.records.verdicts.length
      const mcp = await viaClaude(recordVerdictHandler, { product: 'cmf', output_id: outputId, answer: 'no', remark: 'insert too dark' }, who)
      p.as(who)
      const web = await viaWeb(webVerdict(post('verdict', { output_id: outputId, answer: 'no', remark: 'insert too dark' })))
      expect(mcp.ok, mcp.error).toBe(true)
      expect(web.status).toBe(200)
      expect(web.body.decider).toBe(mcp.body!.decider)
      expect(web.body.decider).toBe(who === DAMIEN ? 'Damien' : null)
      const { verdict_id: _a, ...restWeb } = web.body
      const { verdict_id: _b, ...restMcp } = mcp.body!
      expect(restWeb).toEqual(restMcp)
      const [vMcp, vWeb] = p.w.records.verdicts.slice(before)
      const row = ({ id: _i, createdAt: _c, credentialId: _cr, ...v }: any) => v
      expect(row(vWeb)).toEqual(row(vMcp))
      expect(vWeb).toMatchObject({ profileId: who, credentialId: null, route: 'vesper', answer: 'no', remark: 'insert too dark' })
    }
  })

  test('the supplier PDF: the same bytes and the same check, from renders made in either door', async () => {
    const p = await parityWorld()
    const d = await viaClaude(cmfRenderHandler, { ...UPLOAD, sku_column: 'D' })
    const e = await webRenderDone(p, UPLOAD)
    const outD = d.body!.outputs[0].outputId as string
    const outE = e.result.outputs[0].outputId as string
    const args = { import_id: IMPORT, tab: TAB, sku_columns: ['D', 'E'], output_ids: [outD, outE] }
    // Before Damien's yes both refuse, in the same words, and nothing is saved.
    const noYesMcp = await viaClaude(cmfPdfHandler, args)
    const noYesWeb = await viaWeb(webSupplierPdf(post('pdf', args)))
    expect(noYesWeb.status).toBe(422)
    expect(noYesWeb.body.error).toBe(noYesMcp.error)
    expect(p.pdfs).toHaveLength(0)
    await viaClaude(recordVerdictHandler, { product: 'cmf', output_id: outD, answer: 'yes', remark: '' })
    p.as(DAMIEN)
    await viaWeb(webVerdict(post('verdict', { output_id: outE, answer: 'yes', remark: '' })))

    const mcp = await viaClaude(cmfPdfHandler, args)
    const web = await viaWeb(webSupplierPdf(post('pdf', args)))
    expect(mcp.ok, mcp.error).toBe(true)
    expect(web.status, JSON.stringify(web.body)).toBe(200)
    expect(p.pdfs).toHaveLength(2)
    expect(p.pdfs[1].path).toBe(p.pdfs[0].path)
    expect(undated(p.pdfs[1].bytes)).toBe(undated(p.pdfs[0].bytes))
    const { supplier_pdf_id: idWeb, ...restWeb } = web.body
    const { supplier_pdf_id: idMcp, ...restMcp } = mcp.body!
    expect(restWeb).toEqual(restMcp)
    expect([idMcp, idWeb]).toEqual(p.w.team.pdfs.map((x) => x.id))
    expect(p.w.team.pdfs.map((x) => x.door)).toEqual(['mcp', 'web'])
    // Its check, from each door, on the PDF just saved.
    const check = { pdf_url: web.body.url, tab: TAB, columns: ['D', 'E'] }
    const cMcp = await viaClaude(cmfCheckPdfHandler, check)
    const cWeb = await viaWeb(webCheckPdf(post('check-pdf', check)))
    expect(cWeb.status).toBe(200)
    expect(cWeb.body).toEqual(cMcp.body)
    expect(cWeb.body.pdf_sha256).toBe(sha(p.pdfs[1].bytes))
    // And a render the web made the old way is refused by both.
    const old = { ...args, output_ids: [outD, 'bbbbbbbb-0000-4000-8000-000000000001'] }
    const oMcp = await viaClaude(cmfPdfHandler, old)
    const oWeb = await viaWeb(webSupplierPdf(post('pdf', old)))
    expect(oWeb.body.error).toBe(oMcp.error)
    expect(oWeb.body.error).toContain('is a web CMF Studio attempt')
  })

  test('without CMF access, every step is refused in both doors in the same words, and nothing is read or drawn', async () => {
    const p = await parityWorld()
    const r = await viaClaude(cmfRenderHandler, UPLOAD)
    const outputId = r.body!.outputs[0].outputId as string
    p.draws.length = 0
    p.as(OUTSIDER)
    const pairs: Array<[Awaited<ReturnType<typeof viaClaude>>, Awaited<ReturnType<typeof viaWeb>>]> = [
      [await viaClaude(cmfListHandler, {}, OUTSIDER), await viaWeb(webList(get('list')))],
      [await viaClaude(cmfPromptHandler, UPLOAD, OUTSIDER), await viaWeb(webPrompt(post('prompt', UPLOAD)))],
      [await viaClaude(cmfRenderHandler, UPLOAD, OUTSIDER), await viaWeb(webRender(post('render', UPLOAD)))],
      [await viaClaude(gradeImageHandler, { product: 'cmf', output_id: outputId, import_id: IMPORT }, OUTSIDER), await viaWeb(webGrade(post('grade', { output_id: outputId, import_id: IMPORT })))],
      [await viaClaude(recordVerdictHandler, { product: 'cmf', output_id: outputId, answer: 'yes' }, OUTSIDER), await viaWeb(webVerdict(post('verdict', { output_id: outputId, answer: 'yes' })))],
      [await viaClaude(cmfPdfHandler, { import_id: IMPORT, tab: TAB, sku_columns: ['E'], output_ids: [outputId] }, OUTSIDER), await viaWeb(webSupplierPdf(post('pdf', { import_id: IMPORT, tab: TAB, sku_columns: ['E'], output_ids: [outputId] })))],
      [await viaClaude(cmfCheckPdfHandler, { pdf_url: 'https://example.com/a.pdf', tab: TAB }, OUTSIDER), await viaWeb(webCheckPdf(post('check-pdf', { pdf_url: 'https://example.com/a.pdf', tab: TAB })))],
    ]
    for (const [mcp, web] of pairs) {
      expect(mcp.name).toBe('CmfAccessError')
      expect(web.status).toBe(403)
      expect(web.body.error).toBe(mcp.error)
    }
    expect(p.draws).toHaveLength(0)
    expect(p.w.records.verdicts).toHaveLength(0)
  })
})

test.describe("the web door's own part", () => {
  test.afterEach(() => {
    setCmfServiceDeps(null)
    setCmfWebDoorDeps(null)
    setCreativeToolReach(null)
  })

  test('a render answers 202 with its plan, draws after the response, and its job says when it is done; only its maker reads the job', async () => {
    const p = await parityWorld()
    const started = await viaWeb(webRender(post('render', UPLOAD)))
    expect(started.status).toBe(202)
    expect(started.body).toMatchObject({ status: 'processing', plan: { tab: TAB, column: 'E', key: KEY_ID, lane: 'final', n: 1 } })
    const running = await viaWeb(webRenderJob(started.body.job_id))
    expect(running.body.status).toBe('processing')
    await Promise.all(p.pending.splice(0))
    const done = await viaWeb(webRenderJob(started.body.job_id))
    expect(done.body.status).toBe('completed')
    const outputId = done.body.result.outputs[0].outputId
    expect(p.w.team.renderOutput(outputId)).not.toBeNull()
    expect(p.jobs.rows.get(started.body.job_id)!.outputIds).toEqual([outputId])
    // The allowance was asked for one image, by the web door, before the job existed.
    expect(p.allowance.asked).toEqual([expect.objectContaining({ ownerId: DAMIEN, isAdmin: false, door: 'web', need: { kind: 'image', units: 1 } })])
    p.as(MAYA)
    expect((await viaWeb(webRenderJob(started.body.job_id))).status).toBe(404)
  })

  test("the daily allowance refuses before anything is drawn, and says so in the allowance's words", async () => {
    const p = await parityWorld()
    p.allowance.refuse = true
    const res = await viaWeb(webRender(post('render', UPLOAD)))
    expect(res.status).toBe(429)
    expect(res.body.error).toContain('through Claude and the CMF Studio together')
    expect(p.jobs.rows.size).toBe(0)
    expect(p.draws).toHaveLength(0)
    const grade = await viaWeb(webGrade(post('grade', { output_id: 'aaaaaaaa-0000-4000-8000-00000000000e', import_id: IMPORT, tab: TAB, column: 'E', clown: KEY_ID })))
    expect(grade.status).toBe(429)
    expect(p.reads).toHaveLength(0)
  })

  test('a signed-out person is turned away before the service is reached', async () => {
    await parityWorld()
    setCmfWebDoorDeps({ actor: async () => ({ refused: { status: 401, error: 'Unauthorized' } }) })
    expect(await viaWeb(webList(get('list')))).toEqual({ status: 401, body: { error: 'Unauthorized' } })
  })
})
