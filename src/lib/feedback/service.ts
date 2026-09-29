/**
 * Feedback from Claude to the plugin's repository: what can be reported on,
 * what was reported, the exact issue before filing, and filing it on a yes.
 *
 * Everything outside is passed in (the kit, GitHub, the store, the signed-in
 * person, the clock), so `tests/feedback.spec.ts` runs it all without a
 * network. The tool handlers in `src/lib/headless/tools/feedback.ts` wire the
 * production pieces.
 */

import type { Kit } from '@/lib/creative/kit-schema'
import type { FeedbackGithub, GhIssue } from './github-issues'
import { FEEDBACK_MARKER, FeedbackRefused, findTarget, renderFeedback, targetChecks, type FeedbackFields, type Pinned, type RenderedFeedback, type Reporter } from './render'
import { PREVIEW_TTL_MS, pinnedFrom, signPreview, verifyPreview } from './preview-token'
import type { FeedbackStore, NewPreview } from './store'
import { findSecret, oneLine } from './text'

export const LIMITS = { previewsPerHour: 20, filedPerHour: 5, filedPerDay: 20 } as const
export const MAX_LISTED = 15
const TRIAGE_BOT = 'github-actions[bot]'
const TRIAGE_MARK = /<!-- triage:\d+:[^>]*-->/
const HOUR = 60 * 60 * 1000

export interface FeedbackKit {
  kit: Kit
  commit: string | null
}

export interface FeedbackDeps {
  loaded: FeedbackKit
  github: FeedbackGithub | null
  store: FeedbackStore
  /** The signed-in person; null when Vesper cannot say who is asking. */
  reporter: Reporter | null
  credentialId: string | null
  secret: string | undefined
  submitEnabled: boolean
  now: () => Date
}

function needGithub(deps: FeedbackDeps): FeedbackGithub {
  if (!deps.github) {
    throw new FeedbackRefused(
      "Vesper cannot reach the plugin's repository: its GitHub App is not set up. Give them the exact issue text to send to the plugin's maintainer instead."
    )
  }
  return deps.github
}

function needReporter(deps: FeedbackDeps): Reporter {
  if (!deps.reporter) {
    throw new FeedbackRefused(
      'Vesper does not know who you are for this connection, so it cannot put your name and Loop email on the issue. Connect Vesper in Claude with your own Vesper login, then try again.'
    )
  }
  return deps.reporter
}

function needSecret(deps: FeedbackDeps): string {
  if (!deps.secret || deps.secret.length < 16) {
    throw new FeedbackRefused('Vesper cannot sign a preview: FEEDBACK_HMAC_SECRET is not set. An admin sets it.')
  }
  return deps.secret
}

function refuseSecrets(fields: FeedbackFields): void {
  const found = findSecret({
    words: fields.words,
    summary: fields.summary,
    what_should_have_happened: fields.what_should_have_happened,
    example: fields.example,
    claudes_reading: fields.claudes_reading,
    links: fields.links ?? [],
    output_id: fields.output_id,
    grade_id: fields.grade_id,
  })
  if (found) {
    throw new FeedbackRefused(
      `Nothing was previewed: '${found.field}' holds something shaped like ${found.pattern}. The value is not repeated here. ` +
        'Take it out, tell them it was left out (and that a key pasted into a chat should be rotated), then preview again.'
    )
  }
}

function pinnedNow(deps: FeedbackDeps, fields: FeedbackFields): Pinned {
  const commit = deps.loaded.commit && /^[0-9a-f]{7,40}$/.test(deps.loaded.commit) ? deps.loaded.commit : null
  const version = fields.plugin_version?.trim() || deps.loaded.kit.version
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new FeedbackRefused(`'${version}' is not a plugin version (like 0.2.0).`)
  return { askedAt: deps.now().toISOString(), kitCommit: commit, pluginVersion: version }
}

// ------------------------------------------------------------------ targets

export function listTargets(kit: Kit) {
  return {
    kinds: kit.feedback.kinds,
    surfaces: kit.feedback.surfaces,
    title: kit.feedback.title,
    targets: kit.feedback.targets.map((t) => ({
      id: t.id,
      skill: t.skill,
      command: t.command,
      kind: t.kind,
      product: (t as { product?: string | null }).product ?? null,
      label: t.label,
      checks: targetChecks(kit, t),
    })),
  }
}

// ------------------------------------------------------------------ reading what was filed

const STOP = new Set(['the', 'and', 'for', 'was', 'with', 'that', 'this', 'not', 'but', 'are', 'from', 'when', 'what', 'have', 'has', 'its', 'too', 'feedback'])

