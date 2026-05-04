/**
 * Reusable Andromeda-aware iteration slate service.
 *
 * Returns a structured JSON slate of variant prompts that preserve declared
 * anchors while varying 2-3 diversification axes. Used by the cookie-auth
 * UI route and the bearer-token headless route.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getSkillSystemPrompt } from '@/lib/skills/registry'
import { getModelConfig } from '@/lib/models/registry'
import { getSkillVersion, type SkillVersion } from './skill-version'

const DEFAULT_PROMPT_ITERATE_MODEL = 'claude-sonnet-4-5-20250929'

export interface IterateAnchors {
  product?: string
  offer?: string
  audience?: string
  brand?: string
  lockedText?: string
  theme?: string
}

export interface IteratePromptInput {
  prompt: string
  modelId: string
  referenceImage?: string
  baselineOutputId?: string
  anchors?: IterateAnchors
  variantCount?: number
  lockedAxes?: string[]
  preferredAxes?: string[]
}

export interface IterationVariant {
  label: string
  axis: Record<string, string>
  prompt: string
  preserve: string[]
  change: string[]
  whyDifferentEnough: string
}

export interface IterationSlate {
  theme: string
  anchors: IterateAnchors
  axesVaried: string[]
  weakChangesAvoided: string[]
  variants: IterationVariant[]
}

export interface IteratePromptResult {
  slate: IterationSlate
  raw: string
  variantCount: number
  modelId: string
  enhancementModel: string
  skill: SkillVersion | null
}

function safeJsonParse(text: string): unknown | null {
  const cleaned = text
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/\n?```$/gm, '')
    .trim()

  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null
  }
  const candidate = cleaned.slice(firstBrace, lastBrace + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function isIterationSlate(value: unknown): value is IterationSlate {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.theme !== 'string') return false
  if (!v.anchors || typeof v.anchors !== 'object') return false
  if (!Array.isArray(v.axesVaried)) return false
  if (!Array.isArray(v.variants)) return false
  return v.variants.every((variant) => {
    if (!variant || typeof variant !== 'object') return false
    const c = variant as Record<string, unknown>
    return (
      typeof c.label === 'string' &&
      typeof c.prompt === 'string' &&
      typeof c.whyDifferentEnough === 'string' &&
      Array.isArray(c.preserve) &&
      Array.isArray(c.change)
    )
  })
}

interface MessageContentImage {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
interface MessageContentText {
  type: 'text'
  text: string
}
type MessageContent = MessageContentImage | MessageContentText

function buildMessageContent(
  userMessage: string,
  referenceImage?: string
): MessageContent[] {
  const content: MessageContent[] = []
  if (referenceImage) {
    const [dataUrlPrefix, base64Data] = referenceImage.split(',')
    const mediaTypeMatch = dataUrlPrefix.match(/data:([^;]+)/)
    const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : 'image/jpeg'
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64Data || '' },
    })
  }
  content.push({ type: 'text', text: userMessage })
  return content
}

/**
 * Build the iteration slate for the given prompt and anchors. Throws on
 * upstream errors and on schema-validation failures so the caller can
 * map them to the right HTTP status (502 / 422 / 429).
 */
