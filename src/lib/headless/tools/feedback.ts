/**
 * The feedback tools: a colleague's remark about the Loop Creative plugin,
 * filed as an issue in the plugin's repository through Vesper's GitHub App,
 * in the colleague's own name, after they saw the exact text and said yes.
 *
 * The reporter is always the signed-in person (the credential's subject email
 * and the profile's display name), never an argument. The work is in
 * `src/lib/feedback/service.ts`; this file only wires it.
 *
 * Env: FEEDBACK_HMAC_SECRET (signs previews), FEEDBACK_SUBMIT_ENABLED=0 (stops
 * filing), and the App's variables from the creative kit.
 */

import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/prisma'
import { getCreativeKit } from '@/lib/creative/kit-runtime'
import { kitHeader } from '@/lib/creative/tool-views'
import { sharedInstallationTokens } from '@/lib/github/app'
import { githubClient } from '@/lib/github/rest'
import { githubFeedback } from '@/lib/feedback/github-issues'
import { FeedbackRefused, KINDS, MAX_SECTION, MAX_SUMMARY, SURFACES, type FeedbackFields, type Reporter } from '@/lib/feedback/render'
import { PreviewInvalid } from '@/lib/feedback/preview-token'
import { listFeedback, listTargets, previewFeedback, submitFeedback, type FeedbackDeps } from '@/lib/feedback/service'
import { prismaFeedbackStore } from '@/lib/feedback/store-prisma'
import { invalidArguments, type ToolContext, type ToolHandler, type ToolPrincipal } from './types'

// ------------------------------------------------------------------ who is asking

async function emailFromAuth(ownerId: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const { data } = await createClient(url, key).auth.admin.getUserById(ownerId)
    return data?.user?.email ?? null
  } catch {
    return null
  }
}

/** The signed-in person: the OAuth credential's subject email, else the account's email. */
export async function reporterFor(principal: ToolPrincipal, env: NodeJS.ProcessEnv): Promise<Reporter | null> {
  const credential = await prisma.headlessCredential
    .findUnique({
      where: { id: principal.credentialId },
      select: { subjectEmail: true, owner: { select: { displayName: true, username: true } } },
    })
    .catch(() => null)
  const email = credential?.subjectEmail || (await emailFromAuth(principal.ownerId, env))
  if (!email) return null
  const name = credential?.owner?.displayName?.trim() || credential?.owner?.username?.trim() || email.split('@')[0]
  return { profileId: principal.ownerId, name, email }
}

async function productionDeps(ctx: ToolContext, needs: { reporter: boolean }): Promise<FeedbackDeps & { header: ReturnType<typeof kitHeader> }> {
  const loaded = await getCreativeKit({ env: ctx.env })
  const tokens = sharedInstallationTokens(ctx.env)
  return {
    loaded: { kit: loaded.kit, commit: loaded.commit },
    header: kitHeader(loaded),
    github: tokens ? githubFeedback(githubClient({ tokens }), loaded.kit.feedback.repo) : null,
    store: prismaFeedbackStore,
    reporter: needs.reporter ? await reporterFor(ctx.principal, ctx.env) : null,
    credentialId: ctx.principal.credentialId,
    secret: ctx.env.FEEDBACK_HMAC_SECRET,
    submitEnabled: ctx.env.FEEDBACK_SUBMIT_ENABLED !== '0',
    now: () => new Date(),
  }
}

/** A refusal is an answer for Claude to act on, not a server fault. */
async function refusals<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof FeedbackRefused || err instanceof PreviewInvalid) throw new Error(err.message)
    throw err
  }
}

// ------------------------------------------------------------------ arguments

const text = (max: number) => z.string().max(max)

