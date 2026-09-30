/**
 * What Claude sees from each CMF tool, pinned byte for byte: the text, the structured content and
 * every refusal, through the tools' injected reach (no database, storage or model).
 *
 * Why it is here (2026-09-30): the CMF tools became thin doors over one service
 * (`src/lib/creative/cmf/service.ts`) that the web CMF Studio calls too. The golden file was
 * written from the tools as they were before that move, so the move is held to changing nothing
 * Claude sees. Rewrite it (CMF_GOLDEN_WRITE=1) only for a change that means to change a tool's
 * answer, and say so in the commit.
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { kitPins, type PinRow } from '../src/lib/creative/pins'
import { planCmfRenderFromWorkbook } from '../src/lib/creative/cmf/render'
import { buildWorkbookPayload } from '../src/lib/creative/cmf/workbook-payload'
import { runCmfPdf, type CmfPdfDeps, type RenderOutputRow, type VerdictRow } from '../src/lib/creative/cmf/supplier-pdf-run'
import type { ClownKeyFile } from '../src/lib/creative/cmf/prompt-fill'
import type { Spec } from '../src/lib/creative/cmf/spec-diff'
import type { CmfKit } from '../src/lib/creative/cmf/kit-cmf'
import {
  cmfCheckPdfHandler,
  cmfListHandler,
  cmfPdfHandler,
  cmfPromptHandler,
  cmfRenderCreative,
  cmfRenderHandler,
  setCmfToolDeps,
  type CmfToolDeps,
} from '../src/lib/headless/tools/cmf'
import type { ToolHandler } from '../src/lib/headless/tools/types'
import { clone, png, specToXlsx, testConfirmed, withTestFilledBanner } from './helpers/cmf-supplier'
import { MemoryCmfTeam } from './helpers/memory-cmf-team'
import { ctx, DECIDER, E2CC, FRONT, IMPORT, KEY_ID, kitWith, UPLOAD_NAME } from './helpers/cmf-upload'

const GOLDEN = path.join(__dirname, 'fixtures', 'cmf', 'tool-golden.json')
const WRITE = process.env.CMF_GOLDEN_WRITE === '1'
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')

const OUT_D = 'aaaaaaaa-0000-4000-8000-00000000000d'
const OUT_E = 'aaaaaaaa-0000-4000-8000-00000000000e'
const WEB = 'bbbbbbbb-0000-4000-8000-000000000001'
const PAYLOAD_E = 'experience-2-cc--E--case-experience2--front'

/** A clown whose bytes the kit's key names, so the tool can read its pin. */
interface World {
  cmf: CmfKit
  loaded: ReturnType<typeof kitWith>['loaded']
  key: ClownKeyFile
  clown: Buffer
  image: Buffer
  spec: Spec
}

async function world(spec: Spec = withTestFilledBanner(E2CC, ['D', 'E', 'F'])): Promise<World> {
  const clown = await png(213, 28, 27, 64, 64)
  const image = await png(120, 160, 200)
  const key = testConfirmed(FRONT)
  key.clown = { ...key.clown!, sha256: sha(clown) }
  const { cmf, loaded } = kitWith((p) => {
    p.keys[KEY_ID].clown = { ...p.keys[KEY_ID].clown, sha256: sha(clown) }
    p.deciders = p.deciders.map((d: any) => ({ ...d, email: DECIDER }))
  })
  return { cmf, loaded, key, clown, image, spec }
}

function pinRows(w: World): PinRow[] {
  return kitPins(w.loaded.kit)
    .filter((s) => s.product === w.cmf.slug)
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
      status: 'ok',
      error: null,
      syncedAt: new Date('2026-09-29T00:00:00Z'),
    }))
}

async function renderOf(w: World, spec: Spec, col: string, id: string, ownerId = 'owner-1'): Promise<RenderOutputRow> {
  const readKey = async () => Buffer.from(JSON.stringify(w.key))
  const stored = storedOf(spec)
  const built = await buildWorkbookPayload({ cmf: w.cmf, wb: stored, tab: spec.tab, column: col, keyId: KEY_ID, readKey })
  const plan = planCmfRenderFromWorkbook(w.cmf, built.payload, built.payloadId, KEY_ID, {})
  return {
    id,
    fileUrl: `https://placeholder.supabase.co/storage/v1/object/public/generated-images/mcp/c/g/${col}.png`,
    generationId: 'g',
    ownerId,
    parameters: { toolName: 'cmf_render', source: 'mcp', creative: cmfRenderCreative(plan, { kit_version: '0.2.0', kit_tag: 'product-design-v0.2.0', kit_commit: 'd90c9bb' }) },
  }
}

function storedOf(spec: Spec) {
  const info = { ...(spec.workbook as any), file: UPLOAD_NAME }
  return {
    importId: IMPORT,
    ownerId: 'owner-1',
    fileName: UPLOAD_NAME,
    storagePath: `cmf/owner-1/imports/${IMPORT}.xlsx`,
    importedAt: '2026-09-22T09:20:41Z',
    info,
    specs: { [spec.tab]: { ...spec, workbook: info } },
  }
}

