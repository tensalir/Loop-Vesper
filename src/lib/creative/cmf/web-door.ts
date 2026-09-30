/**
 * The web CMF Studio's door onto the CMF service (`service.ts`): what `src/app/api/cmf/v2/*` answers.
 * Claude's door is `src/lib/headless/tools/cmf.ts`; both parse their arguments with `args.ts` and
 * call the same service functions, so a CMF step is changed in the service or nowhere.
 *
 * Why it is here (2026-09-30): the web CMF Studio ran its own prompt, model adapter, approvals and
 * PDF, and drifted from what Claude does. The owner ruled that the headless engine is the
 * behaviour, in both doors. Each handler here: builds the actor from the signed-in person (door
 * `web`, no credential, every model), parses the body, calls one service function, and answers
 * JSON. A refusal is the service's own message, word for word what Claude is told, with a status:
 * 403 no CMF access, 400 arguments, 422 a refusal of the step, 429 the daily allowance.
 *
 * What a door adds and Claude's does not: the render runs as a job the page polls (`web-jobs.ts`),
 * because a page cannot wait ~280 s on one request, and a grade waits in the request. Spend is one
 * allowance per person across both doors (`src/lib/headless/claude-allowance.ts`, `door: 'web'`).
 *
 * `tests/cmf-parity.spec.ts` holds every handler to the matching Claude tool's answer, and
 * `tests/cmf-import-lint.spec.ts` holds this file, the routes, the components and the hook away
 * from the web's retired CMF modules and the model adapter.
 */

import { z } from 'zod'
import { waitUntil as vercelWaitUntil } from '@vercel/functions'
import { kitHeader } from '@/lib/creative/tool-views'
import { payloadId as kitPayloadId, CmfError, cmfKit } from './kit-cmf'
import { PromptRefusal } from './prompt-fill'
import { CmfPdfRefused, deciderEmails } from './supplier-pdf-run'
import {
  CmfCheckPdfArgs,
  CmfGradeArgs,
  CmfListArgs,
  CmfPdfArgs,
  CmfPromptArgs,
  CmfRenderArgs,
  CmfVerdictArgs,
  CmfWorkbookPromptArgs,
  CmfWorkbookRenderArgs,
  PDF_KEYS,
  WORKBOOK_RENDER_KEYS,
  WORKBOOK_TARGET_KEYS,
} from './args'
import {
  CmfAccessError,
  checkPdf,
  cmfKeys,
  cmfPrompt,
  identifiersOnly,
  listCmf,
  planGrade,
  planRender,
  readUpload,
  recordCmfVerdict,
  requireCmf,
  runGrade,
  runRender,
  supplierPdf,
  uploadWorkbook,
  type CmfActor,
  type CmfGradeExecution,
  type CmfRenderExecution,
  type CmfRenderReady,
  type LoadedKit,
} from './service'
import { jobView, prismaCmfWebJobStore, startWebJob, type CmfWebJobStore } from './web-jobs'
import { allowanceNeed, checkClaudeAllowance, type AllowanceDecision } from '@/lib/headless/claude-allowance'
import { drawPriceUsd } from '@/lib/creative/work-runtime'
import type { WaitUntil } from '@/lib/headless/jobs'

// ------------------------------------------------------------------ what the door reaches

/** The signed-in person, or the answer that turns them away. */
export type WebActorResult = { actor: CmfActor } | { refused: { status: number; error: string } }

export interface CmfWebDoorDeps {
  actor(): Promise<WebActorResult>
  jobs: CmfWebJobStore
  waitUntil: WaitUntil
  allowance(input: Parameters<typeof checkClaudeAllowance>[0]): Promise<AllowanceDecision>
  env: NodeJS.ProcessEnv
}

/** The person as the CMF service knows them through the web: the profile, no credential, every model. */
export function webActor(p: { userId: string; email: string | null; isAdmin: boolean }): CmfActor {
  return { profileId: p.userId, email: p.email, role: p.isAdmin ? 'admin' : 'user', door: 'web', credentialId: null, allowedModels: [] }
}

