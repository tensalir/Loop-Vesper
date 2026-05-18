/**
 * LLM generator that turns a cluster of git commits into a non-technical,
 * user-facing release note.
 *
 * Calls Claude with a strict prompt + JSON-only response shape. The pipeline
 * validates the response against `UpdateSnippet[]` and falls back to a
 * deterministic, conservative summary when the LLM is unavailable or the
 * response is malformed — we never want a release to disappear because the
 * API was down.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { GitCommitWithFiles } from './git'
import type { UpdateSnippet, UpdateSnippetTag } from './types'
import { parseSnippets } from './types'

const DEFAULT_GENERATOR_MODEL = 'claude-sonnet-4-5-20250929'
const MAX_TOKENS = 1500

const SYSTEM_PROMPT = `You write product release notes for Vesper, an internal generative-AI workspace for the Loop Earplugs creative team. Readers are designers, content creators, and PMs who use the tool every day. They are NOT engineers.

Your job: turn a list of git commits into a short, friendly "What's New" entry the user can scan in 15 seconds.

STYLE RULES:
- Plain language. No git/infra/code jargon. Never mention files, components, classes, APIs, types, hooks, refactors, migrations, indexes, refactoring, types, schemas, or stack names.
- Lead with the user benefit, not the implementation. "Iterate on an existing image without losing the product" not "Added soft prompt enhancement for image quick-edit flow".
- Friendly and direct. Use second person ("You can now…") where natural.
- Keep snippets short: max 1–2 sentences each.
- Skip purely internal changes. If a cluster is mostly chores, return at most a single "Behind-the-scenes improvements" note, or fewer.

OUTPUT FORMAT:
Return STRICTLY valid JSON, no prose before or after, in this exact shape:

{
  "title": "string (max 80 chars, no period)",
  "summary": "string (one sentence, max 180 chars)",
  "snippets": [
    { "label": "string (max 50 chars)", "body": "string (max 220 chars)", "tag": "new|improved|fix|note" }
  ]
}

Snippet count: 2–5 entries. Use "tag" liberally — most entries are "new" or "improved"; "fix" for bug fixes; "note" only for the rare informational item.`

function buildUserPrompt(commits: GitCommitWithFiles[], userVisibleFiles: string[]): string {
  const commitLines = commits
    .map((c) => {
      const lines = [`- ${c.subject}`]
      if (c.body) {
        const indented = c.body
          .split(/\r?\n/)
          .filter(Boolean)
          .slice(0, 6)
          .map((line) => `    ${line.trim()}`)
          .join('\n')
        if (indented) lines.push(indented)
      }
      return lines.join('\n')
    })
    .join('\n')

  const fileSummary = userVisibleFiles.length
    ? userVisibleFiles.slice(0, 30).join('\n')
    : '(no user-facing files; cluster likely internal)'

  return `Here is a cluster of commits that landed together. Write the release note as instructed.

Commits (most recent first):
${commitLines}

User-facing files touched (for context, not for inclusion in copy):
${fileSummary}

Return only the JSON object.`
}

export interface GeneratedUpdate {
  title: string
  summary: string
  snippets: UpdateSnippet[]
  /** Provider that produced this entry; `fallback` means the deterministic path. */
  source: 'llm' | 'fallback'
}

interface RawLLMResponse {
  title?: unknown
  summary?: unknown
  snippets?: unknown
}

function coerceTag(value: unknown): UpdateSnippetTag | undefined {
  if (value === 'new' || value === 'improved' || value === 'fix' || value === 'note') return value
  return undefined
}

function tightenString(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1).trimEnd() + '…'
}

function parseLLMJson(raw: string): { title: string; summary: string; snippets: UpdateSnippet[] } | null {
  // The model is asked for JSON only; still defensively strip code fences and
  // leading/trailing prose because models sometimes ignore instructions.
  let text = raw.trim()
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) text = fenceMatch[1].trim()
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1)
  }
  try {
    const parsed = JSON.parse(text) as RawLLMResponse
    const title = tightenString(parsed.title, 80)
    const summary = tightenString(parsed.summary, 180)
    if (!title || !summary) return null

    const rawSnippets = Array.isArray(parsed.snippets) ? parsed.snippets : []
    const snippets: UpdateSnippet[] = []
    for (const entry of rawSnippets) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as { label?: unknown; body?: unknown; tag?: unknown }
      const label = tightenString(e.label, 50)
      const body = tightenString(e.body, 220)
      if (!label || !body) continue
      const tag = coerceTag(e.tag)
      snippets.push(tag ? { label, body, tag } : { label, body })
    }
    if (snippets.length === 0) return null
    return { title, summary, snippets }
  } catch {
    return null
  }
}

/**
 * Last-resort summary built without an LLM. Picks the cluster's clearest
 * user-visible commit subjects and packages them in the standard shape so
 * the pipeline never silently drops a release.
 */
function buildFallback(commits: GitCommitWithFiles[]): GeneratedUpdate {
  const subjects = commits
    .map((c) => c.subject.replace(/^\[?[a-z0-9-]+\]?\s*[:-]\s*/i, '').trim())
    .filter((s) => s.length > 0)
  const date = commits[0] ? new Date(commits[0].date).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  }) : ''

  const title = date ? `Updates from ${date}` : 'Latest updates'
  const summary = subjects[0] || 'Small improvements landed.'

  const snippets: UpdateSnippet[] = subjects.slice(0, 5).map((s) => {
    const lower = s.toLowerCase()
    const tag: UpdateSnippetTag = /^fix|bug|crash/.test(lower)
      ? 'fix'
      : /^add|new|launch|ship/.test(lower)
      ? 'new'
      : 'improved'
    return {
      label: s.length > 50 ? s.slice(0, 49) + '…' : s,
      body: 'See change history for details.',
      tag,
    }
  })

  return { title, summary, snippets, source: 'fallback' }
}

export interface GenerateOptions {
  /** Override the default Anthropic model id. */
  model?: string
  /** When true, skip the network call and return the deterministic summary. */
  forceFallback?: boolean
}

export async function generateUpdate(
  commits: GitCommitWithFiles[],
  userVisibleFiles: string[],
  opts: GenerateOptions = {}
): Promise<GeneratedUpdate> {
  if (opts.forceFallback || !process.env.ANTHROPIC_API_KEY) {
    return buildFallback(commits)
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model: opts.model || DEFAULT_GENERATOR_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserPrompt(commits, userVisibleFiles),
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === 'text') as
      | { type: 'text'; text: string }
      | undefined
    if (!textBlock) return buildFallback(commits)

    const parsed = parseLLMJson(textBlock.text)
    if (!parsed) return buildFallback(commits)

    // Re-validate snippets via the shared parser so the publish layer can trust
    // the shape downstream.
    const snippets = parseSnippets(parsed.snippets)
    if (snippets.length === 0) return buildFallback(commits)

    return {
      title: parsed.title,
      summary: parsed.summary,
      snippets,
      source: 'llm',
    }
  } catch (err) {
    console.warn('[updates] LLM generation failed, using fallback:', (err as Error).message)
    return buildFallback(commits)
  }
}
