/**
 * CMF files through Claude, from the sheet row and the clown: `cmf_list`, `cmf_prompt`,
 * `cmf_render`, `cmf_check_pdf`, `cmf_pdf`. The judgement stays with Damien, the lead CMF designer; the data is
 * code's (Damien's brief: "Use AI for judgement, use code for data").
 *
 *   cmf_list       tabs, SKUs, clown keys, which tab × column × key has a prompt ready, and the
 *                  newest workbook uploads
 *   cmf_prompt     the payload the repository's `prompt_build.py` wrote, verbatim, or its refusal;
 *                  or, given an upload (`import_id`, `tab`, `sku_column`), the same template filled
 *                  by code from that upload's cells (`prompt-fill.ts`)
 *   cmf_render     that payload sent the way `render.py` sends it, after the same refusals; from an
 *                  upload, the manifest line records the import, the workbook's sha256 and the
 *                  SKU's cells as parsed
 *   cmf_check_pdf  every value on a CMF PDF against its sheet cell (`spec_diff.py`'s rows)
 *   cmf_pdf        the supplier PDF, built by code from one upload and Damien's approved renders,
 *                  read back and checked before it is saved (`supplier-pdf-run.ts`)
 *
 * Supplier PDFs come from cmf_pdf, or the same step in the CMF Studio's PDF tab; the Studio's old
 * packet export is retired.
 *
 * Every render, grade, answer and supplier PDF is the CMF team's: renders are saved in the team
 * project (`team-records.ts`), cmf_list shows the team's newest renders and PDFs from either door,
 * grade_image and cmf_pdf take any of the team's renders, and an answer on one needs CMF access.
 *
 * Every step is the CMF service's (`src/lib/creative/cmf/service.ts`), the one the web CMF Studio
 * calls too; this file is Claude's door onto it: it parses the arguments, runs a long call as a
 * job, and writes the answer Claude reads. All of them need CMF access (the profile's
 * `cmf_access`, or an admin): the registry gates them (`needs: 'cmf'`) and the service checks
 * again, because a static token carries its tool list as issued. The product kit (Loop AI Product
 * Design, `tensalir/loop-ai-product`) supplies everything; Vesper holds no CMF wording or rule
 * of its own, and reads CMF from no other kit.
 */

import type { z } from 'zod'
import { reportsOnly } from '@/lib/creative/kit-schema'
import { kitHeader } from '@/lib/creative/tool-views'
import { payloadId } from '@/lib/creative/cmf/kit-cmf'
import { drawPriceUsd } from '@/lib/creative/work-runtime'
import { specCheckText } from '@/lib/creative/cmf/check-pdf'
import type { PromptRefusal } from '@/lib/creative/cmf/prompt-fill'
import type { WorkbookPayload } from '@/lib/creative/cmf/workbook-payload'
import {
  checkPdf,
  cmfPrompt,
  listCmf,
  planRender,
  runCheckPdf,
  runRender,
  supplierPdf,
  identifiersOnly,
  productionCmfServiceDeps,
  setCmfServiceDeps,
  type CmfActor,
  type CmfListedPdf,
  type CmfRenderExecution,
  type CmfTeamRender,
  type CmfServiceDeps,
  type CmfUploadTarget,
  type CmfWorkbookBuilt,
  type LoadedKit,
} from '@/lib/creative/cmf/service'
import {
  CmfCheckPdfArgs,
  CmfListArgs,
  CmfPdfArgs,
  CmfPromptArgs,
  CmfRenderArgs,
  CmfWorkbookPromptArgs,
  CmfWorkbookRenderArgs,
  PDF_KEYS,
  WORKBOOK_RENDER_KEYS,
  WORKBOOK_TARGET_KEYS,
} from '@/lib/creative/cmf/args'
import { imageResultContent } from '../generate-asset'
import type { JobPayload } from '../jobs'
import { runLongCall } from './long-call'
import { invalidArguments, type ToolContext, type ToolHandler } from './types'