export const productionCmfWebDoorDeps: CmfWebDoorDeps = {
  async actor() {
    // The web app's own sign-in check (session, profile, paused, deleted), loaded here only: it
    // reads the request's cookies. CMF access itself is the service's gate, read fresh.
    const { requireAuthenticatedProfile } = await import('@/lib/cmf/service')
    const auth = await requireAuthenticatedProfile()
    if (!auth.profile) {
      const body = (await auth.response.json().catch(() => ({}))) as { error?: string }
      return { refused: { status: auth.response.status, error: body.error ?? 'Unauthorized' } }
    }
    return { actor: webActor(auth.profile) }
  },
  jobs: prismaCmfWebJobStore,
  waitUntil: (p) => vercelWaitUntil(p),
  allowance: (input) => checkClaudeAllowance(input),
  env: process.env,
}

let doorDeps: CmfWebDoorDeps = productionCmfWebDoorDeps

/** Tests swap the door's reach; null puts production back. The service's own reach is `setCmfServiceDeps`. */
export function setCmfWebDoorDeps(next: Partial<CmfWebDoorDeps> | null): void {
  doorDeps = next ? { ...productionCmfWebDoorDeps, ...next } : productionCmfWebDoorDeps
}

// ------------------------------------------------------------------ answers

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** A refusal: `{ error }` with the service's words, as Claude reads them, and anything the step adds. */
function refusal(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status)
}

class BadArguments extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BadArguments'
  }
}

/** Claude's own words for arguments that do not parse (`invalidArguments`). */
function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const got = schema.safeParse(value)
  if (!got.success) throw new BadArguments(`Invalid arguments: ${got.error.issues.map((i) => i.message).join('; ')}`)
  return got.data
}

/** What a thrown refusal answers. The message is the service's, never rewritten for the web. */
function answerError(err: unknown): Response {
  if (err instanceof CmfAccessError) return refusal(403, err.message)
  if (err instanceof CmfPdfRefused) {
    return refusal(422, err.message, { saved: false, counts: err.check.counts, rows: err.check.rows.filter((x) => x.state !== 'match') })
  }
  if (err instanceof PromptRefusal) return refusal(422, err.message, { reasons: err.reasons })
  if (err instanceof CmfError) return refusal(422, err.message)
  if (err instanceof BadArguments) return refusal(400, err.message)
  const e = err as Error
  // The service's plain refusals (identifiers only, an unknown check, a model the token may not
  // use) are Errors with a sentence; anything else is a fault, said in one line.
  if (e && e.name === 'Error' && typeof e.message === 'string') return refusal(400, e.message)
  console.error('[cmf/v2] failed', e)
  const line = String(e?.message || 'CMF step failed').split('\n')[0].slice(0, 300)
  return refusal(500, line)
}

async function run(handler: (actor: CmfActor, d: CmfWebDoorDeps) => Promise<Response>): Promise<Response> {
  const d = doorDeps
  try {
    // The sign-in check reads the profile; a fault there is answered like any other.
    const who = await d.actor()
    if ('refused' in who) return refusal(who.refused.status, who.refused.error)
    return await handler(who.actor, d)
  } catch (err) {
    return answerError(err)
  }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.json().catch(() => undefined)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadArguments('Invalid arguments: send a JSON object')
  return raw as Record<string, unknown>
}

/** The kit's CMF deciders, by name: whose answer a supplier PDF counts. */
function deciderNames(loaded: LoadedKit): string[] {
  try {
    return deciderEmails(cmfKit(loaded.kit)).map((d) => d.name)
  } catch {
    return []
  }
}

// ------------------------------------------------------------------ list, uploads, keys

/** GET /api/cmf/v2/list[?tab=]: cmf_list's listing. */
export function webList(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const tab = new URL(req.url).searchParams.get('tab')
    const args = parse(CmfListArgs, tab ? { tab } : {})
    const { loaded, cmf, tabs, uploads, renders, supplier_pdfs, problems } = await listCmf(actor, args, d.env)
    return json({
      ...kitHeader(loaded),
      rubric_version: cmf.product.rubric.version ?? null,
      deciders: deciderNames(loaded),
      tabs,
      uploads,
      renders,
      supplier_pdfs,
      problems,
    })
  })
}

