/**
 * Vesper's scripted read of one picture: the product's grader words from the
 * creative kit, the candidate first, then the pinned references in the
 * grader's order, then the prompt; three reads at once, each with its own
 * time limit inside one deadline; the kit's rules for turning three reads
 * into one grade (`aggregate.ts`). Labelled `vesper`, a judge of its own,
 * never pooled with the repository's `qa` grader or with Claude's own look.
 *
 * Every dependency that costs money or reaches the network is injected.
 */

import crypto from 'crypto'
import type { Kit, KitProduct } from './kit-schema'
import type { PinRow, PinSpec } from './pins'
import { kitPins, usablePin } from './pins'
import { referencePlan } from './tool-views'
import { assembleGradingPrompt, GradingPromptError, type MissingReference } from './grading-prompt'
import { aggregateReads, readAnswer, type Aggregate, type ReadResult } from './aggregate'
import type { GeminiPart } from './gemini'

export const READ_TIMEOUT_MS = 90_000
export const GRADE_DEADLINE_MS = 240_000
export const MAX_RUNS = 5

export interface Candidate {
  bytes: Buffer
  mimeType: string
  sha256: string
}

export interface GradeRequest {
  kit: Kit
  slug: string
  product: KitProduct
  candidate: Candidate
  colourway: string | null
  view: string | null
  claim: string | null
  claimSource: string | null
  assetClass?: string
  runs?: number
  isAdmin?: boolean
}

export interface GradeDeps {
  pinRows: readonly PinRow[]
  candidatePart(candidate: Candidate): Promise<GeminiPart>
  pinPart(row: PinRow, spec: PinSpec): Promise<GeminiPart>
  /** One read: the grader's JSON and the model that answered. */
  read(parts: GeminiPart[], opts: { deadline: number; perCallMs: number }): Promise<{ json: unknown; model: string }>
  now?: () => number
}

export interface AttachedReference {
  n: number
  pin_id: string
  title: string | null
  role: string
  colourway: string | null
  sha256: string
}