export const FeedbackFieldsSchema = z.object({
  target: z.string().min(1).max(60),
  kind: z.enum(KINDS),
  words: z.string().min(1, 'words: their remark, verbatim').max(MAX_SECTION),
  summary: text(MAX_SUMMARY * 2).optional(),
  what_should_have_happened: text(MAX_SECTION).optional(),
  example: text(MAX_SECTION).optional(),
  links: z.array(z.string().url().regex(/^https:\/\//, 'links are https URLs')).max(10).optional(),
  claudes_reading: text(MAX_SECTION).optional(),
  check: z.string().regex(/^[A-Ea-e]\d+$/, 'a check id such as B3').optional(),
  check_confirmed: z.boolean().optional(),
  output_id: text(80).optional(),
  grade_id: text(80).optional(),
  surface: z.enum(SURFACES).default('chat'),
  plugin_version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  mode: z.enum(['issue', 'comment']).default('issue'),
  issue_number: z.number().int().positive().optional(),
})

const SubmitSchema = FeedbackFieldsSchema.extend({ preview_id: z.string().min(10).max(2000) })

const ListSchema = z.object({
  target: z.string().max(60).optional(),
  state: z.enum(['open', 'closed', 'all']).default('open'),
  query: z.string().max(200).optional(),
  mine: z.boolean().default(false),
})

// ------------------------------------------------------------------ the tools

export const listFeedbackTargetsHandler: ToolHandler = {
  async run(_args, ctx) {
    const loaded = await getCreativeKit({ env: ctx.env })
    const view = listTargets(loaded.kit)
    const lines = view.targets.map(
      (t) =>
        `- ${t.id} (${t.command}, ${t.kind}${t.product ? `, product ${t.product}` : ''})` +
        `${t.checks.length ? `: checks ${t.checks.map((c) => `${c.id}${c.caption ? ` ${c.caption}` : ''}`).join('; ')}` : ''}`
    )
    return {
      content: [
        {
          type: 'text',
          text:
            `What feedback can be about (creative kit ${loaded.kit.version}). Kinds: ${view.kinds.join(', ')}. ` +
            `Surfaces: ${view.surfaces.join(', ')}.\n${lines.join('\n')}\n` +
            'Confirm the target, and the check when the remark is about one, with them before previewing.',
        },
      ],
      structuredContent: { ...kitHeader(loaded), ...view },
    }
  },
}

export const listFeedbackHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = ListSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    return refusals(async () => {
      const deps = await productionDeps(ctx, { reporter: parsed.data.mine })
      const found = await listFeedback(parsed.data, deps)
      const lines = found.issues.map(
        (i) =>
          `#${i.number} [${i.state}${i.triage.length ? `, ${i.triage.join(', ')}` : ''}] ${i.title}` +
          `${i.triage_answer ? `\n    triage: ${i.triage_answer.join(' / ')}` : '\n    triage: no answer yet'}`
      )
      return {
        content: [
          {
            type: 'text',
            text:
              `${found.issues.length ? `Feedback issues in ${found.repo}` : `No feedback issues match in ${found.repo}`}` +
              `${parsed.data.target ? ` for ${parsed.data.target}` : ''} (${parsed.data.state}${parsed.data.mine ? ', filed by you' : ''}):\n` +
              `${lines.join('\n')}${found.more ? '\n(more match; narrow with target or query)' : ''}\n` +
              'The repository is private: the links open only for people with access to it.',
          },
        ],
        structuredContent: { ...deps.header, ...found },
      }
    })
  },
}

export const previewFeedbackHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = FeedbackFieldsSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    return refusals(async () => {
      const deps = await productionDeps(ctx, { reporter: true })
      const p = await previewFeedback(parsed.data as FeedbackFields, deps)
      const r = p.rendered
      const head =
        r.mode === 'issue'
          ? `Title: ${r.title}\nLabels: ${r.labels.join(', ')}`
          : `A comment on issue #${r.issueNumber}, joining it (the remark heard again).`
      const dupes = p.possible_duplicates.length
        ? `\n\nPossibly the same remark, already filed:\n${p.possible_duplicates
            .map((d) => `- #${d.number} [${d.state}] ${d.title} (similarity ${d.score})`)
            .join('\n')}\nIf one says the same thing, preview again with mode 'comment' and that issue_number: a repeat is how a remark reaches its second time.`
        : p.duplicates_checked
          ? ''
          : '\n\n(Earlier issues could not be checked for the same remark.)'
      return {
        content: [
          {
            type: 'text',
            text:
              `Nothing is filed yet. Show them this, exactly, and file it only on a yes, with submit_feedback, ` +
              `preview_id and the same fields. It is filed as ${p.reporter.name} ${p.reporter.email}. The preview lasts until ${p.expires_at}.\n\n` +
              `${head}\n\n${r.body}${dupes}`,
          },
        ],
        structuredContent: {
          ...deps.header,
          preview_id: p.preview_id,
          expires_at: p.expires_at,
          mode: r.mode,
          issue_number: r.issueNumber,
          title: r.title,
          labels: r.labels,
          body: r.body,
          reporter: p.reporter,
          possible_duplicates: p.possible_duplicates,
        },
      }
    })
  },
}

export const submitFeedbackHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = SubmitSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const { preview_id, ...fields } = parsed.data
    return refusals(async () => {
      const deps = await productionDeps(ctx, { reporter: true })
      const s = await submitFeedback(fields as FeedbackFields, preview_id, deps)
      const what =
        s.mode === 'issue'
          ? `Filed as issue #${s.issue_number}${s.already_filed ? ' (it was already filed; nothing new was created)' : ''}.` +
            `${s.labels === 'failed' ? ' The labels could not be added; the triage still reads it, and a maintainer adds them.' : ''}`
          : `Added to issue #${s.issue_number} as the same remark heard again${s.already_filed ? ' (it was already added)' : ''}.`
      return {
        content: [
          {
            type: 'text',
            text:
              `${what} The triage reads it and comments within minutes; the team reads every issue; when the same remark ` +
              'comes back, a change is proposed as a draft and a person decides whether it goes in. ' +
              'The repository is private: the link opens only for people with access to it.',
          },
        ],
        structuredContent: { ...deps.header, ...s },
      }
    })
  },
}
