/**
 * The CMF service, one engine behind both doors (`src/lib/creative/cmf/service.ts`), through its
 * injected reach: no database, storage or model.
 *
 *   - a render recorded through the service lands in the CMF team project with the same
 *     `parameters.creative`, the door named, whichever door made it, and a second CMF user sees it
 *   - every supplier PDF saved gets a `cmf_supplier_pdfs` row, and the listing shows it
 *   - an answer on a CMF render needs CMF access
 *   - a grade with import_id reads the upload's row, the one the render was made from
 *   - cmf_pdf takes any of the team's renders, from either door; an old web attempt never
 *   - the listing gives each render its grade, the decider's answer and whether it can go on a PDF
 *   - the manifest export serves cmf_render lines; the data move picks the Claude CMF renders
 */

import { test, expect } from '@playwright/test'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { ConformanceSchema } from '../src/lib/creative/kit-schema'
import { assembleCmfGradingPrompt } from '../src/lib/creative/cmf/grading'
import { gradingRow, keyLines } from '../src/lib/creative/cmf/grading-row'
import type { CmfGradingParts } from '../src/lib/creative/cmf/kit-cmf'
import {
  CmfAccessError,
  cmfRenderCreative,
  listCmf,
  planGrade,
  planRender,
  recordCmfVerdict,
  runGrade,
  runRender,
  setCmfServiceDeps,
  supplierPdf,
  type CmfActor,
} from '../src/lib/creative/cmf/service'
import { CmfError } from '../src/lib/creative/cmf/kit-cmf'
import { isCmfRender, namesCmfTabOrKey, planCmfMove, type MoveCandidate } from '../src/lib/creative/cmf/team-records'
import { manifestRow, MANIFEST_TOOLS } from '../src/lib/creative/records'
import { kitHeader } from '../src/lib/creative/tool-views'
import { clone } from './helpers/cmf-supplier'
import { E2CC, FRONT, IMPORT, KEY_ID } from './helpers/cmf-upload'
import { actor, DAMIEN, MAYA, OUTSIDER, serviceWorld, WEB_ATTEMPT, type ServiceWorld } from './helpers/cmf-service-world'

const conformance = ConformanceSchema.parse(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creative', 'product-conformance.v1.sample.json'), 'utf8'))) as any
const kitParts: CmfGradingParts = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'creative', 'product-cmf-grading.v1.sample.json'), 'utf8'))
const sha = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const env = {} as unknown as NodeJS.ProcessEnv

async function refusal(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (err) {
    return err as Error
  }
  throw new Error('expected a refusal')
}

/** One render of an upload's SKU column through the service, as `who` through their door. */
async function render(w: ServiceWorld, who: CmfActor, column: string) {
  const ready = await planRender(who, { import_id: IMPORT, tab: 'Experience 2 CC', sku_column: column, clown: KEY_ID }, env)
  const x = await runRender(who, ready, { jobId: null }, env)
  expect(x.recorded, x.recordError ?? '').toBe(true)
  return { ready, x, outputId: x.outputs[0].outputId! }
}

async function answer(w: ServiceWorld, who: CmfActor, outputId: string, a: 'yes' | 'no', remark = '') {
  return recordCmfVerdict(who, { output_id: outputId, answer: a, remark, decoded: [], decoded_unconfirmed: [] }, env)
}

