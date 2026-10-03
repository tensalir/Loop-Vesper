/**
 * Where the prompt rewrite's system prompt comes from, in one place.
 *
 * Order, first available wins:
 *   1. the creative kit (the Loop edition of the prompting skill, released
 *      from the plugin repository at its newest ai-studio-design-v* or
 *      studio-design-v* tag; null when Vesper's GitHub App is not configured
 *      or no kit can be read);
 *   2. an active `prompt_enhancement_prompts` row for the model (the admin
 *      hot-patch, as before);
 *   3. the bundled skill file `src/lib/skills/genai-prompting.skill.md`;
 *   4. a generic fallback.
 *
 * Before this change step 3 silently failed in production: the file was
 * never traced into the serverless bundle, so every enhancement ran on the
 * fallback. `next.config.js` now traces the skills folder.
 *
 * Every prompting text Claude meets goes through here: enhance_prompt,
 * iterate_prompt, the MCP prompts (vesper:generate, vesper:enhance,
 * vesper:iterate), the vesper://skill/genai-prompting resource, and since
 * 2026-10-01 Vesper's own in-app assistant and brainstorm chat. None of them
 * reads a prompting skill file itself, and `tests/prompting-guard.spec.ts`
 * fails if one does. Until 2026-10-01 iterate ran on the bundled file and the MCP
 * prompts and resource fell back to `src/lib/skills/genai-prompting/SKILL.md`,
 * a generic copy, after the generic skill had been taken out of Loop's
 * Claude organisation.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { loadSkill, type Skill } from '@/lib/skills/registry'
import { githubAppConfigFromEnv } from '@/lib/github/app'
import type { SkillVersion } from './skill-version'

export const FALLBACK_SYSTEM_PROMPT = `You are an expert AI prompt engineer. Your job is to make user prompts for generative AI models clearer.

**CRITICAL INSTRUCTION**: Return ONLY the prompt text. Do NOT include explanations, versions, reasons, or any other text. Just the prompt itself.

## Guidelines
- Clarify ambiguous elements
- Keep the original tone, style and intent
- Don't add unnecessary complexity
- Don't force "best practices" that contradict intent

## Response Format
Return ONLY the prompt text. Nothing else.`

export type PromptingSourceKind = 'kit' | 'db' | 'bundled' | 'fallback'

export interface PromptingSettings {
  temperature?: number
  maxTokens?: number
}

export interface PromptingSource {
  text: string
  source: PromptingSourceKind
  /** sha256 of `text` (utf-8), hex. */
  sha256: string
  /** Kit version, skill file mtime, or the override's update time. */
  version: string | null
  /** The override row's id when `source` is 'db'. */
  id: string | null
  /** Only the kit sets these; otherwise callers keep their own defaults. */
  settings?: PromptingSettings
}

export interface KitPrompting {
  text: string
  version: string
  sha256?: string
  settings?: PromptingSettings
}

export type KitPromptingLoader = () => Promise<KitPrompting | null>

/**
 * The kit first: the Loop edition of the prompting skill, from the creative
 * kit at the plugin's release tag. Loaded lazily and only when Vesper's GitHub
 * App is configured, so nothing here reaches GitHub or the database otherwise.
 */
const defaultKitLoader: KitPromptingLoader = async () => {
  if (!githubAppConfigFromEnv()) return null
  const { loadKitPrompting } = await import('@/lib/creative/kit-runtime')
  return loadKitPrompting()
}

let kitLoader: KitPromptingLoader = defaultKitLoader

/** Wired by the creative-kit module; tests may set it too. */
export function setKitPromptingLoader(loader: KitPromptingLoader): void {
  kitLoader = loader
}

export function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

export type OverrideLookup = (modelId: string) => Promise<{ id: string; systemPrompt: string; updatedAt?: Date } | null>

const lookupOverride: OverrideLookup = async (modelId) => {
  try {
    return await prisma.promptEnhancementPrompt.findFirst({
      where: { modelIds: { has: modelId }, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, systemPrompt: true, updatedAt: true },
    })
  } catch {
    // Table may not exist on older schemas: fall through.
    return null
  }
}

export interface PromptingSourceOptions {
  /** The admin override is for the Enhance flow; iterate and slates skip it. */
  allowDbOverride?: boolean
  /** Injected for tests. */
  override?: OverrideLookup
  bundled?: () => { text: string; lastModified: Date } | null
}

