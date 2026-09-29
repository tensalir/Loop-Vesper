/**
 * Three reads become one grade, the way the creative kit says (`judges`):
 *
 * - a check fails when more than half the reads fail it (two of three, three of five);
 * - a check a read did not answer counts as failed in that read;
 * - an erred read fails every check;
 * - when more than half the reads erred, the result is ERROR and no verdict is given;
 * - the verdict is the kit's ladder over the failed checks, advisory failures reported apart;
 * - the majority of the per-read verdicts is reported too, with `unstable` when no verdict has a
 *   majority (then the worst is shown), because the two can differ: three reads each failing a
 *   different minor check pass by check majority and pass with notes by verdict majority.
 *
 * A read's answer is read the way the product's `qa.py` reads it (`grade_rubric`): a boolean, or
 * the text "true"; anything else, and anything missing, fails.
 */

import { verdictFromKit, type KitLadder, type LadderCheck, type Verdict } from './ladder'

export interface ReadAnswer {
  checks: Record<string, boolean>
  unanswered: string[]
  reads_as: string
  cup_section: string
  view_class: string | null
  asset_class: string | null
  colourway_read: string | null
  worst_issue: string
  notes: string
}

export type ReadResult =
  | { ok: true; model: string; answer: ReadAnswer; ms: number }
  | { ok: false; error: string; ms: number }

/** One read's JSON, as `qa.grade_rubric` reads it. */
export function readAnswer(raw: unknown, checks: readonly LadderCheck[]): ReadAnswer {
  const out = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const given = (out.checks && typeof out.checks === 'object' ? out.checks : {}) as Record<string, unknown>
  const graded: Record<string, boolean> = {}
  const unanswered: string[] = []
  for (const c of checks) {
    const has = Object.prototype.hasOwnProperty.call(given, c.id)
    const v = given[c.id]
    graded[c.id] = has ? (typeof v === 'boolean' ? v : String(v).trim().toLowerCase() === 'true') : false
    if (!has) unanswered.push(c.id)
  }
  const s = (k: string, max: number) => String(out[k] ?? '').trim().slice(0, max)
  return {
    checks: graded,
    unanswered,
    reads_as: s('reads_as', 200),
    cup_section: s('cup_section', 400),
    view_class: out.view_class ? s('view_class', 40).toLowerCase().replace(/ /g, '_') : null,
    asset_class: out.asset_class ? s('asset_class', 40).toLowerCase().replace(/ /g, '_') : null,
    colourway_read: out.colourway_read ? s('colourway_read', 40) : null,
    worst_issue: s('worst_issue', 200),
    notes: s('notes', 600),
  }
}

export interface Aggregate {
  status: 'graded' | 'ERROR'
  reads: number
  errors: number
  /** Check id → how many reads failed it (an erred read fails every check). */
  fails: Record<string, number>
  /** Counted failures, a majority of reads, in rubric order. */
  failed: string[]
  /** Advisory failures, a majority of reads: reported, never counted. */
  failed_advisory: string[]
  verdict: Verdict | 'ERROR'
  per_read_verdicts: Array<Verdict | 'ERROR'>
  verdict_majority: Verdict | 'ERROR'
  unstable: boolean
  unanswered: Record<string, number>
  models: string[]
}

function majorityVerdict(verdicts: Verdict[], ladder: KitLadder): { verdict: Verdict | 'ERROR'; unstable: boolean } {
  if (verdicts.length === 0) return { verdict: 'ERROR', unstable: false }
  const counts = new Map<Verdict, number>()
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1)
  let top: Verdict | null = null
  let k = 0
  for (const [v, n] of Array.from(counts.entries())) {
    if (n > k) {
      top = v
      k = n
    }
  }
  if (top && k > verdicts.length / 2) return { verdict: top, unstable: false }
  // No majority: the worst answer, so a draw the grader could not settle is a finding.
  const worst = [...verdicts].sort((a, b) => ladder.rank.indexOf(b) - ladder.rank.indexOf(a))[0]
  return { verdict: worst, unstable: true }
}

export function aggregateReads(
  results: readonly ReadResult[],
  checks: readonly LadderCheck[],
  ladder: KitLadder
): Aggregate {
  const n = results.length
  const errors = results.filter((r) => !r.ok).length
  const fails: Record<string, number> = {}
  const unanswered: Record<string, number> = {}
  for (const c of checks) fails[c.id] = 0
  const perRead: Array<Verdict | 'ERROR'> = []
  const models: string[] = []
  for (const r of results) {
    if (!r.ok) {
      for (const c of checks) fails[c.id] += 1
      perRead.push('ERROR')
      continue
    }
    models.push(r.model)
    const failedHere: string[] = []
    for (const c of checks) {
      if (!r.answer.checks[c.id]) {
        fails[c.id] += 1
        failedHere.push(c.id)
      }
    }
    for (const id of r.answer.unanswered) unanswered[id] = (unanswered[id] ?? 0) + 1
    perRead.push(verdictFromKit(ladder, checks, failedHere))
  }
  const severity = new Map(checks.map((c) => [c.id, c.severity]))
  const majority = checks.filter((c) => fails[c.id] > n / 2).map((c) => c.id)
  const failed = majority.filter((id) => !ladder.ignore.includes(severity.get(id)!))
  const failed_advisory = majority.filter((id) => ladder.ignore.includes(severity.get(id)!))
  const graded = perRead.filter((v): v is Verdict => v !== 'ERROR')
  const byVerdict = majorityVerdict(graded, ladder)
  if (n === 0 || errors > n / 2) {
    return {
      status: 'ERROR',
      reads: n,
      errors,
      fails,
      failed,
      failed_advisory,
      verdict: 'ERROR',
      per_read_verdicts: perRead,
      verdict_majority: 'ERROR',
      unstable: false,
      unanswered,
      models,
    }
  }
  return {
    status: 'graded',
    reads: n,
    errors,
    fails,
    failed,
    failed_advisory,
    verdict: verdictFromKit(ladder, checks, majority),
    per_read_verdicts: perRead,
    verdict_majority: byVerdict.verdict,
    unstable: byVerdict.unstable,
    unanswered,
    models,
  }
}
