/**
 * Vesper's read of a packaging picture: the packaging grader's words from the creative kit, the
 * candidate first, then the cell's pictures in the kit's grade plan (the composite built in code,
 * the white render, the dieline, the front panel), three reads, the kit's ladder. A port of
 * `assemble_packaging_grading_prompt` in the plugin repository's `tools/kit.py`, held to every
 * packaging fixture in the kit's conformance file.
 *
 * The packaging grader's words are new: the rounds were judged by Claude through the skill, never by
 * a script. The kit marks them uncalibrated (`grading.calibration`), and every result says so beside
 * the verdict until the kit drops the note.
 */

import crypto from 'crypto'
import type { Kit, KitProduct } from '../kit-schema'
import type { PinRow, PinSpec } from '../pins'
import { kitPins, usablePin } from '../pins'
import { fillText, GradingPromptError, type MissingReference } from '../grading-prompt'
import { aggregateReads, readAnswer, type ReadResult } from '../aggregate'
import { GRADE_DEADLINE_MS, judgeLabel, MAX_RUNS, READ_TIMEOUT_MS, type AttachedReference, type Candidate, type GradeDeps, type GradeOutcome } from '../grade'
import type { GeminiPart } from '../gemini'
import { cellKey, gradePlanFor, PackagingError, type Cell, type PackagingKit } from './kit-packaging'

type Words = Record<string, unknown>

function w(T: Words, key: string): string {
  const v = T[key]
  if (typeof v !== 'string') throw new GradingPromptError(`the kit's packaging grading words lack '${key}'`)
  return v
}

export interface PackagingPromptInputs {
  look: string
  box: string
  colourway: string
  /** In the order the pictures follow the candidate. */
  attached: Array<{ role: string }>
  missing: MissingReference[]
}

/** The prompt, from the kit alone. */
export function assemblePackagingGradingPrompt(product: KitProduct, inputs: PackagingPromptInputs): string {
  const gp = product.grading_prompt as (KitProduct['grading_prompt'] & Words) | null
  if (!gp) throw new GradingPromptError('the kit carries no packaging grader yet')
  const T = gp.text as Words
  const roles = (T.roles ?? {}) as Record<string, string>
  const p: string[] = [w(T, 'intro'), '', w(T, 'candidate')]
  inputs.attached.forEach((ref, i) => {
    p.push(fillText(w(T, 'reference'), { n: i + 2, role: roles[ref.role] ?? w(T, 'role_default') }))
  })
  p.push(w(T, 'references_are_real'))
  if (inputs.missing.length) {
    const items = inputs.missing.map((m) => fillText(w(T, 'missing_item'), { role: m.role, why: m.why })).join(w(T, 'missing_separator'))
    p.push(fillText(w(T, 'missing'), { items }))
  }
  const words = ((gp.colourway_words ?? {}) as Record<string, Record<string, string>>)[inputs.look]?.[inputs.colourway]
  if (typeof words !== 'string') {
    throw new GradingPromptError(`the kit's packaging grader names no colours for ${inputs.look} ${inputs.colourway}`)
  }
  const sheet = gp.sheet
  const rules = gp.rules
  if (typeof sheet !== 'string' || typeof rules !== 'string') {
    throw new GradingPromptError("the kit's packaging grading words lack the product sheet or the rules")
  }
  p.push(
    '',
    fillText(w(T, 'cell'), { look: inputs.look, box: inputs.box, colourway: inputs.colourway, colourway_words: words }),
    '',
    w(T, 'product_heading'),
    sheet,
    '',
    w(T, 'rules_heading'),
    rules,
    '',
    w(T, 'not_measured'),
    '',
    w(T, 'strict'),
    ''
  )
  // THE CHECKS and the JSON line, as for every grader in the kit.
  p.push(w(T, 'checks_heading'))
  const checks = product.rubric.checks
  for (const c of checks) p.push(fillText(w(T, 'check'), { id: c.id, severity: c.severity, check: c.check, fails_when: c.fails_when }))
  const ids = checks.map((c) => fillText(w(T, 'json_id'), { id: c.id })).join(w(T, 'json_id_separator'))
  p.push('', w(T, 'json_intro'), fillText(w(T, 'json'), { ids: `{${ids}}` }))
  return p.join('\n')
}

/** The cell's composite, when the picture under review is not the composite itself. */
export interface CellComposite {
  outputId: string
  sha256: string
  bytes: Buffer
  mimeType: string
}

