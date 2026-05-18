/**
 * Git scanning helpers for the Updates auto-generation pipeline.
 *
 * The pipeline never wants to talk to the live database to know "what was the
 * last commit we published?" — that's a chicken/egg with the dev environment
 * (a fresh DB would suddenly think 60 days of commits all need entries). The
 * publish layer handles that with `commit_range_end` + a unique constraint
 * per commit; this module just gives us the raw building blocks.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)

export interface GitCommit {
  sha: string
  shortSha: string
  authorName: string
  authorEmail: string
  /** ISO8601 commit timestamp. */
  date: string
  /** First line of the commit message. */
  subject: string
  /** Full body (multi-line) excluding the subject. */
  body: string
  /** True if this is a merge commit (>1 parent). */
  isMerge: boolean
}

export interface GitCommitWithFiles extends GitCommit {
  /** Files touched by this commit, normalized (path only, no rename info). */
  files: string[]
  /** Lines added across files. */
  additions: number
  /** Lines deleted across files. */
  deletions: number
}

const GIT_LOG_SEP = '<<COMMIT-END>>'
const GIT_LOG_FIELD_SEP = '<<FIELD>>'

/**
 * Run a git command and return stdout. Throws with a useful message on
 * non-zero exit so the caller can short-circuit gracefully.
 */
/**
 * Translate short-form `since` values into a git-acceptable approxidate.
 *   `60d`   → `60.days.ago`
 *   `2w`    → `2.weeks.ago`
 *   `2026-03-01` → unchanged (git understands ISO dates)
 *   `2 weeks ago` → unchanged
 */
function normalizeSince(value: string): string {
  const short = value.trim().match(/^(\d+)\s*(d|w|m|y)$/i)
  if (!short) return value
  const [, n, unit] = short
  const map: Record<string, string> = { d: 'days', w: 'weeks', m: 'months', y: 'years' }
  return `${n}.${map[unit.toLowerCase()] ?? 'days'}.ago`
}

async function git(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileP('git', args, {
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error(`git ${args.join(' ')} failed: ${e.stderr || e.message}`)
  }
}

/**
 * List commits between two refs (or "in the last N days" when `since` is
 * provided). Excludes the merge commit itself from the body by default; we
 * keep merges flagged so the generator can prefer them as natural cluster
 * boundaries when the squash-merge workflow leaves clean PR titles.
 */
export async function listCommits(opts: {
  /** Lower bound (exclusive). E.g. `abc123` or `main~50`. */
  fromRef?: string
  /** Upper bound (inclusive). Defaults to `HEAD`. */
  toRef?: string
  /** Date floor; pass `60d`, `2026-03-01`, etc. */
  since?: string
}): Promise<GitCommit[]> {
  const format = [
    '%H', // full sha
    '%h', // short sha
    '%an',
    '%ae',
    '%aI',
    '%s',
    '%b',
    '%P', // parents
  ].join(GIT_LOG_FIELD_SEP)

  const range = opts.fromRef
    ? `${opts.fromRef}..${opts.toRef ?? 'HEAD'}`
    : opts.toRef ?? 'HEAD'

  const args = [
    'log',
    range,
    `--pretty=format:${format}${GIT_LOG_SEP}`,
    '--no-merges-included-hack', // placeholder, replaced below
  ]
  // We actually want merges so the generator can use PR squash titles, but
  // we still want to know when something *is* a merge. Drop the placeholder.
  args.pop()

  if (opts.since) {
    args.push(`--since=${normalizeSince(opts.since)}`)
  }

  const raw = await git(args)
  if (!raw.trim()) return []

  return raw
    .split(GIT_LOG_SEP)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, shortSha, authorName, authorEmail, date, subject, body, parents] =
        entry.split(GIT_LOG_FIELD_SEP)
      const parentCount = (parents || '').split(/\s+/).filter(Boolean).length
      return {
        sha,
        shortSha,
        authorName,
        authorEmail,
        date,
        subject: (subject || '').trim(),
        body: (body || '').trim(),
        isMerge: parentCount > 1,
      } satisfies GitCommit
    })
}

/**
 * Decorate commits with their touched files + line counts. Done in a single
 * pass via `git log --numstat` so we don't shell out once per commit. Keeps
 * the script fast even for 60-day windows with 200+ commits.
 */
export async function listCommitsWithFiles(opts: {
  fromRef?: string
  toRef?: string
  since?: string
}): Promise<GitCommitWithFiles[]> {
  const commits = await listCommits(opts)
  if (commits.length === 0) return []

  const range = opts.fromRef
    ? `${opts.fromRef}..${opts.toRef ?? 'HEAD'}`
    : opts.toRef ?? 'HEAD'

  // Reuse the same range/since so the two passes match exactly. Format with a
  // unique commit header line we can split on.
  const args = ['log', range, '--numstat', '--format=__COMMIT__%H']
  if (opts.since) args.push(`--since=${normalizeSince(opts.since)}`)

  const raw = await git(args)
  const filesBySha = new Map<string, { files: string[]; additions: number; deletions: number }>()

  let currentSha: string | null = null
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue
    if (line.startsWith('__COMMIT__')) {
      currentSha = line.slice('__COMMIT__'.length).trim()
      if (!filesBySha.has(currentSha)) {
        filesBySha.set(currentSha, { files: [], additions: 0, deletions: 0 })
      }
      continue
    }
    if (!currentSha) continue
    // numstat lines: "<adds>\t<dels>\t<path>" (binary files show "-")
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const adds = Number(parts[0])
    const dels = Number(parts[1])
    const filePath = parts[2]
    const bucket = filesBySha.get(currentSha)!
    bucket.files.push(filePath)
    if (Number.isFinite(adds)) bucket.additions += adds
    if (Number.isFinite(dels)) bucket.deletions += dels
  }

  return commits.map((c) => {
    const stats = filesBySha.get(c.sha) ?? { files: [], additions: 0, deletions: 0 }
    return { ...c, ...stats }
  })
}

/** Most recent commit on the current branch. Used to bound publish ranges. */
export async function currentHead(): Promise<string> {
  const out = await git(['rev-parse', 'HEAD'])
  return out.trim()
}

/**
 * Slice a list of commits into "release-shaped" clusters.
 *
 * The clustering is intentionally simple: we cut whenever the gap between
 * two consecutive commits exceeds `maxGapHours`, and we additionally cap
 * each cluster at `maxClusterSize` commits so a busy day doesn't collapse
 * into a single mega-entry.
 *
 * Returned in newest-first order (matching git log output).
 */
export function clusterCommits(
  commits: GitCommitWithFiles[],
  opts: { maxGapHours?: number; maxClusterSize?: number } = {}
): GitCommitWithFiles[][] {
  if (commits.length === 0) return []
  const maxGapMs = (opts.maxGapHours ?? 24) * 60 * 60 * 1000
  const maxSize = opts.maxClusterSize ?? 40

  const clusters: GitCommitWithFiles[][] = []
  let current: GitCommitWithFiles[] = [commits[0]]

  for (let i = 1; i < commits.length; i++) {
    const prev = commits[i - 1]
    const next = commits[i]
    const prevTs = new Date(prev.date).getTime()
    const nextTs = new Date(next.date).getTime()
    const gap = Math.abs(prevTs - nextTs)
    if (gap > maxGapMs || current.length >= maxSize) {
      clusters.push(current)
      current = []
    }
    current.push(next)
  }
  if (current.length) clusters.push(current)
  return clusters
}