export { CmfAccessError, assertCmfAccess, cmfGradingParts, cmfRenderCreative, identifiersOnly } from '@/lib/creative/cmf/service'
// The arguments are both doors' (`src/lib/creative/cmf/args.ts`); re-exported under the names the tests know.
export { CmfCheckPdfArgs, CmfListArgs, CmfPdfArgs, CmfPromptArgs, CmfRenderArgs, CmfTargetArgs, CmfWorkbookPromptArgs, CmfWorkbookRenderArgs, CmfWorkbookTargetArgs } from '@/lib/creative/cmf/args'

// ------------------------------------------------------------------ what the handlers reach

/** What the tools reach is the CMF service's; the names are kept for the tests and the other tools. */
export type CmfToolDeps = CmfServiceDeps
export const productionCmfDeps: CmfToolDeps = productionCmfServiceDeps

/** Tests swap the handlers' reach for fixtures. */
export function setCmfToolDeps(next: Partial<CmfToolDeps> | null): void {
  setCmfServiceDeps(next)
}

/** The person behind a Claude call, as the CMF service knows them: the credential's owner. */
export function mcpActor(ctx: ToolContext): CmfActor {
  return {
    profileId: ctx.principal.ownerId,
    email: null,
    role: ctx.principal.ownerRole ?? null,
    door: 'mcp',
    credentialId: ctx.principal.credentialId,
    allowedModels: ctx.principal.allowedModels,
  }
}

function workbookLine(p: WorkbookPayload): string {
  const w = p.workbook
  return `From upload ${w.import_id} (${w.file}, sha256 ${w.sha256.slice(0, 12)}, modified ${w.modified ?? 'unknown'}), ${w.tab} column ${w.column}; the SKU's cells sha256 ${w.sku_spec_sha256.slice(0, 12)}.`
}

// ------------------------------------------------------------------ cmf_list

const DOOR_NAME: Record<string, string> = { mcp: 'Claude', web: 'the CMF Studio' }
const day = (iso: string) => iso.slice(0, 16).replace('T', ' ')

/** The team's newest renders and supplier PDFs, one line each. */
function teamLines(renders: CmfTeamRender[], pdfs: CmfListedPdf[], problems: string[]): string[] {
  const lines: string[] = []
  if (renders.length) {
    lines.push("The team's newest CMF renders, from Claude and the CMF Studio (name one as output_id for grade_image, record_verdict and cmf_pdf):")
    for (const r of renders) {
      const what = `${r.tab ?? '?'} column ${r.column ?? '?'}${r.sku_name ? ` (${r.sku_name})` : ''} through ${r.key ?? '?'}`
      const who = `${r.door ? DOOR_NAME[r.door] : 'an unknown door'}${r.made_by ? `, ${r.made_by}` : ''}, ${day(r.made_at)}`
      const grade = r.grade ? `grade ${r.grade.verdict} (${r.grade.judge === 'vesper' ? 'Vesper' : 'Claude'} x${r.grade.reads})` : 'no grade'
      const answer = r.decider_answer ? `${r.decider_answer.by} said ${r.decider_answer.answer}` : 'no answer from the decider'
      const pdf = r.pdf_eligible ? 'can go on a supplier PDF' : `not for a supplier PDF: ${r.pdf_why}`
      lines.push(`- ${r.output_id}: ${what}; ${who}; ${grade}; ${answer}; ${pdf}.`)
    }
  } else {
    lines.push('No CMF render is in the team project yet.')
  }
  if (pdfs.length) {
    lines.push(
      `Supplier PDFs made (newest first): ${pdfs.map((x) => `${x.file} (${x.tab} ${x.columns.join(', ')}, upload ${x.import_id}, ${DOOR_NAME[x.door] ?? x.door}${x.made_by ? `, ${x.made_by}` : ''}, ${day(x.made_at)}) ${x.url}`).join('; ')}.`
    )
  }
  for (const p of problems) lines.push(`Not listed: ${p}.`)
  return lines
}