test.describe('the CMF service', () => {
  test.afterEach(() => setCmfServiceDeps(null))

  test('a render recorded through the service lands in the CMF team project, and a second CMF user sees it', async () => {
    const w = await serviceWorld()
    setCmfServiceDeps(w.deps)
    const damien = actor(DAMIEN, 'mcp')
    const { ready, x, outputId } = await render(w, damien, 'E')

    // In the team project, not a private "Claude" one; one session, visible to the members.
    const project = w.team.projectOf(x.generationId)!
    expect(project.systemKey).toBe('cmf')
    expect(w.team.projects).toHaveLength(1)
    expect(w.team.sessions).toEqual([expect.objectContaining({ projectId: project.id, name: 'CMF', type: 'image', isPrivate: false })])
    // The same parameters.creative the Claude door always wrote, the door named.
    const gen = w.team.generations.find((g) => g.id === x.generationId)!
    expect(gen.userId).toBe(DAMIEN)
    expect(gen.parameters.toolName).toBe('cmf_render')
    expect(gen.parameters.source).toBe('mcp')
    expect(gen.parameters.creative).toEqual(cmfRenderCreative(ready.plan, kitHeader(ready.loaded)))
    expect(gen.parameters.credentialId).toBe(damien.credentialId)
    expect(w.stored[0]).toBe(`mcp/${damien.credentialId}/${x.generationId}/0.png`)
    expect(w.team.analyses).toEqual([outputId])

    // Maya, in the web, sees Damien's render; a listing writes nothing.
    const maya = actor(MAYA, 'web')
    const seen = await listCmf(maya, {}, env)
    expect(seen.renders.map((r) => r.output_id)).toEqual([outputId])
    expect(seen.renders[0]).toMatchObject({ made_by: 'Damien', door: 'mcp', tab: 'Experience 2 CC', column: 'E', key: KEY_ID, import_id: IMPORT })
    expect(project.members.has(MAYA)).toBe(false)

    // Her render from the web goes to the same project, with the same kind of record, and makes her a member.
    const web = await render(w, maya, 'D')
    expect(w.team.projectOf(web.x.generationId)!.id).toBe(project.id)
    expect(project.members.has(MAYA)).toBe(true)
    const webGen = w.team.generations.find((g) => g.id === web.x.generationId)!
    expect(webGen.parameters.source).toBe('web')
    expect(webGen.parameters.credentialId).toBeNull()
    expect(Object.keys(webGen.parameters.creative as object).sort()).toEqual(Object.keys(gen.parameters.creative as object).sort())
    expect(w.stored[1]).toBe(`web/${MAYA}/${web.x.generationId}/0.png`)
    const both = await listCmf(damien, {}, env)
    expect(both.renders.map((r) => [r.output_id, r.door, r.made_by])).toEqual([
      [web.outputId, 'web', 'Maya'],
      [outputId, 'mcp', 'Damien'],
    ])
  })

  test('a member who lost CMF access is dropped from the team project; without access nothing is read or drawn', async () => {
    const w = await serviceWorld()
    setCmfServiceDeps(w.deps)
    await render(w, actor(DAMIEN), 'E')
    await render(w, actor(MAYA, 'web'), 'D')
    const project = w.team.projects[0]
    expect(project.members.has(MAYA)).toBe(true)
    w.access.delete(MAYA)
    w.team.access.delete(MAYA)
    await render(w, actor(DAMIEN), 'F')
    expect(project.members.has(MAYA)).toBe(false)
    for (const call of [
      listCmf(actor(MAYA, 'web'), {}, env),
      planRender(actor(MAYA, 'web'), { import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'E', clown: KEY_ID }, env),
      supplierPdf(actor(MAYA, 'web'), { import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['E'], output_ids: [IMPORT] }, env),
    ]) {
      expect(await refusal(call)).toBeInstanceOf(CmfAccessError)
    }
  })

  test('an answer on a CMF render needs CMF access, and says whether it is the decider the kit names', async () => {
    const w = await serviceWorld({ access: [DAMIEN, MAYA] })
    setCmfServiceDeps(w.deps)
    const { outputId } = await render(w, actor(MAYA, 'web'), 'E')
    const denied = await refusal(answer(w, actor(OUTSIDER), outputId, 'yes'))
    expect(denied).toBeInstanceOf(CmfAccessError)
    expect(w.records.verdicts).toHaveLength(0)
    const byMaya = await answer(w, actor(MAYA, 'web'), outputId, 'yes', 'looks right')
    expect(byMaya.decider).toBeNull()
    const byDamien = await answer(w, actor(DAMIEN), outputId, 'no', 'insert too dark')
    expect(byDamien.decider).toBe('Damien')
    expect(w.records.verdicts.map((v) => [v.profileId, v.answer, v.route, v.credentialId])).toEqual([
      [MAYA, 'yes', 'vesper', null],
      [DAMIEN, 'no', 'vesper', actor(DAMIEN).credentialId],
    ])
    // The listing counts the decider's answer only.
    const r = (await listCmf(actor(MAYA, 'web'), {}, env)).renders[0]
    expect(r.decider_answer).toMatchObject({ answer: 'no', by: 'Damien', remark: 'insert too dark' })
    expect(r.answers.map((a) => [a.by, a.answer, a.decider])).toEqual([
      ['Damien', 'no', true],
      ['Maya', 'yes', false],
    ])
    expect(r.pdf_eligible).toBe(false)
    expect(r.pdf_why).toBe(`Damien's latest answer is no: "insert too dark"`)
  })

  test("a grade with import_id reads the upload's row, the one the render was made from: the kit's row for the same cells", async () => {
    const w = await serviceWorld()
    setCmfServiceDeps(w.deps)
    const { outputId } = await render(w, actor(MAYA, 'web'), 'E')
    // Damien grades Maya's render naming only the upload: tab, column and key come from its record.
    const damien = actor(DAMIEN)
    const ready = await planGrade(damien, { import_id: IMPORT, output_id: outputId }, env)
    expect(ready.target).toMatchObject({ spec: 'experience-2-cc', column: 'E', key: KEY_ID, tab: 'Experience 2 CC', import_id: IMPORT })
    // The upload holds the committed cells, so THE ROW is the kit's, line for line; THE KEY is the
    // key as the kit has it now (this world's is marked confirmed for the test).
    expect(ready.parts.rows['experience-2-cc--E'].row_lines).toEqual(kitParts.rows['experience-2-cc--E'].row_lines)
    const keyBlock = ready.parts.keys[`experience-2-cc--E--${KEY_ID}`].key_lines
    expect(keyBlock).toEqual(keyLines(w.key, KEY_ID, gradingRow(E2CC, 'E', {})))
    expect(keyBlock[0]).toContain(`THE KEY: clown ${KEY_ID}, confirmed by test`)
    // With the kit's own key file, the prompt is the kit's conformance fixture, by sha256.
    const f = (conformance.products.cmf.grading_prompt.fixtures as Array<{ inputs: any; sha256: string }>).find(
      (x) => x.inputs.spec === 'experience-2-cc' && x.inputs.column === 'E' && x.inputs.key === KEY_ID
    )!
    const asKit = { ...ready.parts, keys: { [`experience-2-cc--E--${KEY_ID}`]: { key: KEY_ID, draft: false, key_lines: keyLines(FRONT, KEY_ID, gradingRow(E2CC, 'E', {})) } } }
    expect(sha(assembleCmfGradingPrompt(ready.cmf.product, asKit, f.inputs))).toBe(f.sha256)
    const x = await runGrade(damien, ready, env)
    expect(x.gradeId).not.toBeNull()
    const g = w.records.grades[0]
    expect(g).toMatchObject({ outputId, ownerId: DAMIEN, judge: 'vesper', product: 'cmf' })
    expect((g.references as any).cmf).toMatchObject({ import_id: IMPORT, column: 'E' })
    // The team sees the grade on the render.
    expect((await listCmf(actor(MAYA, 'web'), {}, env)).renders[0].grade).toMatchObject({ grade_id: x.gradeId, verdict: g.verdict, judge: 'vesper' })
  })

  test('a grade with import_id refuses another upload, another column, or cells the render was not made from', async () => {
    const w = await serviceWorld()
    setCmfServiceDeps(w.deps)
    const { outputId } = await render(w, actor(MAYA, 'web'), 'E')
    const other = '99999999-2222-4333-8444-555555555555'
    expect((await refusal(planGrade(actor(DAMIEN), { import_id: other, output_id: outputId }, env))).message).toContain(
      `output ${outputId} was rendered from upload ${IMPORT}, not ${other}`
    )
    expect((await refusal(planGrade(actor(DAMIEN), { import_id: IMPORT, output_id: outputId, column: 'D' }, env))).message).toContain('the column named (D) is not its own')
    // Its own tab, by slug, and its own column in lower case, are its own.
    expect((await planGrade(actor(DAMIEN), { import_id: IMPORT, output_id: outputId, tab: 'experience-2-cc', column: 'e' }, env)).target.column).toBe('E')
    // The upload's row now differs from the cells the render recorded.
    const gen = w.team.generations[0]
    const recorded = clone((gen.parameters.creative as any).workbook.sku_spec)
    recorded.components[2].fields[1].value = 'Pantone 000C'
    ;(gen.parameters.creative as any).workbook.sku_spec = recorded
    const err = await refusal(planGrade(actor(DAMIEN), { import_id: IMPORT, output_id: outputId }, env))
    expect(err).toBeInstanceOf(CmfError)
    expect(err.message).toContain(`was rendered from cells that are not upload ${IMPORT}'s row now`)
    expect(err.message).toContain('rendered from "Pantone 000C"')
    // A picture that records nothing needs the tab, column and key named.
    expect((await refusal(planGrade(actor(DAMIEN), { import_id: IMPORT, image_url: 'https://example.com/a.png' }, env))).message).toContain('name the tab, the column and the clown key')
  })

  test("cmf_pdf takes any of the team's renders, from either door, and every PDF it saves gets a row the listing shows", async () => {
    const w = await serviceWorld({ confirmedKey: true })
    setCmfServiceDeps(w.deps)
    const d = await render(w, actor(DAMIEN), 'D')
    const e = await render(w, actor(MAYA, 'web'), 'E')
    // Before Damien's yes the listing says why neither can go on a PDF.
    const before = await listCmf(actor(MAYA, 'web'), {}, env)
    expect(before.renders.map((r) => r.pdf_why)).toEqual(['no answer from Damien yet', 'no answer from Damien yet'])
    await answer(w, actor(DAMIEN), d.outputId, 'yes')
    await answer(w, actor(DAMIEN, 'web'), e.outputId, 'yes')
    expect((await listCmf(actor(MAYA, 'web'), {}, env)).renders.map((r) => [r.pdf_eligible, r.pdf_why])).toEqual([
      [true, null],
      [true, null],
    ])
    // Maya makes the PDF from the web, of Damien's render and her own.
    const got = await supplierPdf(actor(MAYA, 'web'), { import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['D', 'E'], output_ids: [d.outputId, e.outputId] }, env)
    expect(got.saved).toBe(true)
    if (!got.saved) return
    expect(got.result.renders.map((r) => [r.column, r.output_id, r.decided_by])).toEqual([
      ['D', d.outputId, 'Damien'],
      ['E', e.outputId, 'Damien'],
    ])
    expect('id' in got.listed).toBe(true)
    expect(w.team.pdfs).toHaveLength(1)
    const row = w.team.pdfs[0]
    expect(row).toMatchObject({
      storagePath: got.result.path,
      url: got.result.url,
      importId: IMPORT,
      tab: 'Experience 2 CC',
      skuColumns: ['D', 'E'],
      outputIds: [d.outputId, e.outputId],
      keyId: KEY_ID,
      keySha256: w.cmf.keys[KEY_ID].sha256,
      check: { clean: true, cells_compared: got.result.cells_compared, rows_compared: got.result.rows_compared },
      madeBy: MAYA,
      credentialId: null,
      door: 'web',
    })
    // Damien sees it in Claude.
    const listed = await listCmf(actor(DAMIEN), {}, env)
    expect(listed.supplier_pdfs).toEqual([
      expect.objectContaining({ supplier_pdf_id: row.id, file: got.result.file_name, columns: ['D', 'E'], import_id: IMPORT, made_by: 'Maya', door: 'web' }),
    ])
  })

  test('a PDF whose row cannot be written is still saved, and says so', async () => {
    const w = await serviceWorld({ confirmedKey: true })
    setCmfServiceDeps({ ...w.deps, team: Object.assign(w.team, { insertSupplierPdf: async () => Promise.reject(new Error('relation "cmf_supplier_pdfs" does not exist')) }) })
    const d = await render(w, actor(DAMIEN), 'D')
    await answer(w, actor(DAMIEN), d.outputId, 'yes')
    const got = await supplierPdf(actor(DAMIEN), { import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['D'], output_ids: [d.outputId] }, env)
    expect(got.saved).toBe(true)
    if (got.saved) expect(got.listed).toEqual({ error: 'relation "cmf_supplier_pdfs" does not exist' })
    expect(w.savedPdfs).toHaveLength(1)
  })

  test('an attempt the web CMF Studio made the old way is never listed, and cmf_pdf refuses it', async () => {
    const w = await serviceWorld({ confirmedKey: true })
    setCmfServiceDeps(w.deps)
    const d = await render(w, actor(DAMIEN), 'D')
    await answer(w, actor(DAMIEN), d.outputId, 'yes')
    const listed = await listCmf(actor(MAYA, 'web'), {}, env)
    expect(listed.renders.map((r) => r.output_id)).toEqual([d.outputId])
    expect(listed.renders.some((r) => r.output_id === WEB_ATTEMPT)).toBe(false)
    const err = await refusal(supplierPdf(actor(MAYA, 'web'), { import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['D', 'E'], output_ids: [d.outputId, WEB_ATTEMPT] }, env))
    expect(err.message).toContain(`'${WEB_ATTEMPT}' is a web CMF Studio attempt`)
  })

  test('the listing says when the team records cannot be read, and lists the rest', async () => {
    const w = await serviceWorld()
    setCmfServiceDeps({ ...w.deps, team: Object.assign(w.team, { recentSupplierPdfs: async () => Promise.reject(new Error('relation "cmf_supplier_pdfs" does not exist')) }) })
    const got = await listCmf(actor(DAMIEN), {}, env)
    expect(got.tabs.length).toBeGreaterThan(0)
    expect(got.supplier_pdfs).toEqual([])
    expect(got.problems).toEqual(['the supplier PDFs could not be read (relation "cmf_supplier_pdfs" does not exist)'])
  })
})

