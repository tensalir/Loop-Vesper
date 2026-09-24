/**
 * Where the prompt rewrite's system prompt comes from, in one place.
 *
 * Order, first available wins:
 *   1. the creative kit (the Loop edition of the prompting skill, released
 *      from the plugin repository; wired in by the kit change, null until then);
 *   2. an active `prompt_enhancement_prompts` row for the model (the admin
 *      hot-patch, as before);
 *   3. the bundled skill file `src/lib/skills/genai-prompting.skill.md`;
 *   4. a generic fallback.
 *
 * Before this change step 3 silently failed in production: the file was
 * never traced into the serverless bundle, so every enhancement ran on the
 * fallback. `next.config.js` now traces the skills folder.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { loadSkill } from '@/lib/skills/registry'

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

let kitLoader: KitPromptingLoader = async () => null

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
