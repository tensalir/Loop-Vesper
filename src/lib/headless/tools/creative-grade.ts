/**
 * `grade_image`: Vesper's scripted read of one picture of a Loop product, three reads with the
 * product's grader words from the creative kit (`src/lib/creative/grade.ts`), labelled
 * `judge <model> vesper x<reads>`: advisory, the product's decider decides, never pooled with any
 * other judge. Stored in `creative_grades`.
 *
 * `record_grade`: Claude's own look at the same picture, stored beside it as `judge chat`, so the
 * two judges can be compared later and are never added together.
 */

import { z } from 'zod'
import { getCreativeKit } from '@/lib/creative/kit-runtime'
import type { LoadedKit } from '@/lib/creative/kit'
import { kitHeader } from '@/lib/creative/tool-views'
import { resolveProduct } from '@/lib/creative/products'
import { prismaPinStore } from '@/lib/creative/pins-runtime'
import { pinPart } from '@/lib/creative/pin-parts'
import { gradeCandidate, MAX_RUNS, type GradeOutcome } from '@/lib/creative/grade'
import { loadCandidate, type LoadedCandidate } from '@/lib/creative/candidate'
import { prismaCreativeRecords } from '@/lib/creative/records'
import { GradingPromptError } from '@/lib/creative/grading-prompt'
import {
  candidatePartFor,
  gradeReader,
  GRADE_READ_USD,
  pinPartDeps,
  productionCandidateDeps,
} from '@/lib/creative/work-runtime'
import type { KitProduct } from '@/lib/creative/kit-schema'
import type { JobPayload } from '../jobs'
import { runLongCall } from './long-call'
import { ownerIsAdmin } from './creative-read'
import { invalidArguments, type ToolContext, type ToolHandler } from './types'

const CHECK_ID = /^[A-E]\d+$/

const PictureFields = {
  output_id: z.string().uuid().optional(),
  frontify_asset_id: z.string().min(8).max(200).optional(),
  image_url: z.string().url().max(2000).optional(),
}

export const GradeImageArgs = z
  .object({
    product: z.string().min(1).max(80),
    ...PictureFields,
    colourway: z.string().max(40).optional(),
    view: z.string().max(40).optional(),
    runs: z.number().int().min(1).max(MAX_RUNS).optional(),
    // CMF and packaging keys; refused with the kit's reason until their grader reaches the kit.
    tab: z.string().max(80).optional(),
    column: z.string().max(4).optional(),
    clown: z.string().max(120).optional(),
    look: z.string().max(40).optional(),
    box: z.string().max(40).optional(),
    async: z.boolean().optional().default(false),
  })
  .strict()

export const RecordGradeArgs = z
  .object({
    product: z.string().min(1).max(80),
    ...PictureFields,
    verdict: z.enum(['PASS', 'PASS_WITH_NOTES', 'RETRY', 'FAIL']),
    failed: z.array(z.string().regex(CHECK_ID)).max(40).default([]),
    judge_model: z.string().regex(/^\S{2,80}$/),
    reads: z.number().int().min(1).max(5).default(1),
    surface: z.enum(['chat', 'cowork', 'code']).default('chat'),
    colourway: z.string().max(40).optional(),
    view: z.string().max(40).optional(),
  })
  .strict()

function deciderOf(product: KitProduct): string {
  const d = (product.deciders?.[0] ?? {}) as { role?: string; name?: string | null }
  return d.name ? `${d.name}, the ${d.role ?? 'decider'}` : `the ${d.role ?? 'decider'}`
}

interface GradeExecution {
  header: ReturnType<typeof kitHeader>
  slug: string
  product: KitProduct
  candidate: Omit<LoadedCandidate, 'bytes'>
  outcome: GradeOutcome
  gradeId: string | null
  storeError: string | null
  costUsd: number
}

