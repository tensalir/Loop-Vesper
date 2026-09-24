/**
 * The issue a colleague's remark becomes, exactly as the plugin describes it
 * (`plugin-src/skills/feedback/references/issue.md` in
 * tensalir/loop-asset-reviewer) and exactly as its triage reads it
 * (`tools/feedback_triage.py`: the author is Vesper's app, the marker is
 * there, and the one fenced json block after it validates against
 * `kit/feedback-issue.schema.json`).
 *
 * Pure: the same fields, the same person, the same kit commit and the same
 * time give the same bytes. `submit_feedback` relies on it: it renders again
 * and files only when the hash equals the one it previewed.
 */

import crypto from 'node:crypto'
import type { Kit } from '@/lib/creative/kit-schema'
import { cap, clean, firstWords, neutralise, oneLine } from './text'

export const FEEDBACK_MARKER = '<!-- loop-creative-feedback v1 -->'
export const TITLE_PREFIX = '[feedback]'
export const MAX_SUMMARY = 80
export const MAX_TITLE = 120
export const MAX_SECTION = 4000
export const MAX_BODY = 20000
export const KINDS = ['remark', 'bug', 'idea', 'question'] as const
export const SURFACES = ['chat', 'cowork', 'code'] as const
const FENCE = '`'.repeat(3)

export type FeedbackKind = (typeof KINDS)[number]
export type FeedbackSurface = (typeof SURFACES)[number]

/** What the caller gives: the colleague's remark and Claude's reading of it. */
export interface FeedbackFields {
  target: string
  kind: FeedbackKind
  words: string
  summary?: string
  what_should_have_happened?: string
  example?: string
  links?: string[]
  claudes_reading?: string
  check?: string
  check_confirmed?: boolean
  output_id?: string
  grade_id?: string
  surface: FeedbackSurface
  plugin_version?: string
  mode: 'issue' | 'comment'
  issue_number?: number
}

/** Who files it: the signed-in person, never an argument. */
export interface Reporter {
  profileId: string
  name: string
  email: string
}

/** What the preview fixes so the submission renders the same bytes. */
export interface Pinned {
  askedAt: string
  kitCommit: string | null
  pluginVersion: string
}

export interface RenderedFeedback {
  mode: 'issue' | 'comment'
  issueNumber: number | null
  title: string | null
  labels: string[]
  body: string
  block: Record<string, unknown>
  /** sha256 of the canonical payload the preview id signs. */
  hash: string
}

export class FeedbackRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedbackRefused'
  }
}

type Target = Kit['feedback']['targets'][number]

export function findTarget(kit: Kit, id: string): Target {
  const target = kit.feedback.targets.find((t) => t.id === id)
  if (!target) {
    throw new FeedbackRefused(
      `'${id}' is not something feedback can be about. The targets are: ${kit.feedback.targets.map((t) => t.id).join(', ')}.`
    )
  }
  return target
}

/** The target's rubric checks, when it is a product or a workstream. */
export function targetChecks(kit: Kit, target: Target): Array<{ id: string; caption: string | null }> {
  const slug = (target as { product?: string | null }).product
  const product = slug ? (kit.products as Record<string, { rubric?: { checks?: Array<{ id: string; caption?: string | null }> } }>)[slug] : undefined
  return (product?.rubric?.checks ?? []).map((c) => ({ id: c.id, caption: c.caption ?? null }))
}

function labelsFor(kit: Kit, fields: FeedbackFields, target: Target): string[] {
  const l = kit.feedback.labels
  const kind = `kind:${fields.kind}`
  if (!l.kind.includes(kind)) throw new FeedbackRefused(`The repository has no label ${kind}.`)
  if (!l.skill.includes(target.label)) throw new FeedbackRefused(`The repository has no label ${target.label}.`)
  return [l.all, kind, target.label, l.new]
}

function section(heading: string, text: string): string {
  return `### ${heading}\n${cap(text, MAX_SECTION)}`
}