export interface GradeOutcome {
  aggregate: Aggregate
  prompt: string
  prompt_sha256: string
  template_id: string
  view: string
  view_assumed: boolean
  colourway: string | null
  claim: string | null
  claim_source: string | null
  references: AttachedReference[]
  missing: MissingReference[]
  reads: Array<{ ok: boolean; model?: string; error?: string; ms: number; failed?: string[]; unanswered?: string[]; reads_as?: string; worst_issue?: string }>
  judge_label: string
  judge_model: string | null
  reporting_only: boolean
  latency_ms: number
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/** `judge <model> vesper x<reads>`, the model the reads answered with (the first when they differ). */
export function judgeLabel(models: readonly string[], reads: number): { label: string; model: string | null } {
  const model = models[0] ?? null
  return { label: `judge ${model ?? 'gemini'} vesper x${reads}`, model }
}

export async function gradeCandidate(req: GradeRequest, deps: GradeDeps): Promise<GradeOutcome> {
  const now = deps.now ?? Date.now
  const started = now()
  const { product } = req
  if (product.kind === 'packaging') {
    throw new GradingPromptError(
      "Vesper does not grade packaging yet: its grader's words are in the kit, and the packaging tools that attach the cell's composite, white render and dieline come in the next change. Read it with /creative:packaging, labelled as one read."
    )
  }
  if (product.kind === 'cmf') {
    throw new GradingPromptError('a CMF render is graded against its sheet row and its clown: name the tab, column and clown')
  }
  if (!product.grading_prompt || !product.grading) {
    throw new GradingPromptError(`the kit carries no grader for ${product.name} yet, so Vesper cannot grade it`)
  }
  const runs = Math.max(1, Math.min(MAX_RUNS, req.runs ?? product.grading.runs ?? 3))
  const viewAssumed = !req.view
  const view = req.view ?? 'frontal'

  // The grader's references for this colourway and view, in the kit's order.
  const plan = referencePlan(
    req.kit,
    { product: req.slug, purpose: 'grade', colourway: req.colourway ?? undefined, view },
    deps.pinRows,
    { isAdmin: req.isAdmin }
  )
  const specs = new Map(kitPins(req.kit).filter((s) => s.product === req.slug).map((s) => [s.pinId, s]))
  const rows = new Map(deps.pinRows.map((r) => [`${r.pinId}@${r.sha256}`, r]))
  const kitPinsById = new Map((product.references?.pins ?? []).map((p) => [p.id, p]))

  const attached: AttachedReference[] = []
  const attachedParts: Array<() => Promise<GeminiPart>> = []
  const missing: MissingReference[] = []
  for (const ref of plan.references) {
    const kitPin = kitPinsById.get(ref.pin_id)
    const role = kitPin?.roles?.[0] ?? ref.roles[0] ?? 'reference'
    const spec = specs.get(ref.pin_id)
    if (ref.sha256 && ref.sha256 === req.candidate.sha256) {
      missing.push({ role, why: 'it is the picture under review' })
      continue
    }
    const row = spec ? rows.get(`${spec.pinId}@${spec.sha256}`) : undefined
    if (!spec || !row || !usablePin(row, spec)) {
      missing.push({ role, why: ref.why_not ?? 'not pinned yet' })
      continue
    }
    attached.push({
      n: 0,
      pin_id: ref.pin_id,
      title: ref.title,
      role,
      colourway: kitPin?.colourway ?? null,
      sha256: ref.sha256,
    })
    attachedParts.push(() => deps.pinPart(row, spec))
  }
  const first = product.grading_prompt.first_reference_index ?? 2
  attached.forEach((a, i) => (a.n = first + i))

  const prompt = assembleGradingPrompt(product, {
    view,
    asset_class: req.assetClass ?? '',
    attached: attached.map((a) => ({ role: a.role, colourway: a.colourway })),
    missing,
    claim: req.claim,
    claim_source: req.claimSource ?? '',
    detected: null,
    detected_confidence: '',
  })

  const parts: GeminiPart[] = [await deps.candidatePart(req.candidate)]
  for (const make of attachedParts) parts.push(await make())
  parts.push({ text: prompt })

  const deadline = started + GRADE_DEADLINE_MS
  const checks = product.rubric.checks
  const results: ReadResult[] = await Promise.all(
    Array.from({ length: runs }, async (): Promise<ReadResult> => {
      const t0 = now()
      try {
        const { json, model } = await deps.read(parts, { deadline, perCallMs: READ_TIMEOUT_MS })
        return { ok: true, model, answer: readAnswer(json, checks), ms: now() - t0 }
      } catch (err) {
        return { ok: false, error: (err as Error)?.message || 'the read failed', ms: now() - t0 }
      }
    })
  )
  const aggregate = aggregateReads(results, checks, req.kit.ladder)
  const { label, model } = judgeLabel(aggregate.models, runs)
  return {
    aggregate,
    prompt,
    prompt_sha256: sha256(prompt),
    template_id: String(product.grading_prompt.template_id),
    view,
    view_assumed: viewAssumed,
    colourway: plan.key.colourway ?? req.colourway,
    claim: req.claim,
    claim_source: req.claimSource,
    references: attached,
    missing,
    reads: results.map((r) =>
      r.ok
        ? {
            ok: true,
            model: r.model,
            ms: r.ms,
            failed: checks.filter((c) => !r.answer.checks[c.id]).map((c) => c.id),
            unanswered: r.answer.unanswered,
            reads_as: r.answer.reads_as,
            worst_issue: r.answer.worst_issue,
          }
        : { ok: false, error: r.error, ms: r.ms }
    ),
    judge_label: label,
    judge_model: model,
    reporting_only: product.rubric.reporting_only,
    latency_ms: now() - started,
  }
}