export const cmfListHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = CmfListArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const { loaded, cmf, tabs, uploads, renders, supplier_pdfs, problems } = await listCmf(mcpActor(ctx), parsed.data, ctx.env)
    const lines: string[] = [
      `CMF in ${loaded.kit.tag}: rubric ${cmf.product.rubric.version ?? '?'}${reportsOnly(cmf.product.rubric) ? ' (no check blocks yet)' : ''}. Damien decides every render and every PDF.`,
    ]
    for (const t of tabs) {
      const { skus, keys, payloads } = t
      const ready = payloads.filter((p) => p.status === 'ready')
      lines.push(
        `- ${t.tab} (${t.slug}): in scope ${skus.filter((s) => s.in_scope).map((s) => `${s.column}${s.name ? ` ${s.name}` : ''}`).join(', ') || 'none'}; ` +
          `keys ${keys.map((k) => `${k.id}${k.draft ? ' (draft)' : k.confirmed ? ' (confirmed)' : ' (named, not confirmed)'}`).join(', ') || 'none'}; ` +
          `prompts ready ${ready.map((p) => `${p.column} through ${p.key}`).join(', ') || 'none'}` +
          (payloads.some((p) => p.status !== 'ready') ? `; refused ${payloads.filter((p) => p.status !== 'ready').map((p) => `${p.column} (${p.reasons[0] ?? 'refused'})`).join('; ')}` : '')
      )
    }
    lines.push('A draft key cannot make a prompt: Damien names its zones first. cmf_prompt shows a ready prompt; cmf_render draws it.')
    if (uploads.length) {
      lines.push(
        `Newest workbook uploads (name one as import_id to build the prompt and the supplier PDF from its cells): ${uploads.map((u) => `${u.import_id} ${u.file} (${u.uploaded_at.slice(0, 16).replace('T', ' ')})`).join('; ')}.`
      )
    }
    lines.push(...teamLines(renders, supplier_pdfs, problems))
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { ...kitHeader(loaded), tabs, uploads, renders, supplier_pdfs, ...(problems.length ? { problems } : {}) } }
  },
}

// ------------------------------------------------------------------ cmf_prompt

function workbookPromptResult(loaded: LoadedKit, built: CmfWorkbookBuilt) {
  const payload = built.payload
  const table = [
    '| # | Zone | Component | Material | Finish | Colour | Code |',
    '|---|---|---|---|---|---|---|',
    ...payload.lines.map((l) => `| ${l.n} | ${l.zone_hex} | ${l.component} | ${l.material} | ${l.finish} | ${l.colour_name} | ${l.colour_code} |`),
  ]
  const text = [
    `Damien's template, filled by code from the uploaded workbook's cells, ${payload.tab} column ${payload.column}${payload.sku_name ? ` (${payload.sku_name})` : ''}, through the clown key ${payload.key.id}${payload.key_confirmed ? '' : ' (named, not yet confirmed by Damien)'}. Send it exactly as it is:`,
    '',
    payload.prompt,
    '',
    ...table,
    ...(payload.omitted.length ? ['', `Left out: ${payload.omitted.map((o) => `${o.component} (${o.why})`).join('; ')}.`] : []),
    ...(payload.warnings.length ? ['', ...payload.warnings.map((w) => `Warning: ${w}`)] : []),
    '',
    workbookLine(payload),
    `prompt sha256 ${payload.prompt_sha256.slice(0, 12)}; template ${payload.template_sha256.slice(0, 12)}; clown ${payload.clown.id} ${payload.clown.sha256.slice(0, 12)}, ${payload.clown.aspect ?? '?'}. The clown is the only image. cmf_render with the same import_id, tab, sku_column and clown draws it.`,
  ].join('\n')
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: {
      ...kitHeader(loaded),
      refused: false,
      payload_id: built.payloadId,
      tab: payload.tab,
      column: payload.column,
      sku_name: payload.sku_name ?? null,
      key: payload.key,
      key_confirmed: payload.key_confirmed,
      clown: payload.clown,
      prompt: payload.prompt,
      prompt_sha256: payload.prompt_sha256,
      template_sha256: payload.template_sha256,
      lines: payload.lines,
      omitted: payload.omitted,
      warnings: payload.warnings,
      workbook: {
        import_id: payload.workbook.import_id,
        file: payload.workbook.file,
        sha256: payload.workbook.sha256,
        modified: payload.workbook.modified,
        modified_source: payload.workbook.modified_source,
        imported_at: payload.workbook.imported_at,
        sku_spec_sha256: payload.workbook.sku_spec_sha256,
      },
    },
  }
}