/** The issue, or the comment that joins an earlier issue, for these fields. */
export function renderFeedback(kit: Kit, fields: FeedbackFields, reporter: Reporter, pinned: Pinned): RenderedFeedback {
  const target = findTarget(kit, fields.target)
  const checks = targetChecks(kit, target)
  const check = fields.check?.trim().toUpperCase() || null
  if (check && checks.length && !checks.some((c) => c.id === check)) {
    throw new FeedbackRefused(`${check} is not a check of ${target.id}'s rubric. Its checks are ${checks.map((c) => c.id).join(', ')}.`)
  }
  if (fields.mode === 'comment' && !fields.issue_number) {
    throw new FeedbackRefused('A remark that joins an earlier issue needs that issue_number.')
  }
  const confirmed = Boolean(check && fields.check_confirmed)
  const words = clean(fields.words).trim()
  const should = clean(fields.what_should_have_happened).trim()
  const example = clean(fields.example).trim()
  const reading = clean(fields.claudes_reading).trim()
  const links = (fields.links ?? []).map((u) => u.trim()).filter(Boolean)

  const exampleLines = [...links.map((u) => `- ${neutralise(u)}`), ...(example ? [neutralise(example)] : [])]
  const caption = check ? checks.find((c) => c.id === check)?.caption : null
  const readingLines = [
    reading ? neutralise(reading) : 'none given',
    ...(check
      ? [`Check: ${check}${caption ? `, ${neutralise(caption)}` : ''} (${confirmed ? 'confirmed by the reporter' : 'not yet confirmed by the reporter'}).`]
      : []),
  ]
  const commit7 = pinned.kitCommit ? pinned.kitCommit.slice(0, 7) : 'unknown'
  const where = [
    `- Plugin: creative ${pinned.pluginVersion} (kit ${commit7}) · Skill: ${target.skill} · Surface: ${fields.surface} · Date: ${pinned.askedAt.slice(0, 10)}`,
    ...(fields.output_id || fields.grade_id
      ? [`- Vesper: ${[fields.output_id ? `output ${neutralise(fields.output_id)}` : '', fields.grade_id ? `grade ${neutralise(fields.grade_id)}` : ''].filter(Boolean).join(', ')}`]
      : []),
  ]

  const block: Record<string, unknown> = {
    schema: 1,
    target: target.id,
    kind: fields.kind,
    check: confirmed ? check : null,
    check_confirmed: confirmed,
    words: cap(words, MAX_SECTION),
    what_should_have_happened: should ? cap(should, MAX_SECTION) : null,
    example: example ? cap(example, MAX_SECTION) : null,
    claudes_reading: reading ? cap(reading, MAX_SECTION) : null,
    links,
    reporter: { name: reporter.name, email: reporter.email, profile_id: reporter.profileId },
    plugin_version: pinned.pluginVersion,
    kit_commit: pinned.kitCommit,
    surface: fields.surface,
    asked_at: pinned.askedAt,
    joins: fields.mode === 'comment' ? fields.issue_number ?? null : null,
    ...(fields.output_id || fields.grade_id
      ? { vesper: { output_id: fields.output_id ?? null, grade_id: fields.grade_id ?? null } }
      : {}),
  }

  const body = cap(
    [
      section('What happened', neutralise(words)),
      section('What should have happened', should ? neutralise(should) : 'not said'),
      section('Example', exampleLines.length ? exampleLines.join('\n') : 'none given'),
      section("Claude's reading", readingLines.join('\n')),
      section('Where', where.join('\n')),
      section('Reported by', `${neutralise(oneLine(reporter.name))} ${reporter.email} via Vesper`),
    ].join('\n\n'),
    MAX_BODY - 2000
  ) + `\n\n${FEEDBACK_MARKER}\n${FENCE}json\n${JSON.stringify(block, null, 1)}\n${FENCE}\n`

  const summary = firstWords(neutralise(fields.summary?.trim() ? fields.summary : words), MAX_SUMMARY)
  const title = fields.mode === 'issue' ? cap(`${TITLE_PREFIX} ${target.id}: ${summary}`, MAX_TITLE) : null
  const labels = fields.mode === 'issue' ? labelsFor(kit, fields, target) : []
  const issueNumber = fields.mode === 'comment' ? fields.issue_number ?? null : null
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ mode: fields.mode, issue_number: issueNumber, title, labels, body }))
    .digest('hex')
  return { mode: fields.mode, issueNumber, title, labels, body, block, hash }
}