/** Every reach the tools have, for one world: the kit, the pins, the upload, the renders, the answers. */
async function depsFor(
  w: World,
  over: {
    upload?: Spec
    renders?: Record<string, RenderOutputRow>
    verdicts?: Record<string, VerdictRow[]>
    access?: { admin: boolean; cmf: boolean }
    pdf?: Buffer
  } = {}
): Promise<{ deps: Partial<CmfToolDeps>; saved: string[] }> {
  const upload = over.upload ?? w.spec
  const renders = over.renders ?? { [OUT_D]: await renderOf(w, w.spec, 'D', OUT_D), [OUT_E]: await renderOf(w, w.spec, 'E', OUT_E, 'someone-else') }
  const yes = (id: string): VerdictRow[] => [{ id: `v-${id}`, profileId: 'damien', credentialId: 'cred', answer: 'yes', remark: 'good', createdAt: new Date('2026-09-29T10:00:00Z') }]
  const saved: string[] = []
  const pdf: Omit<CmfPdfDeps, 'loadWorkbook' | 'readKey' | 'clownBytes'> = {
    renderOutput: async (id) => renders[id] ?? null,
    webAttempt: async (id) => id === WEB,
    verdicts: async (id) => (over.verdicts ? over.verdicts[id] ?? [] : yes(id)),
    verdictEmail: async (v) => (v.profileId === 'damien' ? DECIDER : 'someone@loop.test'),
    imageBytes: async () => ({ bytes: w.image, mimeType: 'image/png' }),
    storePdf: async (p) => {
      saved.push(p)
      return `https://placeholder.supabase.co/storage/v1/object/public/generated-images/${p}`
    },
    now: () => new Date('2026-09-29T12:00:00Z'),
  }
  const deps: Partial<CmfToolDeps> = {
    loadKit: async () => w.loaded as any,
    readKitFile: async (_l, file) => {
      if (file.path === w.cmf.specs['experience-2-cc'].path) return Buffer.from(JSON.stringify(w.spec))
      if (file.path === w.cmf.payloads[PAYLOAD_E]?.path) return fs.readFileSync(path.join(__dirname, 'fixtures', 'cmf', `${PAYLOAD_E}.payload.json`))
      if (file.path === w.cmf.product.grading_prompt?.parts_file?.path) {
        return fs.readFileSync(path.join(__dirname, 'fixtures', 'creative', 'product-cmf-grading.v1.sample.json'))
      }
      return Buffer.from(JSON.stringify(w.key))
    },
    ownerAccess: async () => over.access ?? { admin: false, cmf: true },
    pinRows: async () => pinRows(w),
    pinBytes: async () => w.clown,
    fetchPdf: async () => over.pdf ?? Buffer.from('%PDF-1.7 not read'),
    packetPdf: async () => null,
    worker: () => null,
    workbook: {
      importRow: async (id) =>
        id === IMPORT ? { id, ownerId: 'owner-1', fileName: UPLOAD_NAME, storagePath: `cmf/owner-1/imports/${id}.xlsx`, createdAt: new Date('2026-09-22T09:20:41Z') } : null,
      bytes: async () => specToXlsx(upload),
      storedLastModified: async () => new Date('2026-09-22T09:20:42.000Z'),
    },
    recentImports: async () => [
      { id: IMPORT, ownerId: 'owner-1', fileName: UPLOAD_NAME, storagePath: `cmf/owner-1/imports/${IMPORT}.xlsx`, createdAt: new Date('2026-09-22T09:20:41Z') },
      { id: '22222222-2222-4333-8444-555555555555', ownerId: 'owner-2', fileName: 'older.xlsx', storagePath: 'cmf/owner-2/imports/x.xlsx', createdAt: new Date('2026-09-20T08:00:00Z') },
    ],
    pdf,
    team: new MemoryCmfTeam(),
  }
  return { deps, saved }
}

/** What a call answers, as JSON: the result, or the refusal's name and message. */
async function answer(handler: ToolHandler, args: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await handler.run(args, ctx())
    return JSON.parse(JSON.stringify(res))
  } catch (err) {
    return { thrown: (err as Error).name, message: (err as Error).message }
  }
}

const TARGET = { tab: 'Experience 2 CC', column: 'E', clown: KEY_ID }
const UPLOAD = { import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'D', clown: KEY_ID }
const PDF_ARGS = { import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['E', 'D'], output_ids: [OUT_D, OUT_E] }