const loadBundled = (): { text: string; lastModified: Date } | null => {
  const skill = loadSkill('genai-prompting')
  return skill?.content ? { text: skill.content, lastModified: skill.lastModified } : null
}

export async function getPromptingSystemPrompt(
  modelId: string,
  options: PromptingSourceOptions = {}
): Promise<PromptingSource> {
  const kit = await kitLoader().catch(() => null)
  if (kit?.text) {
    return {
      text: kit.text,
      source: 'kit',
      sha256: kit.sha256 ?? sha256Hex(kit.text),
      version: kit.version,
      id: null,
      settings: kit.settings,
    }
  }

  if (options.allowDbOverride !== false) {
    const row = await (options.override ?? lookupOverride)(modelId)
    if (row?.systemPrompt) {
      return {
        text: row.systemPrompt,
        source: 'db',
        sha256: sha256Hex(row.systemPrompt),
        version: row.updatedAt ? row.updatedAt.toISOString() : null,
        id: row.id,
      }
    }
  }

  const bundled = (options.bundled ?? loadBundled)()
  if (bundled?.text) {
    return {
      text: bundled.text,
      source: 'bundled',
      sha256: sha256Hex(bundled.text),
      version: bundled.lastModified.toISOString(),
      id: null,
    }
  }

  return {
    text: FALLBACK_SYSTEM_PROMPT,
    source: 'fallback',
    sha256: sha256Hex(FALLBACK_SYSTEM_PROMPT),
    version: null,
    id: null,
  }
}

/**
 * The prompting skill for Claude to read (the MCP prompts and resource):
 * the same order, without the admin override, which is one model's rewrite
 * instruction and not the skill.
 */
export function getPromptingSkillForClaude(
  options: Pick<PromptingSourceOptions, 'bundled'> = {}
): Promise<PromptingSource> {
  return getPromptingSystemPrompt('', { ...options, allowDbOverride: false })
}

/**
 * The prompting skill as a section of Vesper's own chats (the in-app assistant and the brainstorm
 * chat), beside their own skill: from `getPromptingSkillForClaude`, so the Loop edition from the
 * kit first. Until 2026-10-01 both chats read the bundled file. Null when only the generic
 * fallback is left: that text is a rewrite instruction ("Return ONLY the prompt text") and would
 * turn a chat into a prompt rewriter, so the chat runs on its own skill alone, as it did when the
 * bundled file was missing.
 */
export function promptingSkillForChat(source: PromptingSource): Skill | null {
  if (source.source === 'fallback' || !source.text) return null
  return {
    id: 'genai-prompting',
    metadata: { name: 'genai-prompting' },
    content: source.text,
    path: `prompting-source:${source.source}`,
    lastModified: new Date(0),
  }
}

/** The skill version reported with every result, read from the source that actually ran. */
export function skillVersionFromSource(source: PromptingSource): SkillVersion {
  return {
    skillId: source.source === 'db' ? `prompt-override:${source.id}` : 'genai-prompting',
    hash: source.sha256.slice(0, 12),
    lastModified: source.version ?? new Date(0).toISOString(),
    source: source.source,
  }
}

/** One line for Claude naming which prompting text it is reading, and saying so when it is not the kit's. */
export function describePromptingSource(source: Pick<PromptingSource, 'source' | 'version' | 'id'>): string {
  switch (source.source) {
    case 'kit':
      return `Prompting skill: the Loop edition, ${source.version ?? 'version unknown'}, from the creative kit (the text get_creative_kit section prompting returns). It replaces any generic prompting skill.`
    case 'db':
      return `Prompting skill: the creative kit could not be read, so this is an admin override of the rewrite instruction (row ${source.id ?? '?'}, ${source.version ?? 'undated'}), not the Loop edition. Tell the person the kit is unavailable.`
    case 'bundled':
      // No date: the file's mtime on a deployment is the build's, not the skill's.
      return "Prompting skill: the creative kit could not be read, so this is Vesper's bundled copy of the prompting skill, which may be older than the Loop edition. Tell the person the kit is unavailable."
    case 'fallback':
      return "Prompting skill: the creative kit could not be read and Vesper has no bundled copy, so this is its short generic fallback instruction, not the Loop edition. Tell the person the kit is unavailable."
  }
}