function words(text: string): Set<string> {
  return new Set(
    oneLine(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  )
}

export function similarity(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return 0
  let both = 0
  for (const w of Array.from(x)) if (y.has(w)) both += 1
  return both / (x.size + y.size - both)
}

/** The data block of an issue Vesper filed, or null. */
export function blockOf(body: string | null): Record<string, unknown> | null {
  const text = (body ?? '').replace(/\r\n/g, '\n')
  const i = text.indexOf(FEEDBACK_MARKER)
  if (i < 0) return null
  const m = /^`{3}json[ \t]*\n([\s\S]*?)\n`{3}[ \t]*$/m.exec(text.slice(i + FEEDBACK_MARKER.length))
  if (!m) return null
  try {
    const data = JSON.parse(m[1])
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The first lines of the triage's latest answer on an issue, or null. */
export function triageAnswer(comments: Array<{ body: string; user_login: string; created_at: string }>, lines = 5): string[] | null {
  const answers = comments
    .filter((c) => c.user_login === TRIAGE_BOT && TRIAGE_MARK.test(c.body))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const last = answers[answers.length - 1]
  if (!last) return null
  return last.body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, lines)
}

export interface ListFeedbackArgs {
  target?: string
  state: 'open' | 'closed' | 'all'
  query?: string
  mine?: boolean
}

export async function listFeedback(args: ListFeedbackArgs, deps: FeedbackDeps) {
  const gh = needGithub(deps)
  const kit = deps.loaded.kit
  const target = args.target ? findTarget(kit, args.target) : null
  const labels = [kit.feedback.labels.all, ...(target ? [target.label] : [])]
  let issues: GhIssue[]
  if (args.query?.trim()) {
    const q = [
      `repo:${gh.repo}`,
      'is:issue',
      ...labels.map((l) => `label:"${l}"`),
      ...(args.state !== 'all' ? [`state:${args.state}`] : []),
      oneLine(args.query).replace(/"/g, ''),
    ].join(' ')
    issues = await gh.searchIssues(q, 30)
  } else {
    issues = await gh.listIssues({ labels, state: args.state, perPage: 30 })
  }
  issues = issues.filter((i) => !i.is_pull_request)
  if (args.mine) {
    const me = needReporter(deps).email.toLowerCase()
    issues = issues.filter((i) => {
      const reporter = blockOf(i.body)?.reporter as { email?: string } | undefined
      return reporter?.email?.toLowerCase() === me
    })
  }
  const out = []
  for (const i of issues.slice(0, MAX_LISTED)) {
    const comments = await gh.listComments(i.number)
    out.push({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels,
      triage: i.labels.filter((l) => l.startsWith('triage:')),
      created_at: i.created_at,
      updated_at: i.updated_at,
      url: i.html_url,
      triage_answer: triageAnswer(comments),
    })
  }
  return { repo: gh.repo, issues: out, more: issues.length > MAX_LISTED }
}

// ------------------------------------------------------------------ preview

export interface PreviewResult {
  preview_id: string
  expires_at: string
  rendered: RenderedFeedback
  reporter: { name: string; email: string }
  possible_duplicates: Array<{ number: number; title: string; state: string; score: number }>
  duplicates_checked: boolean
}

function toPreviewRow(deps: FeedbackDeps, fields: FeedbackFields, rendered: RenderedFeedback, reporter: Reporter): NewPreview {
  return {
    previewHash: rendered.hash,
    profileId: reporter.profileId,
    credentialId: deps.credentialId,
    repo: deps.loaded.kit.feedback.repo,
    mode: rendered.mode,
    issueNumber: rendered.issueNumber,
    title: rendered.title,
    labels: rendered.labels,
    target: fields.target,
    kind: fields.kind,
    surface: fields.surface,
  }
}

async function checkJoinable(gh: FeedbackGithub, n: number): Promise<void> {
  const issue = await gh.getIssue(n)
  if (!issue || issue.is_pull_request) throw new FeedbackRefused(`There is no issue #${n} in the plugin's repository.`)
  if (!issue.title.startsWith('[feedback]') && !issue.labels.includes('feedback')) {
    throw new FeedbackRefused(`Issue #${n} is not a feedback issue, so a remark cannot join it.`)
  }
}

export async function previewFeedback(fields: FeedbackFields, deps: FeedbackDeps): Promise<PreviewResult> {
  const reporter = needReporter(deps)
  const secret = needSecret(deps)
  refuseSecrets(fields)
  const now = deps.now()
  const recent = await deps.store.countPreviewsSince(reporter.profileId, new Date(now.getTime() - HOUR))
  if (recent >= LIMITS.previewsPerHour) {
    throw new FeedbackRefused(`That is ${recent} previews in the last hour, the most Vesper makes for one person. Try again later.`)
  }
  if (fields.mode === 'comment') {
    if (!fields.issue_number) throw new FeedbackRefused('A remark that joins an earlier issue needs that issue_number.')
    await checkJoinable(needGithub(deps), fields.issue_number)
  }
  const pinned = pinnedNow(deps, fields)
  const rendered = renderFeedback(deps.loaded.kit, fields, reporter, pinned)

  let duplicates: PreviewResult['possible_duplicates'] = []
  let checked = false
  if (fields.mode === 'issue' && deps.github) {
    const target = findTarget(deps.loaded.kit, fields.target)
    const issues = await deps.github
      .listIssues({ labels: [deps.loaded.kit.feedback.labels.all, target.label], state: 'all', perPage: 30 })
      .catch(() => null)
    if (issues) {
      checked = true
      const mine = `${rendered.title ?? ''} ${fields.words}`
      duplicates = issues
        .filter((i) => !i.is_pull_request)
        .map((i) => {
          const theirs = `${i.title} ${(blockOf(i.body)?.words as string | undefined) ?? ''}`
          return { number: i.number, title: i.title, state: i.state, score: Math.round(similarity(mine, theirs) * 100) / 100 }
        })
        .filter((d) => d.score >= 0.25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
    }
  }

  const expires = now.getTime() + PREVIEW_TTL_MS
  const preview_id = signPreview(secret, {
    h: rendered.hash,
    r: reporter.profileId,
    e: expires,
    t: pinned.askedAt,
    k: pinned.kitCommit,
    v: pinned.pluginVersion,
  })
  await deps.store.recordPreview(toPreviewRow(deps, fields, rendered, reporter), now)
  return {
    preview_id,
    expires_at: new Date(expires).toISOString(),
    rendered,
    reporter: { name: reporter.name, email: reporter.email },
    possible_duplicates: duplicates,
    duplicates_checked: checked,
  }
}

// ------------------------------------------------------------------ submit

export interface SubmitResult {
  mode: 'issue' | 'comment'
  issue_number: number
  state: string
  url: string | null
  comment_id: number | null
  labels: 'added' | 'failed' | 'none'
  already_filed: boolean
}

export async function submitFeedback(fields: FeedbackFields, previewId: string, deps: FeedbackDeps): Promise<SubmitResult> {
  if (!deps.submitEnabled) {
    throw new FeedbackRefused('Filing feedback is switched off on this Vesper (FEEDBACK_SUBMIT_ENABLED=0). Give them the exact issue text to send instead.')
  }
  const gh = needGithub(deps)
  const reporter = needReporter(deps)
  const secret = needSecret(deps)
  const now = deps.now()
  const claims = verifyPreview(secret, previewId, reporter.profileId, now.getTime())
  refuseSecrets(fields)
  const rendered = renderFeedback(deps.loaded.kit, fields, reporter, pinnedFrom(claims))
  if (rendered.hash !== claims.h) {
    throw new FeedbackRefused('The text changed since the preview, so nothing was filed. Preview again and show them the new text.')
  }
  const row = toPreviewRow(deps, fields, rendered, reporter)

  const claim = await deps.store.claim(row, now)
  if (claim.state === 'done') {
    const r = claim.record
    return {
      mode: r.mode,
      issue_number: r.issueNumber ?? 0,
      state: 'filed',
      url: null,
      comment_id: r.commentId,
      labels: r.status === 'labels_failed' ? 'failed' : r.mode === 'issue' ? 'added' : 'none',
      already_filed: true,
    }
  }
  if (claim.state === 'busy') {
    throw new FeedbackRefused('This remark is being filed by another call right now. Wait a moment, then look for it with list_feedback.')
  }

  const hour = await deps.store.countFiledSince(reporter.profileId, new Date(now.getTime() - HOUR))
  const day = await deps.store.countFiledSince(reporter.profileId, new Date(now.getTime() - 24 * HOUR))
  if (hour >= LIMITS.filedPerHour || day >= LIMITS.filedPerDay) {
    await deps.store.finish(rendered.hash, { status: 'failed', error: 'limit' }, now)
    throw new FeedbackRefused(
      `That is ${hour} filed in the last hour and ${day} today, the most Vesper files for one person (${LIMITS.filedPerHour} an hour, ${LIMITS.filedPerDay} a day). Try again later.`
    )
  }

  try {
    if (rendered.mode === 'comment') {
      const c = await gh.createComment(rendered.issueNumber!, rendered.body)
      await deps.store.finish(rendered.hash, { status: 'filed', issueNumber: rendered.issueNumber, commentId: c.id, filedAt: now }, now)
      return { mode: 'comment', issue_number: rendered.issueNumber!, state: 'filed', url: c.html_url, comment_id: c.id, labels: 'none', already_filed: false }
    }
    const issue = await gh.createIssue(rendered.title!, rendered.body)
    let labels: SubmitResult['labels'] = 'added'
    try {
      await gh.addLabels(issue.number, rendered.labels)
    } catch {
      try {
        for (const l of rendered.labels) await gh.createLabel(l)
        await gh.addLabels(issue.number, rendered.labels)
      } catch {
        labels = 'failed'
      }
    }
    await deps.store.finish(
      rendered.hash,
      { status: labels === 'failed' ? 'labels_failed' : 'filed', issueNumber: issue.number, filedAt: now },
      now
    )
    return { mode: 'issue', issue_number: issue.number, state: issue.state, url: issue.html_url, comment_id: null, labels, already_filed: false }
  } catch (err) {
    await deps.store.finish(rendered.hash, { status: 'failed', error: (err as Error)?.message?.slice(0, 500) ?? 'failed' }, now)
    throw err
  }
}