export async function iteratePrompt(
  input: IteratePromptInput
): Promise<IteratePromptResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const userPrompt = input.prompt.trim()
  if (!userPrompt) {
    throw new Error('prompt is required')
  }
  const variantCount = input.variantCount ?? 4

  const config = getModelConfig(input.modelId)
  const isVideoModel =
    config?.type === 'video' ||
    /veo|video|replicate-video|fal-video|gemini-video/i.test(input.modelId)

  const skillPrompt = getSkillSystemPrompt('genai-prompting')
  const systemPrompt =
    skillPrompt ||
    'You are an expert AI prompt engineer specializing in Meta-Andromeda-aware ad creative iteration.'

  const anchorLines: string[] = []
  if (input.anchors?.product) anchorLines.push(`- Product: ${input.anchors.product}`)
  if (input.anchors?.offer) anchorLines.push(`- Offer: ${input.anchors.offer}`)
  if (input.anchors?.audience) anchorLines.push(`- Audience cohort: ${input.anchors.audience}`)
  if (input.anchors?.brand) anchorLines.push(`- Brand non-negotiables: ${input.anchors.brand}`)
  if (input.anchors?.lockedText) anchorLines.push(`- Locked text (do NOT change): ${input.anchors.lockedText}`)
  if (input.anchors?.theme) anchorLines.push(`- Theme: ${input.anchors.theme}`)

  const lockedAxesLine =
    input.lockedAxes && input.lockedAxes.length > 0
      ? `Axes the user has LOCKED (do not vary these): ${input.lockedAxes.join(', ')}`
      : 'No axes locked by user.'
  const preferredAxesLine =
    input.preferredAxes && input.preferredAxes.length > 0
      ? `Preferred axes to vary: ${input.preferredAxes.join(', ')}`
      : 'No preferred axes specified — pick 2-3 strong axes given the brief.'

  const baselineImageNote = input.referenceImage
    ? `A baseline image is attached. FIRST, analyze it in one mental pass: identify the main subject(s), composition, framing, lighting register, color treatment, and any visible text. Then design variants that PRESERVE the locked anchors but credibly DIFFER from the baseline on at least 2 of your chosen axes. Each variant's whyDifferentEnough must reference what the baseline looked like and why the variant is meaningfully different.`
    : `No baseline image is attached. Treat the user prompt as the baseline concept and design variants that branch off it without drifting into another ad set.`

  const baselineRefNote = input.baselineOutputId
    ? `\nBaseline output id: ${input.baselineOutputId} (the attached image is its render).`
    : ''

  const userMessage = `ITERATION_MODE: produce an Andromeda-aware diversified slate.

Selected model: ${input.modelId}${isVideoModel ? ' (video model)' : ' (image model)'}
Variant count requested: ${variantCount}

User's baseline prompt / concept:
"""
${userPrompt}
"""

${anchorLines.length > 0 ? `Anchors that MUST stay constant across every variant:\n${anchorLines.join('\n')}` : 'No explicit anchors provided. Infer reasonable anchors (theme, brand world, product, offer) from the baseline prompt and lock them.'}

${lockedAxesLine}
${preferredAxesLine}

${baselineImageNote}${baselineRefNote}

Return ONLY a single JSON object that conforms to the Iteration Slate Mode schema in your skill. No prose before or after. No markdown code fences.

Hard requirements:
- Generate exactly ${variantCount} variants.
- Every variant must move on at least 2 of axesVaried.
- Every variant must preserve every entry in anchors (product, offer, audience, brand, lockedText, theme).
- Reject weak diversification (different person only, different CTA only, color swap, slight angle change with same lighting/treatment).
- Reject over-drift (different offer, different audience cohort, different brand world).
- Each variant.prompt must be a complete, paste-ready generation prompt that obeys this skill's prompting craft for ${input.modelId} (${isVideoModel ? 'motion prompt for video' : 'image prompt'}).
- whyDifferentEnough must be one sentence and must explicitly cite which axes the variant moves on relative to the baseline and to sibling variants.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const enhancementModel =
    process.env.ANTHROPIC_PROMPT_ITERATE_MODEL || DEFAULT_PROMPT_ITERATE_MODEL

  const message = await anthropic.messages.create({
    model: enhancementModel,
    max_tokens: 4000,
    temperature: 0.5,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: buildMessageContent(userMessage, input.referenceImage) as never,
      },
    ],
  })

  let rawText = ''
  const textBlocks = message.content.filter((b) => b.type === 'text')
  if (textBlocks.length > 0 && textBlocks[0].type === 'text') {
    rawText = textBlocks[0].text
  }

  const parsed = safeJsonParse(rawText)
  if (!parsed || !isIterationSlate(parsed)) {
    const err = new Error(
      'Iteration model returned an unparseable slate. Try again, or simplify the brief / anchors.'
    )
    ;(err as Error & { rawText?: string }).rawText = rawText.slice(0, 1000)
    throw err
  }

  return {
    slate: parsed,
    raw: rawText,
    variantCount: parsed.variants.length,
    modelId: input.modelId,
    enhancementModel,
    skill: getSkillVersion('genai-prompting'),
  }
}
