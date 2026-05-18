/**
 * Significance scoring for the Updates auto-pipeline.
 *
 * Goal: decide whether a cluster of commits is "user-visible enough" to
 * publish a `ProductUpdate`. Returns a 0–1 score; the publish layer skips
 * anything below a configurable threshold (default 0.45).
 *
 * Heuristics, by category, with rough weight reasoning:
 *
 *   1. UI/feature surface area — touches to `src/app/(dashboard)`,
 *      `src/components`, `src/app/api`, generation/CMF surfaces.
 *   2. Internal-only noise — `.next`, `node_modules`, `.cursor/plans`,
 *      `docs/`, `prisma/migrations` alone, configs, lockfiles.
 *   3. Volume — number of unique files + total changed lines.
 *   4. Keyword signal — "add", "implement", "fix bug", "feature", "ship",
 *      "now you can". Subtractive on "wip", "draft", "refactor only".
 *
 * Tuned conservatively so the auto path errs toward "skip publish" when
 * unsure. The 60-day backfill flag (`backfilled=true`) lets the historical
 * pass loosen this if needed.
 */

import type { GitCommitWithFiles } from './git'

const USER_VISIBLE_PATHS = [
  /^src\/app\/\(dashboard\)\//,
  /^src\/app\/projects\//,
  /^src\/app\/product\//,
  /^src\/app\/review\//,
  /^src\/app\/analytics\//,
  /^src\/app\/api\//,
  /^src\/components\//,
  /^src\/hooks\//,
  /^src\/lib\/(prompts|skills|models|cmf|generation)\//,
]

const NOISE_PATHS = [
  /^\.next\//,
  /^node_modules\//,
  /^\.cursor\//,
  /^\.github\/(?!workflows\/).*/,
  /^docs\//,
  /^public\//,
  /package-lock\.json$/,
  /\.lock$/,
  /\.gitignore$/,
  /\.prettierrc/,
  /\.eslintrc/,
]

const POSITIVE_KEYWORDS = [
  /\badd(ed|s|ing)?\b/i,
  /\bimplement(ed|s|ing)?\b/i,
  /\bship(ped|s|ping)?\b/i,
  /\blaunch(ed|es|ing)?\b/i,
  /\benable(d|s|ing)?\b/i,
  /\bfix(ed|es|ing)?\b/i,
  /\bimprove(d|s|ment)?\b/i,
  /\bredesign(ed|s)?\b/i,
  /\bnew\b/i,
  /\bfeature\b/i,
  /\bnow you can\b/i,
]

const NEGATIVE_KEYWORDS = [
  /\bwip\b/i,
  /\bdraft\b/i,
  /\bchore\b/i,
  /\bbump\b/i,
  /\btypo\b/i,
  /\brevert\b/i,
  /\bformat(ting)?\b/i,
]

function isUserVisible(filePath: string): boolean {
  return USER_VISIBLE_PATHS.some((re) => re.test(filePath))
}

function isNoise(filePath: string): boolean {
  return NOISE_PATHS.some((re) => re.test(filePath))
}

export interface SignificanceResult {
  /** 0–1 confidence the cluster is worth publishing to users. */
  score: number
  /** Diagnostic breakdown for the CLI/logs. */
  reasons: string[]
  /** Files we considered user-visible. Drives generator focus. */
  userVisibleFiles: string[]
}

export function scoreCluster(commits: GitCommitWithFiles[]): SignificanceResult {
  const reasons: string[] = []
  const allFiles = new Set<string>()
  const userVisibleFiles = new Set<string>()
  let totalAdditions = 0
  let totalDeletions = 0

  for (const commit of commits) {
    totalAdditions += commit.additions
    totalDeletions += commit.deletions
    for (const file of commit.files) {
      if (isNoise(file)) continue
      allFiles.add(file)
      if (isUserVisible(file)) userVisibleFiles.add(file)
    }
  }

  if (allFiles.size === 0) {
    return { score: 0, reasons: ['no non-noise files'], userVisibleFiles: [] }
  }

  // Component 1: UI/feature surface fraction (0–0.5)
  const userVisibleFraction = userVisibleFiles.size / allFiles.size
  const surfaceScore = Math.min(0.5, userVisibleFraction * 0.6)
  reasons.push(
    `surface=${surfaceScore.toFixed(2)} (${userVisibleFiles.size}/${allFiles.size} user-visible files)`
  )

  // Component 2: Volume bonus, capped (0–0.2). Tiny patches stay tiny; huge
  // sweeping changes don't get unbounded credit.
  const volume = Math.min(1, (allFiles.size + (totalAdditions + totalDeletions) / 50) / 20)
  const volumeScore = volume * 0.2
  reasons.push(
    `volume=${volumeScore.toFixed(2)} (${allFiles.size} files, +${totalAdditions}/-${totalDeletions} lines)`
  )

  // Component 3: Keyword sentiment (-0.15 to +0.3)
  let keywordScore = 0
  let positives = 0
  let negatives = 0
  for (const commit of commits) {
    const text = `${commit.subject}\n${commit.body}`
    for (const re of POSITIVE_KEYWORDS) if (re.test(text)) positives++
    for (const re of NEGATIVE_KEYWORDS) if (re.test(text)) negatives++
  }
  keywordScore = Math.min(0.3, positives * 0.05) - Math.min(0.15, negatives * 0.04)
  reasons.push(
    `keywords=${keywordScore.toFixed(2)} (+${positives} positive / -${negatives} negative hits)`
  )

  // Component 4: Merge-commit bonus. A squash/merge commit usually carries a
  // PR title that the generator can lean on for clean copy.
  const mergeBonus = commits.some((c) => c.isMerge) ? 0.05 : 0
  reasons.push(`merges=${mergeBonus.toFixed(2)}`)

  const score = Math.max(0, Math.min(1, surfaceScore + volumeScore + keywordScore + mergeBonus))

  return {
    score,
    reasons,
    userVisibleFiles: Array.from(userVisibleFiles),
  }
}