test.describe('the CMF records the other tools read', () => {
  test('the manifest export serves a cmf_render line, from either door, beside the product draws', () => {
    expect(MANIFEST_TOOLS).toEqual(['generate_product_image', 'cmf_render'])
    const at = new Date('2026-09-30T09:00:00Z')
    const manifest = [{ file: 'x', source: 'vesper', tab: 'Experience 2 CC' }]
    const cmfRow = { id: 'g1', createdAt: at, parameters: { toolName: 'cmf_render', source: 'web', creative: { product: 'cmf' }, manifest } }
    expect(manifestRow(cmfRow)).toEqual({ generation_id: 'g1', created_at: at, product: 'cmf', manifest })
    expect(manifestRow(cmfRow, 'cmf')).not.toBeNull()
    expect(manifestRow(cmfRow, 'eclipse')).toBeNull()
    expect(manifestRow({ id: 'g2', createdAt: at, parameters: { toolName: 'generate_product_image', creative: { product: 'eclipse' }, manifest } })).toMatchObject({ product: 'eclipse' })
    expect(manifestRow({ id: 'g3', createdAt: at, parameters: { toolName: 'generate_asset', manifest } })).toBeNull()
  })

  test("the data move takes the Claude project's CMF renders, and nothing else", () => {
    const cmfParams = { toolName: 'cmf_render', source: 'mcp', creative: { product: 'cmf', tab: 'Experience 2 CC', key: KEY_ID } }
    expect(isCmfRender(cmfParams)).toBe(true)
    expect(namesCmfTabOrKey(cmfParams)).toBe(true)
    expect(namesCmfTabOrKey({ toolName: 'generate_product_image', creative: { product: 'eclipse', colourway: 'mint' } })).toBe(false)
    expect(namesCmfTabOrKey({ toolName: 'cmf_render', creative: { product: 'cmf' } })).toBe(false)
    expect(namesCmfTabOrKey({ toolName: 'generate_asset' })).toBe(false)
    const row = (id: string, parameters: unknown, projectId: string, key: string | null): MoveCandidate => ({ generationId: id, userId: 'u', parameters, sessionId: `s-${projectId}`, projectId, projectSystemKey: key })
    const plan = planCmfMove(
      [
        row('a', cmfParams, 'claude-of-damien', 'claude'),
        row('b', cmfParams, 'team', 'cmf'),
        row('c', cmfParams, 'a-project-of-hers', null),
        row('d', { toolName: 'generate_asset' }, 'claude-of-damien', 'claude'),
      ],
      'team'
    )
    expect(plan.move.map((m) => m.generationId)).toEqual(['a'])
    expect(plan.leave).toEqual([{ generationId: 'c', why: 'in project a-project-of-hers, not a "Claude" project: moved by hand, left there' }])
  })
})