export function gradeText(x: Pick<GradeExecution, 'slug' | 'product' | 'outcome' | 'gradeId' | 'header'>): string {
  const { outcome: o, product } = x
  const a = o.aggregate
  const checks = new Map(product.rubric.checks.map((c) => [c.id, c]))
  const lines: string[] = []
  lines.push(`Vesper's scripted read of this ${product.name} picture (advisory; ${deciderOf(product)} decides):`)
  if (a.status === 'ERROR') {
    lines.push(`No verdict: ${a.errors} of ${a.reads} reads erred, so this is not a grade. Grade it again.`)
  } else {
    lines.push(`${a.verdict}${a.unstable || a.verdict_majority !== a.verdict ? ` (the reads' own verdicts: ${a.per_read_verdicts.join(', ')}; majority ${a.verdict_majority}${a.unstable ? ', unsettled' : ''})` : ''}`)
  }
  lines.push(
    `${o.judge_label}; rubric ${product.rubric.version ?? '?'}${o.reporting_only ? ' (reporting only: no check blocks yet)' : ''}; creative kit ${x.header.kit_version}${x.header.kit_commit ? ` (${String(x.header.kit_commit).slice(0, 7)})` : ''}${x.header.kit_stale ? ', stale' : ''}.`
  )
  const any = product.rubric.checks.filter((c) => a.fails[c.id] > 0 && a.errors < a.reads)
  if (any.length) {
    lines.push('Checks failed in at least one read:')
    lines.push('| Check | Severity | What it means | Reads |')
    lines.push('|---|---|---|---|')
    for (const c of any) {
      const cap = checks.get(c.id)?.caption ?? c.check
      lines.push(`| ${c.id} | ${c.severity} | ${cap} | ${a.fails[c.id]} of ${a.reads} |`)
    }
  } else if (a.status === 'graded') {
    lines.push('No check failed in any read.')
  }
  if (a.failed_advisory.length) lines.push(`Advisory, reported and not counted: ${a.failed_advisory.join(', ')}.`)
  lines.push(
    `Attached after the picture: ${o.references.map((r) => `${r.n}. ${r.title ?? r.pin_id} (${r.role})`).join('; ') || 'nothing'}.` +
      (o.missing.length ? ` Not attached: ${o.missing.map((m) => `${m.role} (${m.why})`).join('; ')}.` : '')
  )
  const assumed = [o.view_assumed ? `view ${o.view} assumed` : '', o.claim ? `colourway ${o.claim} from the ${o.claim_source}` : 'no colourway claim']
    .filter(Boolean)
    .join('; ')
  lines.push(`${assumed.charAt(0).toUpperCase()}${assumed.slice(1)}.`)
  if (x.gradeId) lines.push(`grade_id ${x.gradeId}: record the decider's answer with record_verdict.`)
  return lines.join('\n')
}

function payload(x: GradeExecution): JobPayload {
  return {
    summary: gradeText(x),
    structuredContent: {
      ...x.header,
      product: x.slug,
      grade_id: x.gradeId,
      status: x.outcome.aggregate.status,
      verdict: x.outcome.aggregate.verdict,
      verdict_majority: x.outcome.aggregate.verdict_majority,
      unstable: x.outcome.aggregate.unstable,
      per_read_verdicts: x.outcome.aggregate.per_read_verdicts,
      failed: x.outcome.aggregate.failed,
      failed_advisory: x.outcome.aggregate.failed_advisory,
      fails: x.outcome.aggregate.fails,
      reads: x.outcome.reads,
      errors: x.outcome.aggregate.errors,
      judge: 'vesper',
      judge_label: x.outcome.judge_label,
      judge_model: x.outcome.judge_model,
      rubric_version: x.product.rubric.version,
      reporting_only: x.outcome.reporting_only,
      template_id: x.outcome.template_id,
      view: x.outcome.view,
      view_assumed: x.outcome.view_assumed,
      colourway: x.outcome.colourway,
      claim: x.outcome.claim,
      claim_source: x.outcome.claim_source,
      references: x.outcome.references,
      missing: x.outcome.missing,
      image_sha256: x.candidate.sha256,
      output_id: x.candidate.outputId,
      frontify_asset_id: x.candidate.frontifyAssetId,
      image_url: x.candidate.imageUrl,
      stored: x.gradeId !== null,
      ...(x.storeError ? { store_error: x.storeError } : {}),
      modelId: x.outcome.judge_model ?? 'gemini',
      outputs: [],
      durationMs: x.outcome.latency_ms,
    },
    outputIds: [],
    costUsd: x.costUsd,
  }
}

function claimFor(slug: string, a: { colourway?: string }, candidate: LoadedCandidate): { claim: string | null; source: string | null } {
  if (a.colourway) return { claim: a.colourway, source: 'reviewer' }
  if (candidate.drawn?.colourway && (!candidate.drawn.product || candidate.drawn.product === slug)) {
    return { claim: candidate.drawn.colourway, source: 'prompt' }
  }
  return { claim: null, source: null }
}

async function executeGrade(ctx: ToolContext, loaded: LoadedKit, slug: string, product: KitProduct, a: z.infer<typeof GradeImageArgs>, isAdmin: boolean): Promise<GradeExecution> {
  const candidate = await loadCandidate(a, ctx.principal.ownerId, productionCandidateDeps(ctx.env))
  const { claim, source } = claimFor(slug, a, candidate)
  const view = a.view ?? (candidate.drawn?.product === slug ? candidate.drawn.view : null) ?? null
  const rows = await prismaPinStore.list(slug)
  const inlineLimit = product.grading?.inline_limit_bytes ?? 3_500_000
  const partDeps = pinPartDeps(ctx.env, inlineLimit)
  const outcome = await gradeCandidate(
    {
      kit: loaded.kit,
      slug,
      product,
      candidate,
      colourway: claim,
      view,
      claim,
      claimSource: source,
      runs: a.runs,
      isAdmin,
    },
    {
      pinRows: rows,
      candidatePart: (c) => candidatePartFor(ctx.env, inlineLimit, c),
      pinPart: (row, spec) => pinPart(row, spec, partDeps),
      read: gradeReader(ctx.env, product.grading?.models ?? []),
    }
  )
  const header = kitHeader(loaded)
  const costUsd = GRADE_READ_USD * outcome.aggregate.reads
  let gradeId: string | null = null
  let storeError: string | null = null
  try {
    const stored = await prismaCreativeRecords.insertGrade({
      product: slug,
      ownerId: ctx.principal.ownerId,
      credentialId: ctx.principal.credentialId,
      outputId: candidate.outputId,
      imageUrl: candidate.imageUrl,
      frontifyAssetId: candidate.frontifyAssetId,
      imageSha256: candidate.sha256,
      colourway: outcome.colourway,
      view: outcome.view,
      viewAssumed: outcome.view_assumed,
      claimSource: outcome.claim_source,
      judge: 'vesper',
      judgeModel: outcome.judge_model,
      reads: outcome.aggregate.reads,
      templateId: outcome.template_id,
      kitVersion: loaded.kit.version,
      kitCommit: loaded.commit,
      rubricVersion: product.rubric.version ?? '?',
      runs: outcome.reads,
      fails: outcome.aggregate.fails,
      failed: outcome.aggregate.failed,
      failedAdvisory: outcome.aggregate.failed_advisory,
      verdict: outcome.aggregate.verdict,
      verdictMajority: outcome.aggregate.verdict_majority,
      unstable: outcome.aggregate.unstable,
      errors: outcome.aggregate.errors,
      references: { attached: outcome.references, missing: outcome.missing, prompt_sha256: outcome.prompt_sha256 },
      latencyMs: outcome.latency_ms,
      costUsd,
    })
    gradeId = stored.id
  } catch (err) {
    storeError = (err as Error)?.message || 'the grade could not be stored'
  }
  const { bytes: _bytes, ...rest } = candidate
  return { header, slug, product, candidate: rest, outcome, gradeId, storeError, costUsd }
}

export const gradeImageHandler: ToolHandler = {
  estimateCostUsd(args) {
    const runs = typeof args.runs === 'number' ? args.runs : 3
    return GRADE_READ_USD * runs
  },
  async run(args, ctx) {
    const parsed = GradeImageArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const a = parsed.data
    const loaded = await getCreativeKit({ env: ctx.env })
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const { slug, product } = resolveProduct(loaded.kit, a.product, { isAdmin })
    if (!product.grading_prompt || !product.grading) {
      throw new GradingPromptError(
        `The creative kit ${loaded.kit.version} carries no grader for ${product.name} yet, so Vesper cannot grade it. Read it yourself with the product's skill, labelled as one read.`
      )
    }
    return runLongCall<GradeExecution>({
      ctx,
      toolName: 'grade_image',
      modelId: product.grading.models[0] ?? 'gemini',
      request: { ...a },
      runAsync: a.async,
      what: `the ${slug} grade`,
      execute: () => executeGrade(ctx, loaded, slug, product, a, isAdmin),
      toPayload: payload,
      toWire: async (x) => ({ content: [{ type: 'text', text: gradeText(x) }], structuredContent: payload(x).structuredContent }),
    })
  },
}

export const recordGradeHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = RecordGradeArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const a = parsed.data
    const loaded = await getCreativeKit({ env: ctx.env })
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const { slug, product } = resolveProduct(loaded.kit, a.product, { isAdmin })
    const known = new Set(product.rubric.checks.map((c) => c.id))
    const unknown = a.failed.filter((id) => !known.has(id))
    if (unknown.length) throw new Error(`${product.name}'s rubric has no check ${unknown.join(', ')}`)
    const candidate = await loadCandidate(a, ctx.principal.ownerId, productionCandidateDeps(ctx.env))
    const stored = await prismaCreativeRecords.insertGrade({
      product: slug,
      ownerId: ctx.principal.ownerId,
      credentialId: ctx.principal.credentialId,
      outputId: candidate.outputId,
      imageUrl: candidate.imageUrl,
      frontifyAssetId: candidate.frontifyAssetId,
      imageSha256: candidate.sha256,
      colourway: a.colourway ?? candidate.drawn?.colourway ?? null,
      view: a.view ?? candidate.drawn?.view ?? null,
      viewAssumed: false,
      claimSource: a.colourway ? 'reviewer' : candidate.drawn?.colourway ? 'prompt' : null,
      judge: 'chat',
      judgeModel: a.judge_model,
      reads: a.reads,
      templateId: null,
      kitVersion: loaded.kit.version,
      kitCommit: loaded.commit,
      rubricVersion: product.rubric.version ?? '?',
      runs: [{ surface: a.surface, verdict: a.verdict, failed: a.failed }],
      fails: Object.fromEntries(a.failed.map((id) => [id, a.reads])),
      failed: a.failed,
      failedAdvisory: [],
      verdict: a.verdict,
      verdictMajority: a.verdict,
      unstable: false,
      errors: 0,
      references: [],
      latencyMs: null,
      costUsd: null,
    })
    const label = `judge ${a.judge_model} ${a.surface} x${a.reads}`
    return {
      content: [
        {
          type: 'text',
          text: `Recorded Claude's own read, ${label}: ${a.verdict}${a.failed.length ? ` (${a.failed.join(', ')})` : ''}. It stands beside Vesper's grade and is never added to it; ${deciderOf(product)} decides. grade_id ${stored.id}.`,
        },
      ],
      structuredContent: { ...kitHeader(loaded), grade_id: stored.id, judge: 'chat', judge_label: label, product: slug, image_sha256: candidate.sha256 },
    }
  },
}