/** POST /api/cmf/v2/uploads (multipart, `file`): a workbook export kept for the team. */
export function webUpload(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!file || typeof file === 'string') throw new BadArguments('Invalid arguments: attach the workbook as file')
    const bytes = Buffer.from(await (file as Blob).arrayBuffer())
    const { loaded, upload } = await uploadWorkbook(actor, { file_name: (file as File).name ?? 'workbook.xlsx', bytes }, d.env)
    return json({ ...kitHeader(loaded), upload }, 201)
  })
}

/** GET /api/cmf/v2/uploads/{import_id}: the upload's tabs, SKUs and keys. */
export function webReadUpload(importId: string): Promise<Response> {
  return run(async (actor, d) => {
    const { import_id } = parse(z.object({ import_id: z.string().uuid() }), { import_id: importId })
    const { loaded, upload } = await readUpload(actor, { import_id }, d.env)
    return json({ ...kitHeader(loaded), upload })
  })
}

/** GET /api/cmf/v2/keys: the kit's clown keys, read only. */
export function webKeys(): Promise<Response> {
  return run(async (actor, d) => {
    const { loaded, keys } = await cmfKeys(actor, d.env)
    return json({ ...kitHeader(loaded), keys })
  })
}

// ------------------------------------------------------------------ prompt

/** POST /api/cmf/v2/prompt: Damien's template filled by code, exactly what a render sends. */
export function webPrompt(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const args = await body(req)
    if ('import_id' in args) {
      identifiersOnly('cmf_prompt', args, WORKBOOK_TARGET_KEYS)
      const target = parse(CmfWorkbookPromptArgs, args)
      const got = await cmfPrompt(actor, target, d.env)
      if (got.source !== 'upload') throw new Error('unreachable: an upload target answered from the kit')
      if ('refused' in got) {
        return json({ ...kitHeader(got.loaded), refused: true, import_id: target.import_id, tab: target.tab, column: target.sku_column.toUpperCase(), key: target.clown, reasons: got.refused.reasons })
      }
      const p = got.built.payload
      return json({
        ...kitHeader(got.loaded),
        refused: false,
        payload_id: got.built.payloadId,
        tab: p.tab,
        column: p.column,
        sku_name: p.sku_name ?? null,
        key: p.key,
        key_confirmed: p.key_confirmed,
        clown: p.clown,
        prompt: p.prompt,
        prompt_sha256: p.prompt_sha256,
        template_sha256: p.template_sha256,
        lines: p.lines,
        omitted: p.omitted,
        warnings: p.warnings,
        workbook: {
          import_id: p.workbook.import_id,
          file: p.workbook.file,
          sha256: p.workbook.sha256,
          modified: p.workbook.modified,
          modified_source: p.workbook.modified_source,
          imported_at: p.workbook.imported_at,
          sku_spec_sha256: p.workbook.sku_spec_sha256,
        },
      })
    }
    const target = parse(CmfPromptArgs, args)
    const got = await cmfPrompt(actor, target, d.env)
    if (got.source !== 'kit') throw new Error('unreachable: a kit target answered from an upload')
    const { entry, payload } = got
    if (!payload) return json({ ...kitHeader(got.loaded), refused: true, tab: entry.tab, column: entry.column, key: entry.key, reasons: entry.reasons ?? [] })
    return json({
      ...kitHeader(got.loaded),
      refused: false,
      payload_id: kitPayloadId(entry.spec, entry.column, entry.key),
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
    })
  })
}

// ------------------------------------------------------------------ render

/** What a render is about to do, as the page shows it before and while it draws. */
function planView(ready: CmfRenderReady) {
  const p = ready.plan
  return {
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
    n: p.n,
    prompt_sha256: p.promptSha256,
    aspect: p.aspect,
    image_size: p.imageSize,
    ...(p.workbook ? { workbook: { import_id: p.workbook.import_id, file: p.workbook.file, sha256: p.workbook.sha256, modified: p.workbook.modified, sku_spec_sha256: p.workbook.sku_spec_sha256 } } : {}),
  }
}

