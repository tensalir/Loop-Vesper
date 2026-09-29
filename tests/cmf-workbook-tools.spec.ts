/**
 * cmf_prompt and cmf_render from a workbook upload (`import_id`, `tab`, `sku_column`, `clown`),
 * through their injected reach: no database, no storage, no model call.
 *
 *   - the prompt is Damien's template filled by code from the upload's cells: for the committed
 *     spec it is the prompt the product repository committed, byte for byte
 *   - a render records the upload, the workbook's sha256, the SKU's cells as parsed, the key's
 *     sha256, the prompt's and the clown's, which cmf_pdf reads back
 *   - a refusal names the cell, and cmf_render refuses before anything is paid for
 *   - both take identifiers only, and refuse an argument that carries a value
 */

import { test, expect } from '@playwright/test'
import { cmfManifestLine, planCmfRenderFromWorkbook } from '../src/lib/creative/cmf/render'
import { buildWorkbookPayload } from '../src/lib/creative/cmf/workbook-payload'
import { skuSpecView } from '../src/lib/creative/cmf/prompt-fill'
import type { Spec } from '../src/lib/creative/cmf/spec-diff'
import { cmfPromptHandler, cmfRenderHandler, cmfRenderCreative, setCmfToolDeps } from '../src/lib/headless/tools/cmf'
import { clone, specToXlsx, withTestFilledBanner } from './helpers/cmf-supplier'
import { committedPayload, ctx, E2CC, FRONT, IMPORT, KEY_ID, kitWith, refusalOf, refusalText, stored, UPLOAD_NAME } from './helpers/cmf-upload'

test.describe('a render made from an upload', () => {
  test('records the upload, the workbook sha256, the SKU cells as parsed, the prompt sha256, the clown sha256 and the key sha256', async () => {
    const { cmf } = kitWith()
    const spec = withTestFilledBanner(E2CC, ['E'])
    const built = await buildWorkbookPayload({ cmf, wb: stored(spec), tab: 'Experience 2 CC', column: 'e', keyId: KEY_ID, readKey: async () => Buffer.from(JSON.stringify(FRONT)) })
    // The same prompt the product repository committed for this SKU and key.
    const committed = committedPayload('E')
    expect(built.payload.prompt).toBe(committed.prompt)
    const plan = planCmfRenderFromWorkbook(cmf, built.payload, built.payloadId, KEY_ID, { lane: 'draft' })
    const line = cmfManifestLine(plan, { index: 1, file: 'https://x/0.png', model: plan.model, settings: {}, timestamp: '2026-09-29T12:00:00Z' })
    expect(line.prompt_sha256).toBe(committed.prompt_sha256)
    expect(line.clown).toEqual({ id: KEY_ID, sha256: FRONT.clown!.sha256 })
    expect(line.workbook).toEqual({ import_id: IMPORT, file: UPLOAD_NAME, sha256: E2CC.workbook!.sha256, modified: '2026-09-22T09:20:42Z' })
    expect(line.sku_spec).toEqual(skuSpecView(spec, 'E'))
    expect(typeof line.sku_spec_sha256).toBe('string')
    expect(line.key_sha256).toBe(cmf.keys[KEY_ID].sha256)
    expect(built.payloadId).toBe(`import:${IMPORT}:experience-2-cc--E--${KEY_ID}`)
    // What the generation keeps, for cmf_pdf to read back.
    const creative = cmfRenderCreative(plan, { kit_version: '0.2.0', kit_tag: 'product-design-v0.2.0', kit_commit: 'd90c9bb' }) as any
    expect(creative.workbook.import_id).toBe(IMPORT)
    expect(creative.workbook.sku_spec).toEqual(skuSpecView(spec, 'E'))
    expect(creative.key_sha256).toBe(cmf.keys[KEY_ID].sha256)
    expect(creative.payload.prompt_sha256).toBe(committed.prompt_sha256)
  })

  test('a draft key or a column the tab lacks is refused before anything is paid for', async () => {
    const { cmf } = kitWith((p) => (p.keys[KEY_ID].draft = true))
    const err = await refusalOf(buildWorkbookPayload({ cmf, wb: stored(E2CC), tab: 'Experience 2 CC', column: 'E', keyId: KEY_ID, readKey: async () => Buffer.from(JSON.stringify(FRONT)) }))
    expect(err.message).toContain("the clown key 'case-experience2--front' is a draft")
    const ok = kitWith().cmf
    const out = await refusalOf(buildWorkbookPayload({ cmf: ok, wb: stored(E2CC), tab: 'Experience 2 CC', column: 'G', keyId: KEY_ID, readKey: async () => Buffer.from('{}') }))
    expect(out.message).toContain('Experience 2 CC has no SKU column G')
    const tab = await refusalOf(buildWorkbookPayload({ cmf: ok, wb: stored(E2CC), tab: 'Experience 3', column: 'E', keyId: KEY_ID, readKey: async () => Buffer.from('{}') }))
    expect(tab.message).toContain(`the upload '${IMPORT}' (${UPLOAD_NAME}) has no tab 'Experience 3'`)
  })
})

