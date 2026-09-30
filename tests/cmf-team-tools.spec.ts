/**
 * The CMF team's records as Claude reads them, through the tools and their injected reach: a render
 * made in the web shows in cmf_list, a render from Claude says where it was saved, and a supplier
 * PDF says it is listed.
 */

import { test, expect } from '@playwright/test'
import { planRender, recordCmfVerdict, runRender, setCmfServiceDeps } from '../src/lib/creative/cmf/service'
import { cmfListHandler, cmfPdfHandler, cmfRenderHandler } from '../src/lib/headless/tools/cmf'
import type { ToolContext } from '../src/lib/headless/tools/types'
import { IMPORT, KEY_ID, ctx as baseCtx } from './helpers/cmf-upload'
import { actor, DAMIEN, MAYA, serviceWorld } from './helpers/cmf-service-world'

const env = {} as unknown as NodeJS.ProcessEnv

function ctx(ownerId: string): ToolContext {
  const c = baseCtx()
  return { ...c, principal: { ...c.principal, ownerId, credentialId: `cred-${ownerId.slice(-4)}` } }
}

test.describe('the CMF team through the Claude tools', () => {
  test.afterEach(() => setCmfServiceDeps(null))

  test("cmf_list shows a render made in the web, with the decider's answer and whether it can go on a supplier PDF", async () => {
    const w = await serviceWorld({ confirmedKey: true })
    setCmfServiceDeps(w.deps)
    const maya = actor(MAYA, 'web')
    const ready = await planRender(maya, { import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'E', clown: KEY_ID }, env)
    const x = await runRender(maya, ready, { jobId: null }, env)
    const outputId = x.outputs[0].outputId!
    await recordCmfVerdict(actor(DAMIEN, 'web'), { output_id: outputId, answer: 'yes', remark: '', decoded: [], decoded_unconfirmed: [] }, env)

    const res = await cmfListHandler.run({}, ctx(DAMIEN))
    const text = (res.content[0] as { text: string }).text
    expect(text).toContain("The team's newest CMF renders, from Claude and the CMF Studio")
    expect(text).toContain(`- ${outputId}: Experience 2 CC column E (Ice blu classic matte) through ${KEY_ID}; the CMF Studio, Maya,`)
    expect(text).toContain('no grade; Damien said yes; can go on a supplier PDF.')
    const s = res.structuredContent as { renders: Array<Record<string, unknown>>; supplier_pdfs: unknown[] }
    expect(s.renders).toHaveLength(1)
    expect(s.renders[0]).toMatchObject({ output_id: outputId, door: 'web', made_by: 'Maya', pdf_eligible: true })
  })

  test("cmf_render says the render is in the team's project; cmf_pdf says the PDF is listed", async () => {
    const w = await serviceWorld({ confirmedKey: true })
    setCmfServiceDeps(w.deps)
    const res = await cmfRenderHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'D', clown: KEY_ID }, ctx(DAMIEN))
    const summary = res.content.map((c) => (c as { text?: string }).text ?? '').join('\n')
    expect(summary).toContain("Saved in Vesper in the CMF team's project, which everyone with CMF access sees, in Claude and in the CMF Studio.")
    const outputId = (res.structuredContent as { outputs: Array<{ outputId: string }> }).outputs[0].outputId
    expect(w.team.projectOf(w.team.generations[0].id)!.systemKey).toBe('cmf')
    await recordCmfVerdict(actor(DAMIEN), { output_id: outputId, answer: 'yes', remark: '', decoded: [], decoded_unconfirmed: [] }, env)

    const pdf = await cmfPdfHandler.run({ import_id: IMPORT, tab: 'Experience 2 CC', sku_columns: ['D'], output_ids: [outputId] }, ctx(MAYA))
    const text = (pdf.content[0] as { text: string }).text
    expect(text).toContain('Listed for the CMF team: cmf_list and the CMF Studio show it.')
    expect((pdf.structuredContent as { supplier_pdf_id: string }).supplier_pdf_id).toBe(w.team.pdfs[0].id)
    expect(w.team.pdfs[0]).toMatchObject({ madeBy: MAYA, door: 'mcp', outputIds: [outputId] })
    const listed = (await cmfListHandler.run({}, ctx(DAMIEN))).content[0] as { text: string }
    expect(listed.text).toContain(`Supplier PDFs made (newest first): ${w.team.pdfs[0].fileName} (Experience 2 CC D, upload ${IMPORT}, Claude, Maya,`)
  })
})
