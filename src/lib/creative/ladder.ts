/**
 * The verdict ladder, read from the creative kit.
 *
 * A port of `verdict_from_kit` in the plugin repository's `tools/kit.py`. The
 * kit carries the ladder as data (`kit.ladder`) so Vesper holds no copy of
 * it; the kit's conformance vectors (every single and pair of failures, for
 * every product) are run against this function before a kit is used.
 */

export const SEVERITIES = ['gate', 'critical', 'minor', 'advisory'] as const
export type Severity = (typeof SEVERITIES)[number]
export const VERDICTS = ['PASS', 'PASS_WITH_NOTES', 'RETRY', 'FAIL'] as const
export type Verdict = (typeof VERDICTS)[number]

export interface KitLadder {
  ignore: Severity[]
  unknown_severity: Severity
  rules: Array<{ severity: Severity; at_least: number; verdict: Verdict }>
  otherwise: Verdict
  rank: Verdict[]
}

export interface LadderCheck {
  id: string
  severity: Severity
}

/** The verdict for a set of failed check ids: the first rule whose severity has enough counted failures. */
export function verdictFromKit(ladder: KitLadder, checks: readonly LadderCheck[], failed: readonly string[]): Verdict {
  const severity = new Map(checks.map((c) => [c.id, c.severity]))
  const counted = failed
    .map((id) => severity.get(id) ?? ladder.unknown_severity)
    .filter((s) => !ladder.ignore.includes(s))
  for (const rule of ladder.rules) {
    if (counted.filter((s) => s === rule.severity).length >= rule.at_least) {
      return rule.verdict
    }
  }
  return ladder.otherwise
}