async function run(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const w = await world()
  const use = async (over: Parameters<typeof depsFor>[1] = {}) => {
    const d = await depsFor(w, over)
    setCmfToolDeps(d.deps)
    return d
  }

  await use()
  out.list_all = await answer(cmfListHandler, {})
  out.list_tab = await answer(cmfListHandler, { tab: 'experience-2-cc' })
  out.prompt_kit = await answer(cmfPromptHandler, TARGET)
  out.prompt_upload = await answer(cmfPromptHandler, UPLOAD)
  out.prompt_upload_draft = await answer(cmfPromptHandler, { ...UPLOAD, clown: 'case-experience2--back' })
  out.render_prompt_arg = await answer(cmfRenderHandler, { ...TARGET, prompt: 'better words' })
  out.render_upload_value = await answer(cmfRenderHandler, { ...UPLOAD, prompt: 'Recolour it' })
  out.render_draft = await answer(cmfRenderHandler, { ...TARGET, clown: 'case-experience2--back' })
  out.render_kit_clown = await answer(cmfRenderHandler, TARGET)
  out.check_pdf_none = await answer(cmfCheckPdfHandler, { tab: 'Experience 2 CC' })
  out.check_pdf_worker = await answer(cmfCheckPdfHandler, { tab: 'Experience 2 CC', pdf_url: 'https://example.com/a.pdf', engine: 'worker' })
  out.check_pdf_packet = await answer(cmfCheckPdfHandler, { tab: 'Experience 2 CC', cmf_packet_id: '6f1c2f0e-8a4b-4c1e-9d7a-1b2c3d4e5f60' })
  out.pdf_values = await answer(cmfPdfHandler, { ...PDF_ARGS, values: { Colour: 'x' } })

  const ok = await use()
  out.pdf_saved = await answer(cmfPdfHandler, PDF_ARGS)
  out.pdf_saved_paths = ok.saved

  await use({ verdicts: {} })
  out.pdf_no_answer = await answer(cmfPdfHandler, PDF_ARGS)
  await use()
  out.pdf_web_attempt = await answer(cmfPdfHandler, { ...PDF_ARGS, output_ids: [OUT_D, WEB] })

  // A render made from cells the upload no longer holds.
  const older = clone(w.spec)
  const insertD = older.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Colour')!
  insertD.by_sku.D = { ...insertD.by_sku.D!, value: 'Silicon mix marble imitation Pantone 544C + white' }
  await use({ renders: { [OUT_D]: await renderOf(w, older, 'D', OUT_D), [OUT_E]: await renderOf(w, w.spec, 'E', OUT_E) } })
  out.pdf_cells_changed = await answer(cmfPdfHandler, PDF_ARGS)

  const insert = clone(w.spec)
  const colour = insert.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Colour')!
  colour.by_sku.E = { ...colour.by_sku.E!, raw: 'Ice blue', value: 'Ice blue', codes: [] }
  await use({ upload: insert })
  out.prompt_upload_refused = await answer(cmfPromptHandler, { ...UPLOAD, sku_column: 'E' })
  out.render_upload_refused = await answer(cmfRenderHandler, { ...UPLOAD, sku_column: 'E' })

  // The supplier PDF read back by cmf_check_pdf: the PDF the run builds, from the same world.
  let pdfBytes: Buffer | null = null
  await use({
    pdf: await (async () => {
      const x = await depsFor(w)
      let captured: Uint8Array | null = null
      await runCmfPdf(w.cmf, PDF_ARGS, {
        ...(x.deps.pdf as CmfPdfDeps),
        loadWorkbook: async () => storedOf(w.spec) as any,
        readKey: async () => Buffer.from(JSON.stringify(w.key)),
        clownBytes: async () => ({ bytes: w.clown, mimeType: 'image/png' }),
        storePdf: async (_p, bytes) => {
          captured = bytes
          return 'https://placeholder.supabase.co/x.pdf'
        },
      })
      pdfBytes = Buffer.from(captured!)
      return pdfBytes
    })(),
  })
  const checked = (await answer(cmfCheckPdfHandler, { tab: 'Experience 2 CC', pdf_url: 'https://example.com/a.pdf', columns: ['D', 'E'] })) as any
  // The PDF's bytes carry its creation time, so its sha256 is named, not pinned.
  const pdfSha = sha(pdfBytes!)
  out.check_pdf_supplier = JSON.parse(JSON.stringify(checked).split(pdfSha).join('<pdf sha256>').split(pdfSha.slice(0, 12)).join('<pdf sha256 12>'))

  await use({ access: { admin: false, cmf: false } })
  out.no_access = {
    list: await answer(cmfListHandler, {}),
    prompt: await answer(cmfPromptHandler, TARGET),
    prompt_upload: await answer(cmfPromptHandler, UPLOAD),
    render: await answer(cmfRenderHandler, TARGET),
    render_upload: await answer(cmfRenderHandler, UPLOAD),
    check: await answer(cmfCheckPdfHandler, { tab: 'Experience 2 CC', pdf_url: 'https://example.com/a.pdf' }),
    pdf: await answer(cmfPdfHandler, PDF_ARGS),
  }
  return out
}

test.describe('what Claude sees from the CMF tools', () => {
  test.afterEach(() => setCmfToolDeps(null))

  test('is what it was before the CMF service moved under them', async () => {
    const got = await run()
    if (WRITE) {
      fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n', 'utf8')
      return
    }
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
    for (const k of Object.keys(want)) expect(got[k], k).toEqual(want[k])
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort())
  })
})