function promptRefusalResult(loaded: LoadedKit, a: CmfUploadTarget, err: PromptRefusal) {
  return {
    content: [
      {
        type: 'text' as const,
        text: [`No prompt for ${a.tab} column ${a.sku_column.toUpperCase()} of upload ${a.import_id} through ${a.clown}: the fill refused it.`, ...err.reasons.map((r) => `- ${r}`), 'Nothing is sent until the row or the key is fixed.'].join('\n'),
      },
    ],
    structuredContent: { ...kitHeader(loaded), refused: true, import_id: a.import_id, tab: a.tab, column: a.sku_column.toUpperCase(), key: a.clown, reasons: err.reasons },
  }
}

export const cmfPromptHandler: ToolHandler = {
  async run(args, ctx) {
    if (args && typeof args === 'object' && 'import_id' in args) {
      identifiersOnly('cmf_prompt', args, WORKBOOK_TARGET_KEYS)
      const w = CmfWorkbookPromptArgs.safeParse(args)
      if (!w.success) throw invalidArguments(w.error.issues)
      const got = await cmfPrompt(mcpActor(ctx), w.data, ctx.env)
      if (got.source !== 'upload') throw new Error('unreachable: an upload target answered from the kit')
      if ('refused' in got) return promptRefusalResult(got.loaded, got.target, got.refused)
      return workbookPromptResult(got.loaded, got.built)
    }
    const parsed = CmfPromptArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const got = await cmfPrompt(mcpActor(ctx), parsed.data, ctx.env)
    if (got.source !== 'kit') throw new Error('unreachable: a kit target answered from an upload')
    const { entry, payload } = got
    const header = kitHeader(got.loaded)
    if (!payload) {
      const reasons = entry.reasons ?? []
      return {
        content: [
          {
            type: 'text',
            text: [`No prompt for ${entry.tab} column ${entry.column} through ${entry.key}: prompt_build.py refused it.`, ...reasons.map((r) => `- ${r}`), 'Nothing is sent until the row or the key is fixed.'].join('\n'),
          },
        ],
        structuredContent: { ...header, refused: true, tab: entry.tab, column: entry.column, key: entry.key, reasons },
      }
    }
    const lines = (payload.lines ?? []) as Array<Record<string, unknown>>
    const table = [
      '| # | Zone | Component | Material | Finish | Colour | Code |',
      '|---|---|---|---|---|---|---|',
      ...lines.map((l) => `| ${l.n ?? ''} | ${l.zone_hex ?? ''} | ${l.component ?? ''} | ${l.material ?? ''} | ${l.finish ?? ''} | ${l.colour_name ?? ''} | ${l.colour_code ?? ''} |`),
    ]
    const text = [
      `Damien's template, filled by code from ${payload.tab} column ${payload.column}${payload.sku_name ? ` (${payload.sku_name})` : ''} through the clown key ${payload.key.id}${payload.key_confirmed ? '' : ' (named, not yet confirmed by Damien)'}. Send it exactly as it is:`,
      '',
      payload.prompt,
      '',
      ...table,
      ...(payload.omitted?.length ? ['', `Left out: ${payload.omitted.map((o) => `${o.component} (${o.why})`).join('; ')}.`] : []),
      ...(payload.warnings?.length ? ['', ...payload.warnings.map((w) => `Warning: ${w}`)] : []),
      '',
      `prompt sha256 ${payload.prompt_sha256.slice(0, 12)}; template ${payload.template_sha256.slice(0, 12)}; clown ${payload.clown.id} ${payload.clown.sha256.slice(0, 12)}, ${payload.clown.aspect ?? '?'}. The clown is the only image. cmf_render draws it.`,
    ].join('\n')
    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: {
        ...header,
        refused: false,
        payload_id: payloadId(entry.spec, entry.column, entry.key),
        tab: payload.tab,
        column: payload.column,
        sku_name: payload.sku_name ?? null,
        key: payload.key,
        key_confirmed: payload.key_confirmed === true,
        clown: payload.clown,
        prompt: payload.prompt,
        prompt_sha256: payload.prompt_sha256,
        template_sha256: payload.template_sha256,
        lines: payload.lines ?? [],
        omitted: payload.omitted ?? [],
        warnings: payload.warnings ?? [],
      },
    }
  },
}

