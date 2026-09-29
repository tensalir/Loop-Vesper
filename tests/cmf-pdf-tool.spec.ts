/**
 * cmf_pdf through its injected reach: no database, no storage, no model call.
 *
 * It saves a supplier PDF only for Claude renders made from a workbook upload, each with a yes
 * from the CMF decider, through a confirmed clown key that has not changed since, from cells that
 * have not changed since, and only when the PDF read back equals the upload's cells. Each refusal
 * says why and saves nothing. It takes identifiers only.
 */

import { test, expect } from '@playwright/test'
import { type CmfKit } from '../src/lib/creative/cmf/kit-cmf'
import { planCmfRenderFromWorkbook } from '../src/lib/creative/cmf/render'
import { buildWorkbookPayload } from '../src/lib/creative/cmf/workbook-payload'
import type { ClownKeyFile } from '../src/lib/creative/cmf/prompt-fill'
import { CmfPdfRefused, runCmfPdf, type CmfPdfDeps, type RenderOutputRow, type VerdictRow } from '../src/lib/creative/cmf/supplier-pdf-run'
import { checkSupplierPdf } from '../src/lib/creative/cmf/supplier-pdf-check'
import type { ClownKey, Spec } from '../src/lib/creative/cmf/spec-diff'
import { cmfPdfHandler, cmfRenderCreative, setCmfToolDeps } from '../src/lib/headless/tools/cmf'
import { clone, png, testConfirmed, withTestFilledBanner } from './helpers/cmf-supplier'
import { ctx, DECIDER, E2CC, FRONT, IMPORT, KEY_ID, kitWith, refusalOf, refusalText, stored } from './helpers/cmf-upload'

/** The render cmf_render would have recorded for one SKU of `spec`, through the real payload and plan code. */
async function renderOf(cmf: CmfKit, spec: Spec, col: string, id: string, key: ClownKeyFile = FRONT): Promise<RenderOutputRow> {
  const built = await buildWorkbookPayload({ cmf, wb: stored(spec), tab: spec.tab, column: col, keyId: KEY_ID, readKey: async () => Buffer.from(JSON.stringify(key)) })
  const plan = planCmfRenderFromWorkbook(cmf, built.payload, built.payloadId, KEY_ID, {})
  return {
    id,
    fileUrl: `https://placeholder.supabase.co/storage/v1/object/public/generated-images/mcp/c/g/${col}.png`,
    generationId: 'g',
    ownerId: 'owner-1',
    parameters: { toolName: 'cmf_render', source: 'mcp', creative: cmfRenderCreative(plan, { kit_version: '0.2.0', kit_tag: 'product-design-v0.2.0', kit_commit: 'd90c9bb' }) },
  }
}

const OUT_D = 'aaaaaaaa-0000-4000-8000-00000000000d'
const OUT_E = 'aaaaaaaa-0000-4000-8000-00000000000e'
const OUT_F = 'aaaaaaaa-0000-4000-8000-00000000000f'

interface World {
  deps: CmfPdfDeps
  stored: Array<{ path: string; bytes: Uint8Array }>
}

async function world(opts: {
  cmf: CmfKit
  spec?: Spec
  renders?: Record<string, RenderOutputRow>
  verdicts?: Record<string, VerdictRow[]>
  key?: ClownKeyFile
  webAttempts?: string[]
}): Promise<World> {
  const spec = opts.spec ?? withTestFilledBanner(E2CC, ['D', 'E', 'F'])
  const key = opts.key ?? testConfirmed(FRONT)
  const renders = opts.renders ?? { [OUT_D]: await renderOf(opts.cmf, spec, 'D', OUT_D, key), [OUT_E]: await renderOf(opts.cmf, spec, 'E', OUT_E, key) }
  const yes = (id: string): VerdictRow[] => [{ id: `v-${id}`, profileId: 'damien', credentialId: 'cred', answer: 'yes', remark: 'good', createdAt: new Date('2026-09-29T10:00:00Z') }]
  const saved: World['stored'] = []
  const image = await png(120, 160, 200)
  const deps: CmfPdfDeps = {
    loadWorkbook: async () => stored(spec),
    readKey: async () => Buffer.from(JSON.stringify(key)),
    renderOutput: async (id) => renders[id] ?? null,
    webAttempt: async (id) => (opts.webAttempts ?? []).includes(id),
    verdicts: async (id) => (opts.verdicts ? opts.verdicts[id] ?? [] : yes(id)),
    verdictEmail: async (v) => (v.profileId === 'damien' ? DECIDER : 'someone@loop.test'),
    imageBytes: async () => ({ bytes: image, mimeType: 'image/png' }),
    clownBytes: async () => ({ bytes: image, mimeType: 'image/png' }),
    storePdf: async (p, bytes) => {
      saved.push({ path: p, bytes })
      return `https://placeholder.supabase.co/storage/v1/object/public/generated-images/${p}`
    },
    now: () => new Date('2026-09-29T12:00:00Z'),
  }
  return { deps, stored: saved }
}