export interface PackagingGradeRequest {
  kit: Kit
  pk: PackagingKit
  cell: Cell
  candidate: Candidate
  /** The mockup of this cell built in code; required unless the candidate is that composite. */
  composite: CellComposite | null
  runs?: number
}

export interface PackagingGradeOutcome extends GradeOutcome {
  calibration: string | null
  cell: Cell
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Three reads of one packaging picture: the candidate, then the cell's pictures in the grade plan's
 * order (a picture not pinned yet is left out and named), then the prompt.
 */
export async function gradePackagingCandidate(req: PackagingGradeRequest, deps: GradeDeps): Promise<PackagingGradeOutcome> {
  const now = deps.now ?? Date.now
  const started = now()
  const product = req.pk.product
  if (!product.grading_prompt || !product.grading) throw new GradingPromptError('the kit carries no packaging grader yet')
  const runs = Math.max(1, Math.min(MAX_RUNS, req.runs ?? product.grading.runs ?? 3))
  const plan = gradePlanFor(req.pk, req.cell)
  const specs = new Map(kitPins(req.kit).filter((s) => s.product === req.pk.slug).map((s) => [s.pinId, s]))
  const rows = new Map(deps.pinRows.map((r) => [`${r.pinId}@${r.sha256}`, r]))

  const attached: AttachedReference[] = []
  const makeParts: Array<() => Promise<GeminiPart>> = []
  const missing: MissingReference[] = []
  const isComposite = req.composite === null
  for (const entry of plan) {
    if (entry.pin === null) {
      if (isComposite) {
        missing.push({ role: entry.role, why: 'it is the picture under review' })
        continue
      }
      const c = req.composite!
      if (c.sha256 === req.candidate.sha256) {
        missing.push({ role: entry.role, why: 'it is the picture under review' })
        continue
      }
      attached.push({ n: 0, pin_id: `composite:${c.outputId}`, title: `the mockup of ${cellKey(req.cell)}`, role: entry.role, colourway: req.cell.colourway, sha256: c.sha256 })
      makeParts.push(() => deps.candidatePart({ bytes: c.bytes, mimeType: c.mimeType, sha256: c.sha256 }))
      continue
    }
    const spec: PinSpec | undefined = specs.get(entry.pin)
    if (!spec) {
      missing.push({ role: entry.role, why: 'not a pin with a sha256 in the kit' })
      continue
    }
    if (spec.sha256 === req.candidate.sha256) {
      missing.push({ role: entry.role, why: 'it is the picture under review' })
      continue
    }
    const row: PinRow | undefined = rows.get(`${spec.pinId}@${spec.sha256}`)
    if (!row || !usablePin(row, spec)) {
      missing.push({ role: entry.role, why: row?.status === 'needs_upload' ? 'an admin has not uploaded it yet' : 'not pinned yet' })
      continue
    }
    attached.push({ n: 0, pin_id: spec.pinId, title: spec.title, role: entry.role, colourway: req.cell.colourway, sha256: spec.sha256 })
    makeParts.push(() => deps.pinPart(row, spec))
  }
  attached.forEach((a, i) => (a.n = i + 2))

  const prompt = assemblePackagingGradingPrompt(product, {
    look: req.cell.look,
    box: req.cell.box,
    colourway: req.cell.colourway,
    attached: attached.map((a) => ({ role: a.role })),
    missing,
  })

  const parts: GeminiPart[] = [await deps.candidatePart(req.candidate)]
  for (const make of makeParts) parts.push(await make())
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
    view: `${req.cell.box} box`,
    view_assumed: false,
    colourway: req.cell.colourway,
    claim: null,
    claim_source: null,
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
            worst_issue: r.answer.worst_issue,
          }
        : { ok: false, error: r.error, ms: r.ms }
    ),
    judge_label: label,
    judge_model: model,
    reporting_only: product.rubric.reporting_only || product.grading.reporting_only === true,
    latency_ms: now() - started,
    calibration: req.pk.calibration,
    cell: req.cell,
  }
}

/** Throws unless a picture of this cell can be graded: the composite is required for any picture but itself. */
export function requireComposite(hasComposite: boolean, candidateIsComposite: boolean, cell: Cell): void {
  if (!hasComposite && !candidateIsComposite) {
    throw new PackagingError(
      `no mockup of ${cellKey(cell)} is recorded for you yet, and a packaging picture is graded against its cell's composite: run packaging_mockup (look ${cell.look}, box ${cell.box}, colourway ${cell.colourway}) first`
    )
  }
}