// ------------------------------------------------------------------ cmf_render

function renderSummary(x: CmfRenderExecution): string {
  const p = x.plan
  const lines = [
    `Rendered ${x.outputs.length} CMF image${x.outputs.length === 1 ? '' : 's'}: ${p.tab} column ${p.column}${p.skuName ? ` (${p.skuName})` : ''}, through ${p.key}${p.keyConfirmed ? '' : ' (key named, not confirmed)'}, ${p.model} (${p.lane}), ${p.aspect} at ${p.imageSize}.`,
    `The clown ${p.clown.id} was the only image; the prompt was the payload's, byte for byte (sha256 ${p.promptSha256.slice(0, 12)}), no rewrite, no lighting clause.`,
  ]
  if (p.workbook) {
    lines.push(
      `Built from upload ${p.workbook.import_id} (${p.workbook.file}, sha256 ${p.workbook.sha256.slice(0, 12)}); the render records the SKU's cells (sha256 ${p.workbook.sku_spec_sha256.slice(0, 12)}), so cmf_pdf can hold it to the workbook.`
    )
  }
  if (x.failures.length) lines.push(`Not rendered: ${x.failures.join('; ')}.`)
  lines.push(x.recorded ? `Saved in Vesper in the CMF team's project, which everyone with CMF access sees, in Claude and in the CMF Studio.` : `Not recorded in Vesper's web app (${x.recordError ?? 'unknown'}); the files are safe at the links.`)
  lines.push('Next: grade each render with grade_image (product cmf, the same tab, column and clown). Damien decides.')
  x.outputs.forEach((o, i) => lines.push(`${i + 1}. output ${o.outputId ?? '(not recorded)'}: ${o.url}`))
  return lines.join('\n')
}

function renderStructured(x: CmfRenderExecution): Record<string, unknown> {
  const p = x.plan
  return {
    ...x.header,
    product: 'cmf',
    payload_id: p.payloadId,
    tab: p.tab,
    column: p.column,
    sku_name: p.skuName,
    key: p.key,
    key_confirmed: p.keyConfirmed,
    clown: p.clown,
    lane: p.lane,
    model: p.model,
    modelId: p.model,
    prompt: p.prompt,
    prompt_sha256: p.promptSha256,
    aspect: p.aspect,
    image_size: p.imageSize,
    ...(p.workbook
      ? { workbook: { import_id: p.workbook.import_id, file: p.workbook.file, sha256: p.workbook.sha256, modified: p.workbook.modified, sku_spec_sha256: p.workbook.sku_spec_sha256 } }
      : {}),
    generationId: x.generationId,
    outputs: x.outputs,
    manifest: x.manifest,
    failures: x.failures,
    estimatedCostUsd: x.costUsd,
    next: 'grade_image',
  }
}

function renderPayload(x: CmfRenderExecution): JobPayload {
  return {
    summary: renderSummary(x),
    structuredContent: renderStructured(x),
    outputIds: x.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string'),
    costUsd: x.costUsd,
  }
}

/** A planned render, run as a long call: inline when it finishes in time, else as a job. */
async function runPlannedRender(ctx: ToolContext, request: Record<string, unknown> & { async: boolean }, target: Parameters<typeof planRender>[1]) {
  const actor = mcpActor(ctx)
  const ready = await planRender(actor, target, ctx.env)
  const plan = ready.plan
  return runLongCall<CmfRenderExecution>({
    ctx,
    toolName: 'cmf_render',
    modelId: plan.model,
    request: { ...request },
    runAsync: request.async,
    what: `the ${plan.tab} ${plan.column} render`,
    execute: (jobId) => runRender(actor, ready, { jobId }, ctx.env),
    toPayload: renderPayload,
    toWire: async (x) => ({
      content: await imageResultContent({ summary: renderSummary(x), outputs: x.outputs, modelId: x.plan.model, previewSources: x.previewSources, inline: true }),
      structuredContent: renderStructured(x),
    }),
  })
}