const ARGS = { import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['E', 'D'], output_ids: [OUT_D, OUT_E] }

// ------------------------------------------------------------------ cmf_pdf, the run

test.describe('cmf_pdf', () => {
  test('saves the PDF beside the upload when every render has the decider yes and the read-back is clean', async () => {
    const { cmf } = kitWith()
    const w = await world({ cmf })
    const r = await runCmfPdf(cmf, ARGS, w.deps)
    expect(w.stored).toHaveLength(1)
    expect(r.path).toBe(`cmf/owner-1/imports/${IMPORT}/pdf/20260929120000/CMF-TEST01_rev_A_Experience_2_Carry_Case_CMF_Ice_blu_marble_Ice_blu_classic_matte.pdf`)
    expect(r.url.endsWith(r.path)).toBe(true)
    expect(r.columns).toEqual(['D', 'E'])
    expect(r.pages).toEqual([
      { kind: 'sku', column: 'D' },
      { kind: 'sku', column: 'E' },
      { kind: 'breakdown', column: null },
    ])
    expect(r.legend).toEqual(['Shell - Front', 'Shell - Back', 'Insert'])
    expect(r.renders.map((x) => [x.column, x.output_id, x.decided_by])).toEqual([
      ['D', OUT_D, 'Damien'],
      ['E', OUT_E, 'Damien'],
    ])
    // What was saved is what passed: read it back once more.
    const again = await checkSupplierPdf({ bytes: w.stored[0].bytes, spec: stored(withTestFilledBanner(E2CC, ['D', 'E', 'F'])).specs['Experience 2 CC'], columns: ['D', 'E'], key: testConfirmed(FRONT) as ClownKey, workbook: stored(E2CC).info })
    expect(again.clean).toBe(true)
  })

  test('a deliberately broken cell stops the export with its name, and nothing is saved', async () => {
    const { cmf } = kitWith()
    const good = withTestFilledBanner(E2CC, ['D', 'E', 'F'])
    const renders = { [OUT_D]: await renderOf(cmf, good, 'D', OUT_D, testConfirmed(FRONT)), [OUT_E]: await renderOf(cmf, good, 'E', OUT_E, testConfirmed(FRONT)) }
    // The upload now: D's CMF number back to its placeholder. No render reads it, so only the PDF check can stop it.
    const broken = clone(good)
    broken.banner!['CMF number'].D = { ...(broken.banner!['CMF number'].D as any), raw: 'CMF-xxxxxx rev x', value: 'CMF-xxxxxx rev x', placeholder: 'x_run' }
    const w = await world({ cmf, spec: broken, renders })
    const err = await refusalOf(runCmfPdf(cmf, ARGS, w.deps))
    expect(err).toBeInstanceOf(CmfPdfRefused)
    expect(err.message).toContain('The PDF was not saved: 1 value(s)')
    expect(err.message).toContain('SKU D (Ice blu marble) · BANNER · CMF number · cell Experience 2 CC!D3: workbook "CMF-xxxxxx rev x", PDF "CMF-xxxxxx rev x" (the cell is empty or a placeholder in the workbook')
    expect(w.stored).toHaveLength(0)
  })

  test('a render made from an older spec refuses, naming the field that changed', async () => {
    const { cmf } = kitWith()
    const now = withTestFilledBanner(E2CC, ['D', 'E', 'F'])
    const older = clone(now)
    const colour = older.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Colour')!
    colour.by_sku.D = { ...colour.by_sku.D!, value: 'Silicon mix marble imitation Pantone 544C + white' }
    const renders = { [OUT_D]: await renderOf(cmf, older, 'D', OUT_D, testConfirmed(FRONT)), [OUT_E]: await renderOf(cmf, now, 'E', OUT_E, testConfirmed(FRONT)) }
    const w = await world({ cmf, spec: now, renders })
    const err = await refusalOf(runCmfPdf(cmf, ARGS, w.deps))
    expect(err.message).toContain(`output ${OUT_D} (Experience 2 CC column D) was rendered from cells that have changed since`)
    expect(err.message).toContain(
      '- Insert · Colour (Experience 2 CC!D26): rendered from "Silicon mix marble imitation Pantone 544C + white", the workbook now holds "Silicon mix marble imitation Pantone 544C + 427C + 5405 + white"'
    )
    expect(w.stored).toHaveLength(0)
  })

  test('a draft key refuses, and so does a key Damien has not confirmed', async () => {
    const { cmf } = kitWith()
    const draft = testConfirmed(FRONT)
    draft.zones![2].components = []
    const w1 = await world({ cmf, key: draft, renders: { [OUT_D]: await renderOf(cmf, withTestFilledBanner(E2CC, ['D', 'E', 'F']), 'D', OUT_D), [OUT_E]: await renderOf(cmf, withTestFilledBanner(E2CC, ['D', 'E', 'F']), 'E', OUT_E) } })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, w1.deps))).message).toContain("the clown key 'case-experience2--front' is a draft")
    const w2 = await world({ cmf, key: FRONT })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, w2.deps))).message).toContain("the clown key 'case-experience2--front' is not confirmed by Damien")
    expect(w1.stored.length + w2.stored.length).toBe(0)
  })

  test("a render needs the decider's yes: no answer, someone else's yes, or a no each refuse", async () => {
    const { cmf } = kitWith()
    const none = await world({ cmf, verdicts: {} })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, none.deps))).message).toContain('has no answer from Damien yet')
    const other = await world({ cmf, verdicts: { [OUT_D]: [{ id: 'v', profileId: 'someone', credentialId: null, answer: 'yes', remark: null, createdAt: new Date() }] } })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, other.deps))).message).toContain('has no answer from Damien yet')
    const no = await world({
      cmf,
      verdicts: {
        [OUT_D]: [
          { id: 'v2', profileId: 'damien', credentialId: null, answer: 'no', remark: 'insert too dark', createdAt: new Date('2026-09-29T11:00:00Z') },
          { id: 'v1', profileId: 'damien', credentialId: null, answer: 'yes', remark: null, createdAt: new Date('2026-09-29T10:00:00Z') },
        ],
      },
    })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, no.deps))).message).toContain(`Damien's latest answer on output ${OUT_D} (Experience 2 CC column D) is no: "insert too dark"`)
  })

  test("with no decider email in the kit, nothing can be shown to carry Damien's yes", async () => {
    const { cmf } = kitWith((p) => (p.deciders = p.deciders.map((d: any) => ({ ...d, email: undefined }))))
    const w = await world({ cmf: kitWith().cmf })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, w.deps))).message).toContain("the product kit names no CMF decider's email")
  })

  test('a web CMF Studio attempt is refused: its clown is not recorded', async () => {
    const { cmf } = kitWith()
    const web = 'bbbbbbbb-0000-4000-8000-000000000001'
    const w = await world({ cmf, webAttempts: [web] })
    const err = await refusalOf(runCmfPdf(cmf, { ...ARGS, output_ids: [OUT_D, web] }, w.deps))
    expect(err.message).toContain(`'${web}' is a web CMF Studio attempt: its clown is not recorded`)
  })

  test("a render from the kit's saved copy of the sheet, not an upload, is refused", async () => {
    const { cmf } = kitWith()
    const w = await world({ cmf })
    const d = await w.deps.renderOutput(OUT_D)
    const kitRender = clone(d!)
    delete (kitRender.parameters as any).creative.workbook
    const w2 = await world({ cmf, renders: { [OUT_D]: kitRender, [OUT_E]: (await w.deps.renderOutput(OUT_E))! } })
    expect((await refusalOf(runCmfPdf(cmf, ARGS, w2.deps))).message).toContain("rendered from the kit's saved copy of the sheet, not from a workbook upload")
  })

  test('a key changed since the render refuses', async () => {
    const { cmf } = kitWith()
    const w = await world({ cmf })
    const moved = kitWith((p) => (p.keys[KEY_ID].sha256 = 'f'.repeat(64))).cmf
    expect((await refusalOf(runCmfPdf(moved, ARGS, w.deps))).message).toContain("the clown key 'case-experience2--front' changed since the renders were made")
  })

  test('two SKUs of one Product Name: F alone cannot be told from D, so it is refused', async () => {
    const { cmf } = kitWith()
    const spec = withTestFilledBanner(E2CC, ['D', 'E', 'F'])
    const w = await world({ cmf, renders: { [OUT_F]: await renderOf(cmf, spec, 'F', OUT_F, testConfirmed(FRONT)) } })
    const err = await refusalOf(runCmfPdf(cmf, { ...ARGS, sku_columns: ['F'], output_ids: [OUT_F] }, w.deps))
    expect(err.message).toContain("Experience 2 CC columns D and F share the Product Name 'Ice blu marble'")
  })
})


// ------------------------------------------------------------------ the tool itself

test.describe('cmf_pdf, the tool', () => {
  test.afterEach(() => setCmfToolDeps(null))

  test('an argument that carries a value is refused before anything is read', async () => {
    const reads: string[] = []
    setCmfToolDeps({
      loadKit: async () => {
        reads.push('kit')
        return kitWith().loaded as any
      },
      ownerAccess: async () => ({ admin: false, cmf: true }),
    })
    const pdf = await refusalText(cmfPdfHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['D'], output_ids: [OUT_D], values: { Colour: 'Pantone 544C' } }, ctx()))
    expect(pdf).toContain('cmf_pdf takes identifiers only (import_id, tab, sku_columns, output_ids) and refuses values')
    // An identifier is an identifier: a column is a letter, an output a uuid.
    expect(await refusalText(cmfPdfHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['Pantone 544C'], output_ids: [OUT_D] }, ctx()))).toContain('a column letter')
    expect(await refusalText(cmfPdfHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['D'], output_ids: ['Ice blu marble'] }, ctx()))).toContain('Invalid')
    expect(reads).toEqual([])
  })
})