test.describe('cmf_prompt and cmf_render with import_id', () => {
  test.afterEach(() => setCmfToolDeps(null))

  function useUpload(spec: Spec = E2CC): string[] {
    const { loaded } = kitWith()
    const reads: string[] = []
    setCmfToolDeps({
      loadKit: async () => loaded as any,
      readKitFile: async (_l, file) => {
        reads.push(file.path)
        return Buffer.from(JSON.stringify(FRONT))
      },
      ownerAccess: async () => ({ admin: false, cmf: true }),
      workbook: {
        importRow: async (id) => (id === IMPORT ? { id, ownerId: 'owner-1', fileName: UPLOAD_NAME, storagePath: `cmf/owner-1/imports/${id}.xlsx`, createdAt: new Date('2026-09-22T09:20:41Z') } : null),
        bytes: async () => specToXlsx(spec),
        storedLastModified: async () => new Date('2026-09-22T09:20:42.000Z'),
      },
    })
    return reads
  }

  function brokenInsertE(): Spec {
    const broken = clone(E2CC)
    const colour = broken.components.find((c) => c.header === 'Insert')!.fields.find((f) => f.name === 'Colour')!
    colour.by_sku.E = { ...colour.by_sku.E!, raw: 'Ice blue', value: 'Ice blue', codes: [] }
    return broken
  }

  test('cmf_prompt fills the template from the upload: the prompt the repository committed', async () => {
    useUpload()
    const res = await cmfPromptHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'D', clown: KEY_ID }, ctx())
    const committed = committedPayload('D')
    const sc = res.structuredContent as any
    expect(sc.refused).toBe(false)
    expect(sc.prompt).toBe(committed.prompt)
    expect(sc.prompt_sha256).toBe(committed.prompt_sha256)
    expect(sc.workbook).toMatchObject({ import_id: IMPORT, file: UPLOAD_NAME, modified: '2026-09-22T09:20:42Z' })
    expect((res.content[0] as any).text).toContain(committed.prompt)
  })

  test('cmf_prompt answers a refusal word for word, naming the cell', async () => {
    useUpload(brokenInsertE())
    const res = await cmfPromptHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'E', clown: KEY_ID }, ctx())
    const sc = res.structuredContent as any
    expect(sc.refused).toBe(true)
    expect(sc.reasons).toEqual(["Experience 2 CC!E26 Insert · Colour: no code and no ' / ' or 'N/A' (a colour in words only: 'Ice blue'); a zone line needs the code as the sheet writes it"])
  })

  test('cmf_render refuses a missing code before anything is paid for', async () => {
    useUpload(brokenInsertE())
    const msg = await refusalText(cmfRenderHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'E', clown: KEY_ID }, ctx()))
    expect(msg).toContain('not sent (nothing was paid for): Experience 2 CC!E26 Insert · Colour: no code')
  })

  test('an argument that carries a value is refused before anything is read', async () => {
    const reads = useUpload()
    const prompt = await refusalText(cmfPromptHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'D', clown: KEY_ID, colour_code: 'Pantone 544C' }, ctx()))
    expect(prompt).toContain('cmf_prompt takes identifiers only (import_id, tab, sku_column, clown) and refuses colour_code')
    const render = await refusalText(cmfRenderHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'D', clown: KEY_ID, prompt: 'Recolour it ice blue' }, ctx()))
    expect(render).toContain('cmf_render takes identifiers only')
    expect(render).toContain('refuses prompt')
    expect(await refusalText(cmfPromptHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'Pantone 544C', clown: KEY_ID }, ctx()))).toContain('a column letter')
    expect(reads).toEqual([])
  })
})
