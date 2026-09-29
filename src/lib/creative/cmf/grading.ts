/**
 * Vesper's read of a CMF render against its sheet row and its clown: the CMF grader's words from
 * the creative kit, THE ROW and THE KEY that the repository's CMF script built for that tab, column
 * and key (`kit/cmf-grading.json`), the candidate first and the clown second, three reads, the
 * kit's ladder. A port of `assemble_cmf_grading_prompt` in the plugin repository's `tools/kit.py`,
 * held to every CMF fixture in the kit's conformance file.
 *
 * Vesper measures nothing on the pixels, so the prompt carries the kit's one no-measurement line
 * where `qa.py` would give the zone measurements: a Vesper CMF grade is weaker than the
 * repository's `qa x3` on leftover clown colour, and says what it is. While the rubric is reporting
 * only, every result says so.
 */

import crypto from 'crypto'
import type { Kit, KitProduct } from '../kit-schema'
import type { PinRow, PinSpec } from '../pins'
import { kitPins, usablePin } from '../pins'
import { fillText, GradingPromptError } from '../grading-prompt'
import { aggregateReads, readAnswer, type ReadResult } from '../aggregate'
import { GRADE_DEADLINE_MS, judgeLabel, MAX_RUNS, READ_TIMEOUT_MS, type AttachedReference, type Candidate, type GradeDeps, type GradeOutcome } from '../grade'
import type { GeminiPart } from '../gemini'
import { CmfError, resolveKey, type CmfGradingParts, type CmfKit } from './kit-cmf'

export interface CmfGradeInputs {
  spec: string
  column: string
  key: string | null
}

type Words = Record<string, unknown>

function w(T: Words, key: string): string {
  const v = T[key]
  if (typeof v !== 'string') throw new GradingPromptError(`the kit's CMF grading words lack '${key}'`)
  return v
}

/** The prompt, from the kit alone; refuses a column or key the parts file does not carry. */
export function assembleCmfGradingPrompt(product: KitProduct, parts: CmfGradingParts, inputs: CmfGradeInputs): string {
  const gp = product.grading_prompt
  if (!gp) throw new GradingPromptError(`the kit carries no CMF grader yet`)
  const T = gp.text as Words
  const rules = gp.rules
  const measured = gp.measurement_lines_without_code
  if (typeof rules !== 'string' || !Array.isArray(measured)) {
    throw new GradingPromptError("the kit's CMF grading words lack the rules or the no-measurement line")
  }
  const rowKey = `${inputs.spec}--${inputs.column}`
  const row = parts.rows[rowKey]
  if (!row) throw new CmfError(`THE ROW for ${inputs.spec} column ${inputs.column} is not in the kit: the column is not in scope (its Product Name is not filled)`)
  let keyLines: string[]
  if (inputs.key) {
    const k = parts.keys[`${rowKey}--${inputs.key}`]
    if (!k) throw new CmfError(`THE KEY for ${inputs.key} on ${inputs.spec} column ${inputs.column} is not in the kit`)
    keyLines = k.key_lines
  } else {
    keyLines = parts.no_key_lines
  }
  const p: string[] = [w(T, 'intro'), '', w(T, 'roles'), w(T, 'grade_only'), '']
  p.push(...row.row_lines, '', ...keyLines, '', w(T, 'measurements_heading'))
  for (const line of measured) p.push(fillText(w(T, 'measurement_item'), { line }))
  p.push('', w(T, 'rules_heading'), rules, '', w(T, 'strict'), w(T, 'notes_rule'), '')
  // THE CHECKS and the JSON line, as for every grader in the kit.
  p.push(w(T, 'checks_heading'))
  const checks = product.rubric.checks
  for (const c of checks) p.push(fillText(w(T, 'check'), { id: c.id, severity: c.severity, check: c.check, fails_when: c.fails_when }))
  const ids = checks.map((c) => fillText(w(T, 'json_id'), { id: c.id })).join(w(T, 'json_id_separator'))
  p.push('', w(T, 'json_intro'), fillText(w(T, 'json'), { ids: `{${ids}}` }))
  return p.join('\n')
}

export interface CmfGradeRequest {
  kit: Kit
  cmf: CmfKit
  parts: CmfGradingParts
  candidate: Candidate
  spec: string
  column: string
  key: string
  runs?: number
}

/** The tab's spec slug, the column and the key checked against the kit; the refusals by name. */
export function checkCmfTarget(cmf: CmfKit, parts: CmfGradingParts, spec: string, column: string, keyId: string): { tab: string; skuName: string | null } {
  const s = cmf.specs[spec]
  if (!s) throw new CmfError(`no CMF tab '${spec}' in the kit`)
  resolveKey(cmf, s, keyId)
  const inScope = Object.values(parts.rows).filter((r) => r.spec === spec)
  if (inScope.length === 0) {
    throw new CmfError(`${s.tab ?? spec} has no SKU in scope (no Product Name filled), so there is no row to grade a render against`)
  }
  const row = parts.rows[`${spec}--${column}`]
  if (!row) {
    throw new CmfError(`${s.tab ?? spec} column ${column} is not in scope; in scope: ${inScope.map((r) => r.column).sort().join(', ')}`)
  }
  return { tab: row.tab, skuName: row.sku_name }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Three reads of one render, candidate then clown then the prompt; the kit's rules make one grade. */
export async function gradeCmfCandidate(req: CmfGradeRequest, deps: GradeDeps): Promise<GradeOutcome> {
  const now = deps.now ?? Date.now
  const started = now()
  const product = req.cmf.product
  if (!product.grading_prompt || !product.grading) throw new GradingPromptError('the kit carries no CMF grader yet')
  const { skuName } = checkCmfTarget(req.cmf, req.parts, req.spec, req.column, req.key)
  const key = req.cmf.keys[req.key]
  const runs = Math.max(1, Math.min(MAX_RUNS, req.runs ?? product.grading.runs ?? 3))

  const prompt = assembleCmfGradingPrompt(product, req.parts, { spec: req.spec, column: req.column, key: req.key })

  // The clown: the kit's pin for the key's clown, used only when its bytes are the kit's.
  const references: AttachedReference[] = []
  const missing: Array<{ role: string; why: string }> = []
  const clownParts: Array<() => Promise<GeminiPart>> = []
  const clown = key.clown
  const spec: PinSpec | undefined = clown ? kitPins(req.kit).find((p) => p.product === req.cmf.slug && p.pinId === clown.id && p.sha256 === clown.sha256) : undefined
  const row: PinRow | undefined = spec ? deps.pinRows.find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256) : undefined
  if (!clown || !spec) {
    throw new CmfError(`the clown key '${req.key}' names no clown with a sha256 in the kit`)
  }
  if (clown.sha256 === req.candidate.sha256) throw new CmfError('the picture under review is the clown itself')
  if (!row || !usablePin(row, spec)) {
    throw new CmfError(`the clown ${clown.id} is not pinned yet (an admin syncs the pins); a CMF render is never graded without its clown`)
  }
  references.push({ n: 2, pin_id: clown.id, title: clown.id, role: 'clown', colourway: null, sha256: clown.sha256 })
  clownParts.push(() => deps.pinPart(row, spec))

  const parts: GeminiPart[] = [await deps.candidatePart(req.candidate)]
  for (const make of clownParts) parts.push(await make())
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
    view: 'clown',
    view_assumed: false,
    colourway: skuName,
    claim: null,
    claim_source: null,
    references,
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
  }
}