export const cmfRenderHandler: ToolHandler = {
  estimateCostUsd(args) {
    const n = typeof args.n === 'number' ? args.n : 1
    const model = args.lane === 'draft' ? 'gemini-3.1-flash-image' : 'gemini-3-pro-image'
    return (drawPriceUsd(model, typeof args.image_size === 'string' ? args.image_size : '2K') ?? 0.134) * Math.max(1, n)
  },
  async run(args, ctx) {
    if (args && typeof args === 'object' && 'import_id' in args) {
      // From a workbook upload: the payload built by code, then the same refusals and the same draw.
      identifiersOnly('cmf_render', args, WORKBOOK_RENDER_KEYS)
      const parsed = CmfWorkbookRenderArgs.safeParse(args)
      if (!parsed.success) throw invalidArguments(parsed.error.issues)
      return runPlannedRender(ctx, parsed.data, parsed.data)
    }
    const parsed = CmfRenderArgs.safeParse(args)
    if (!parsed.success) {
      const extra = Object.keys(args).filter((k) => /^(reference|references|image|images|image_url|output_id|prompt)$/i.test(k))
      if (extra.length) throw new Error(`cmf_render takes no ${extra.join(', ')}: the clown is the only image and the prompt is the payload's, byte for byte.`)
      throw invalidArguments(parsed.error.issues)
    }
    return runPlannedRender(ctx, parsed.data, parsed.data)
  },
}

// ------------------------------------------------------------------ cmf_check_pdf

/** The check itself, without the gate: the service's. */
export async function runCmfCheckPdf(ctx: ToolContext, a: z.infer<typeof CmfCheckPdfArgs>) {
  return runCheckPdf(mcpActor(ctx), a, ctx.env)
}

export const cmfCheckPdfHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = CmfCheckPdfArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const { loaded, result } = await checkPdf(mcpActor(ctx), parsed.data, ctx.env)
    return {
      content: [{ type: 'text', text: specCheckText(result) }],
      structuredContent: { ...kitHeader(loaded), ...result, rows: result.rows },
    }
  },
}

// ------------------------------------------------------------------ cmf_pdf


export const cmfPdfHandler: ToolHandler = {
  async run(args, ctx) {
    identifiersOnly('cmf_pdf', args, PDF_KEYS)
    const parsed = CmfPdfArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const got = await supplierPdf(mcpActor(ctx), parsed.data, ctx.env)
    if (!got.saved) {
      const err = got.refused
      return {
        isError: true,
        content: [{ type: 'text' as const, text: err.message }],
        structuredContent: {
          ...kitHeader(got.loaded),
          saved: false,
          counts: err.check.counts,
          rows: err.check.rows.filter((x) => x.state !== 'match'),
        },
      }
    }
    const r = got.result
    const text = [
      `The supplier PDF is saved: ${r.file_name}`,
      r.url,
      `${r.tab}, ${r.columns.map((c) => `${c}${r.sku_names[c] ? ` (${r.sku_names[c]})` : ''}`).join(', ')}: one page per SKU, then one part-breakdown page. Read back and checked before it was saved: ${r.cells_compared} cell(s) and every other printed value, all equal to the workbook's cells.`,
      `Workbook: ${r.workbook.file}, sha256 ${String(r.workbook.sha256).slice(0, 12)}, modified ${r.workbook.modified} (${r.workbook.modified_source}). Upload ${r.import_id}.`,
      `Legend from the clown key ${r.key.id}, confirmed by ${r.key.confirmed_by}: ${r.legend.join(', ')}.`,
      ...r.renders.map((x) => `- ${x.column}: render ${x.output_id}, answered yes by ${x.decided_by} on ${x.decided_at.slice(0, 10)}`),
      'id' in got.listed ? "Listed for the CMF team: cmf_list and the CMF Studio show it." : `Not listed for the CMF team (${got.listed.error}); the PDF is safe at the link.`,
    ].join('\n')
    return {
      content: [{ type: 'text', text }],
      structuredContent: { ...kitHeader(got.loaded), saved: true, ...r, supplier_pdf_id: 'id' in got.listed ? got.listed.id : null },
    }
  },
}