/** What a finished render keeps in its job: cmf_render's structured answer, without image bytes. */
export function renderView(x: CmfRenderExecution): Record<string, unknown> {
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
    prompt: p.prompt,
    prompt_sha256: p.promptSha256,
    aspect: p.aspect,
    image_size: p.imageSize,
    ...(p.workbook ? { workbook: { import_id: p.workbook.import_id, file: p.workbook.file, sha256: p.workbook.sha256, modified: p.workbook.modified, sku_spec_sha256: p.workbook.sku_spec_sha256 } } : {}),
    generationId: x.generationId,
    outputs: x.outputs,
    manifest: x.manifest,
    failures: x.failures,
    recorded: x.recorded,
    record_error: x.recordError,
    estimatedCostUsd: x.costUsd,
  }
}

const allowanceRefusal = (a: Extract<AllowanceDecision, { ok: false }>) =>
  refusal(429, a.message, { allowance: { kind: a.kind, used: a.used, limit: a.limit, requested: a.requested, frees_at: a.freesAt ? a.freesAt.toISOString() : null } })

/**
 * POST /api/cmf/v2/render: every refusal cmf_render makes, in the request, before anything is
 * paid for; then the daily allowance, the same count as Claude's; then the draw, as a job.
 * Answers 202 with the job and the plan.
 */
export function webRender(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const args = await body(req)
    let target: Parameters<typeof planRender>[1]
    if ('import_id' in args) {
      identifiersOnly('cmf_render', args, WORKBOOK_RENDER_KEYS)
      target = parse(CmfWorkbookRenderArgs, args)
    } else {
      const extra = Object.keys(args).filter((k) => /^(reference|references|image|images|image_url|output_id|prompt)$/i.test(k))
      if (extra.length) throw new Error(`cmf_render takes no ${extra.join(', ')}: the clown is the only image and the prompt is the payload's, byte for byte.`)
      target = parse(CmfRenderArgs, args)
    }
    const ready = await planRender(actor, target, d.env)
    const need = allowanceNeed('cmf_render', { n: ready.plan.n })!
    const allowed = await d.allowance({ ownerId: actor.profileId, isAdmin: actor.role === 'admin', need, env: d.env, door: 'web' })
    if (!allowed.ok) return allowanceRefusal(allowed)
    const { async: _async, ...request } = target as unknown as Record<string, unknown>
    void _async
    const { jobId } = await startWebJob<CmfRenderExecution>({
      store: d.jobs,
      waitUntil: d.waitUntil,
      ownerId: actor.profileId,
      toolName: 'cmf_render',
      request: { ...request, n: ready.plan.n },
      work: (id) => runRender(actor, ready, { jobId: id }, d.env),
      toResult: (x) => ({ result: renderView(x), outputIds: x.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string') }),
    })
    const perImage = drawPriceUsd(ready.plan.model, ready.plan.imageSize)
    return json({ ...kitHeader(ready.loaded), job_id: jobId, status: 'processing', plan: planView(ready), estimated_cost_usd: perImage === null ? null : perImage * ready.plan.n }, 202)
  })
}

/** GET /api/cmf/v2/render/{job}: a render the person started, still drawing or done. */
export function webRenderJob(jobId: string): Promise<Response> {
  return run(async (actor, d) => {
    const { job_id } = parse(z.object({ job_id: z.string().uuid() }), { job_id: jobId })
    await requireCmf(actor)
    const job = await d.jobs.get(job_id, actor.profileId)
    if (!job) return refusal(404, `no render job '${job_id}' of yours`)
    return json(jobView(job))
  })
}

// ------------------------------------------------------------------ grade, verdict

/** grade_image's structured answer for a CMF grade, and the checks that failed with their captions. */
export function gradeView(x: CmfGradeExecution): Record<string, unknown> {
  const a = x.outcome.aggregate
  const checks = new Map(x.product.rubric.checks.map((c) => [c.id, c]))
  return {
    ...x.header,
    product: x.slug,
    grade_id: x.gradeId,
    status: a.status,
    verdict: a.verdict,
    verdict_majority: a.verdict_majority,
    unstable: a.unstable,
    per_read_verdicts: a.per_read_verdicts,
    failed: a.failed,
    failed_advisory: a.failed_advisory,
    fails: a.fails,
    reads: x.outcome.reads,
    errors: a.errors,
    judge: 'vesper',
    judge_label: x.outcome.judge_label,
    judge_model: x.outcome.judge_model,
    rubric_version: x.product.rubric.version,
    reporting_only: x.outcome.reporting_only,
    template_id: x.outcome.template_id,
    references: x.outcome.references,
    missing: x.outcome.missing,
    image_sha256: x.candidate.sha256,
    output_id: x.candidate.outputId,
    image_url: x.candidate.imageUrl,
    stored: x.gradeId !== null,
    ...(x.storeError ? { store_error: x.storeError } : {}),
    cmf: x.cmf,
    checks: x.product.rubric.checks
      .filter((c) => (a.fails[c.id] ?? 0) > 0 && a.errors < a.reads)
      .map((c) => ({ id: c.id, severity: c.severity, caption: checks.get(c.id)?.caption ?? c.check, fails: a.fails[c.id], reads: a.reads })),
  }
}

/** POST /api/cmf/v2/grade: the kit's grader on one of the team's renders, against its upload's row. Waits for the reads. */
export function webGrade(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const a = parse(CmfGradeArgs, await body(req))
    // Every refusal of the grade, then the allowance, then the reads: nothing is paid for before both.
    const ready = await planGrade(actor, { output_id: a.output_id, import_id: a.import_id, tab: a.tab, column: a.column, clown: a.clown, runs: a.runs }, d.env)
    const need = allowanceNeed('grade_image', { runs: a.runs })!
    const allowed = await d.allowance({ ownerId: actor.profileId, isAdmin: actor.role === 'admin', need, env: d.env, door: 'web' })
    if (!allowed.ok) return allowanceRefusal(allowed)
    return json(gradeView(await runGrade(actor, ready, d.env)))
  })
}

/** POST /api/cmf/v2/verdict: a yes or no with why, in the person's name, and whether it counts as the decider's. */
export function webVerdict(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const a = parse(CmfVerdictArgs, await body(req))
    const got = await recordCmfVerdict(actor, { output_id: a.output_id, grade_id: a.grade_id, answer: a.answer, remark: a.remark, decoded: [], decoded_unconfirmed: [] }, d.env)
    return json({
      ...kitHeader(got.loaded),
      verdict_id: got.verdictId,
      product: got.slug,
      answer: a.answer,
      grade_id: got.grade?.id ?? null,
      route: 'vesper',
      comment_line: null,
      frontify_asset_id: got.frontifyAssetId,
      decider: got.decider,
    })
  })
}

// ------------------------------------------------------------------ pdf, check-pdf

/** POST /api/cmf/v2/pdf: the supplier PDF, checked against the upload's cells before it is saved. */
export function webSupplierPdf(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const args = await body(req)
    identifiersOnly('cmf_pdf', args, PDF_KEYS)
    const a = parse(CmfPdfArgs, args)
    const got = await supplierPdf(actor, a, d.env)
    if (!got.saved) {
      const err = got.refused
      return refusal(422, err.message, { ...kitHeader(got.loaded), saved: false, counts: err.check.counts, rows: err.check.rows.filter((x) => x.state !== 'match') })
    }
    return json({
      ...kitHeader(got.loaded),
      saved: true,
      ...got.result,
      supplier_pdf_id: 'id' in got.listed ? got.listed.id : null,
      ...('error' in got.listed ? { listed_error: got.listed.error } : {}),
    })
  })
}

/** POST /api/cmf/v2/check-pdf: every value on a CMF PDF against its sheet cell. */
export function webCheckPdf(req: Request): Promise<Response> {
  return run(async (actor, d) => {
    const a = parse(CmfCheckPdfArgs, await body(req))
    const { loaded, result } = await checkPdf(actor, a, d.env)
    return json({ ...kitHeader(loaded), ...result, rows: result.rows })
  })
}
