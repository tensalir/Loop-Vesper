/**
 * Reusable prompt-enhancement service.
 *
 * Both the cookie-authenticated UI route (`/api/prompts/enhance`) and the
 * bearer-token-authenticated headless route (`/api/headless/v1/prompts/enhance`)
 * call this service. Keeping a single source of truth ensures the Gen-AI
 * prompting substrate behaves the same regardless of surface.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getModelConfig } from '@/lib/models/registry'
import { referenceToDataUrl, splitDataUrl } from '@/lib/net/fetch-allowlisted'
import { getPromptingSystemPrompt, type PromptingSource } from './prompting-source'
import { productPromptPassthrough, type PromptPassthrough } from './product-prompt-guard'
import type { SkillVersion } from './skill-version'

const DEFAULT_PROMPT_ENHANCE_MODEL = 'claude-sonnet-4-5-20250929'

export type EnhancePromptMode = 'standard' | 'iteration-edit'

export interface EnhancePromptInput {
  prompt: string
  modelId: string
  /** Data-URL or HTTPS URL of an optional reference image. */
  referenceImage?: string
  /**
   * Enhancement mode.
   * - `standard` (default): the existing user-facing Enhance button behavior.
   * - `iteration-edit`: silent server-side rewrite when iterating on a
   *   previously-generated image. Steers Claude to perform an image-aware
   *   preservation rewrite using the "Iterating on a Generated Image" section
   *   of the genai-prompting skill, with a tight output budget.
   */
  mode?: EnhancePromptMode
  /**
   * Also return prompts that name a Loop product unchanged (the MCP tool sets
   * this). Prompts carrying a product skeleton's fingerprint are always
   * returned unchanged.
   */
  guardProductNames?: boolean
}

export interface EnhancePromptResult {
  originalPrompt: string
  enhancedPrompt: string
  modelId: string
  /** Identifier of the database override prompt that was used, if any. */
  enhancementPromptId: string | null
  /** Anthropic model used for the enhancement call. */
  enhancementModel: string
  /** Skill substrate version used. */
  skill: SkillVersion | null
  /** Set when the prompt was returned unchanged, with the reason. */
  passthrough?: PromptPassthrough | null
  /** Which system prompt ran: kit, admin override, bundled skill or fallback. */
  promptingSource?: Pick<PromptingSource, 'source' | 'sha256' | 'version'> | null
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

function detectStyleReferenceIntent(userPrompt: string): {
  wantsStyleReference: boolean
  wantsFullReference: boolean
  wantsStyleOnly: boolean
} {
  const wantsStyleReference =
    /\bstyle\s*ref(?:erence)?\b/i.test(userPrompt) ||
    /\buse\s+(?:this|the|it)\s+(?:image|pic|photo|as)?\s*(?:as\s+)?(?:a\s+)?style\b/i.test(userPrompt) ||
    /\bfor\s+(?:the\s+)?style\b/i.test(userPrompt) ||
    /\b(?:this|the)\s+style\b/i.test(userPrompt) ||
    /\bstyle\s+(?:from|of)\s+(?:this|the)\b/i.test(userPrompt)

  const wantsFullReference =
    /\b(?:recreate|copy|replicate|match|maintain|keep)\s+(?:the\s+)?(?:composition|layout|scene|setup|arrangement)\b/i.test(userPrompt) ||
    /\bsame\s+(?:composition|layout|scene|setup)\b/i.test(userPrompt) ||
    /\bsimilar\s+scene\b/i.test(userPrompt)

  return {
    wantsStyleReference,
    wantsFullReference,
    wantsStyleOnly: wantsStyleReference && !wantsFullReference,
  }
}

function detectPromptRequest(userPrompt: string): boolean {
  return (
    /\b(?:give me|write|generate|create|make)\b[\s\S]{0,80}\bprompt\b/i.test(userPrompt) ||
    /\bnano\s*banana\s+prompt\b/i.test(userPrompt)
  )
}

function isVideoModelId(modelId: string): boolean {
  const config = getModelConfig(modelId)
  return (
    config?.type === 'video' ||
    /veo|video|replicate-video|fal-video|gemini-video/i.test(modelId)
  )
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

export function buildRequestContent(args: {
  userPrompt: string
  modelId: string
  hasReferenceImage: boolean
}): string {
  const { userPrompt, modelId, hasReferenceImage } = args
  const isVideoModel = isVideoModelId(modelId)
  const isNanoBananaModel =
    modelId === 'gemini-nano-banana-pro' || modelId === 'gemini-nano-banana-2'
  const isNanoBananaPro = modelId === 'gemini-nano-banana-pro'
  const { wantsStyleReference, wantsStyleOnly } = detectStyleReferenceIntent(userPrompt)
  const isPromptRequest = detectPromptRequest(userPrompt)

  if (hasReferenceImage) {
    if (isVideoModel) {
      return `User is animating a still image into a video. User's motion prompt: "${userPrompt}"
Reference image will be provided (treat it as frame 1).

Enhance this as an image-to-video / motion prompt (aligned with our motion prompt guidelines and Veo-style best practices):
- Do NOT write a Nano Banana image prompt and do NOT start with "Using the attached image as a style reference...".
- Treat the reference image as the initial frame; do NOT re-describe the full scene in detail.
- Describe ONLY what changes over time: subject motion, environmental motion, camera behavior, pacing/timing.
- Preserve the reference image's style, composition, lighting, and subject identity unless the user explicitly requests changes.
- Keep it as ONE coherent shot idea suitable for ~4-8 seconds (avoid rigid multi-shot lists).
- Include audio ambience / SFX / dialogue ONLY if the user explicitly asks for audio; otherwise omit audio.

Return ONLY the enhanced motion prompt text.`
    }

    if (isNanoBananaModel) {
      let requiredPrefix: string
      if (wantsStyleOnly) {
        requiredPrefix = 'Using the attached image ONLY as a style reference—extract its '
      } else if (wantsStyleReference) {
        requiredPrefix = 'Using the attached image as a style reference for its '
      } else {
        requiredPrefix = 'Using the attached image, '
      }

      if (isPromptRequest) {
        if (wantsStyleOnly) {
          return `User is asking you to WRITE a Nano Banana prompt using the provided image ONLY for its visual STYLE.

User's request: "${userPrompt}"
Reference image will be provided.

CRITICAL STYLE-ONLY REQUIREMENTS:
- Return ONLY ONE prompt. No titles, no lists, no quotes, no code fences.
- The prompt MUST start with: "${requiredPrefix}"

EXTRACT from reference image (visual treatment only):
- Color grading / color palette / tonal range (be specific: "moody blue-grey", "warm amber highlights")
- Lighting quality (soft/hard, direction, temperature, diffusion)
- Atmosphere / mood / emotional tone
- Texture / grain / processing style
- Contrast levels, shadow and highlight treatment
- Depth rendering / atmospheric perspective feel

BLOCK these compositional elements (BE EXPLICIT):
- Look at the image and identify the MAIN SUBJECTS (people, mountains, tents, animals, vehicles, etc.)
- You MUST tell the model: "Do NOT reproduce [list the subjects you see]"
- Also block: scene layout, spatial arrangement, poses, object placement

REQUIRED PROMPT STRUCTURE:
1. Start with: "${requiredPrefix}"
2. Describe the specific visual qualities you extract from the reference
3. Add an EXPLICIT blocking statement: "IMPORTANT: Do NOT reproduce the [subjects/objects you see]. Do NOT copy the scene composition or spatial layout."
4. Then describe the user's NEW subject/scene: "Apply this visual style to: [user's completely different subject]"
5. End with: "Create a fresh composition appropriate for this new subject."

Model context:
- Selected model: ${modelId}
- ${isNanoBananaPro ? 'Nano Banana Pro is optimized for higher-fidelity, production-ready assets and precise text/layout rendering.' : 'Nano Banana 2 is optimized for faster iteration and broad, high-volume ideation workflows.'}

Terminology:
- "Nano Banana" is Gemini's model nickname. Do NOT introduce literal bananas unless the user explicitly requested bananas.

Return ONLY the prompt text.`
        }

        return `User is asking you to WRITE a final Nano Banana prompt that uses the provided reference image.
User's request: "${userPrompt}"
Reference image will be provided.

CRITICAL REQUIREMENTS:
- Return ONLY ONE prompt. No titles, no lists, no quotes, no code fences.
- The prompt MUST start with: "${requiredPrefix}"
- Immediately after that prefix, include the specific visual qualities you observe in the reference image (color palette, lighting, mood, composition, texture).
- Then describe the new scene/composition/angles the user wants (keep it coherent and specific).

Model context:
- Selected model: ${modelId}
- ${isNanoBananaPro ? 'Favor stronger precision for typography, composition, and polished asset quality when relevant.' : 'Favor concise, flexible phrasing suited for rapid multi-turn iteration and experimentation.'}

Terminology:
- "Nano Banana" is Gemini's model nickname. Do NOT introduce literal bananas unless the user explicitly requested bananas in the image.

Return ONLY the prompt text.`
      }

      return `User wants to edit an image. Their instruction: "${userPrompt}"
Reference image will be provided.

IMPORTANT: For Nano Banana image editing:
- Return ONLY the enhanced edit instruction (no explanations, no labels, no quotes, no code fences)
- Start with: "${requiredPrefix}"
- Describe exactly what to change AND what to preserve
- Use precise, action-oriented language and specific placement
- Keep the original style/lighting unless the user asks to change it
- "Nano Banana" is a model nickname. Do NOT introduce literal bananas unless explicitly requested
- Selected model: ${modelId}
- ${isNanoBananaPro ? 'Use tighter precision suitable for production-ready assets.' : 'Optimize for clarity and iterative editing speed; keep instructions concise and unambiguous.'}

Enhance this instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
    }

    if (modelId === 'fal-seedream-v4' || modelId === 'replicate-seedream-4') {
      return `User wants to edit an image. Their instruction: "${userPrompt}"
Reference image will be provided.

IMPORTANT: For Seedream 4 image editing:
- Describe the desired transformation artistically
- Focus on scene composition and mood
- Use conceptual language about spatial relationships
- Reference lighting and atmosphere
- Maintain coherence with the provided image

Enhance this edit instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
    }

    return `User wants to edit an image. Their instruction: "${userPrompt}"
Reference image will be provided.

Enhance this edit instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
  }

  // No reference image — pure text prompt.
  if (isVideoModel) {
    return `User's video prompt: "${userPrompt}"
Please enhance this for a video generation model while keeping the user's intent. Use practical, non-restrictive guidance inspired by Veo best practices:

Include when useful (omit if not relevant):
- A concise storyline or action progression (beginning -> middle -> end)
- Camera guidance (e.g., wide shot, close-up, slow pan, push-in)
- Visual tone and lighting (e.g., cinematic, soft daylight, moody, golden hour)
- Motion cues (what moves and how: drifting snow, subtle camera sway)
- Composition hints (foreground/background elements; depth; subject focus)
- Duration-aware phrasing (8s feels complete; avoid overstuffing)
- Audio ambiance only if clearly desired (keep subtle)

Avoid:
- Overly rigid shot lists or technical jargon
- Breaking the user's style/subject
- Excessive verbosity

Return ONLY the enhanced prompt text. Nothing else.`
  }

  return `User's prompt: "${userPrompt}"
Please enhance this text-to-image prompt while respecting the user's creative vision.

Guidelines:
- Clarify ambiguous elements
- Keep the original tone and style
- Don't add unnecessary complexity

Return ONLY the enhanced prompt text. Nothing else.`
}

/**
 * Build the user message for `iteration-edit` mode. Inlines the 5-step
 * analysis from the genai-prompting skill so Claude reliably performs an
 * image-aware preservation rewrite, and enforces a tight output budget so the
 * result steers the image model rather than burying it.
 */
function buildIterationRequestContent(args: {
  userPrompt: string
  modelId: string
}): string {
  const { userPrompt, modelId } = args
  return `ITERATION-EDIT MODE — silent server-side rewrite.

The user is iterating on a previously-generated image. The attached reference image is the actual current state. Your rewritten prompt will be sent verbatim to the image model (selected model: ${modelId}) with no surrounding chat, no quotes, and no preamble.

The user's prompt almost always under-specifies preservation. Your job is to add the preservation language that's missing, scoped to what you actually see in the image.

Perform this analysis silently before composing the prompt:
1. Look at the attached image. Identify the specific subject(s) and product(s) that must survive unchanged — name them concretely (e.g. "the Loop case", "the white earplug stems", "the embossed wordmark"). Note geometry, materials, color saturation, labels/text/logos, and any fine surface detail that's at risk.
2. Identify the user's edit intent (zoom in/out, lighting change, environment swap, add/remove, restyle, angle change, etc.).
3. Identify the failure mode for that intent and the specific subject (zoom-out → product shrinks and muddies; environment swap → light/color cast bleeds onto product; restyle → grading bleeds onto product surface; add element → composition crowding; angle change → invented geometry).
4. Compose one prompt with three parts: an anchor block (preserve, concrete), a change block (apply only this, with placement and lighting), and a short non-goals line ruling out the failure mode.

Hard rules for your output:
- Return ONE prompt only. No headings, no labels, no markdown, no quotes, no code fences, no explanations.
- 2 to 5 sentences total. Tight, not verbose.
- Never re-describe what's already visible in the reference image; the image is the source of truth.
- Always reference the attached image as the high-fidelity source-of-truth for the subject(s) you identified.
- Match original lighting direction and color temperature unless the user explicitly asked to change them.

User's raw prompt: "${userPrompt}"

Return the rewritten prompt now.`
}

function buildMessageContent(
  requestContent: string,
  referenceImage?: string
): MessageContent[] {
  if (!referenceImage) {
    return [{ type: 'text', text: requestContent }]
  }

  // `enhancePrompt` has already turned https URLs and bare base64 into a
  // data URL. The old split on ',' sent an https URL as an empty image.
  const { mediaType, base64: base64Data } = splitDataUrl(referenceImage)

  return [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType,
        data: base64Data || '',
      },
    },
    { type: 'text', text: requestContent },
  ]
}

/**
 * Run the prompt enhancement pipeline. Throws on upstream provider errors;
 * callers are responsible for translating those into HTTP responses via
 * `classifyError`.
 */
export async function enhancePrompt(
  input: EnhancePromptInput
): Promise<EnhancePromptResult> {
  const userPrompt = input.prompt.trim()
  if (!userPrompt) {
    throw new Error('prompt is required')
  }

  // Code-filled product prompts are never rewritten by a model.
  const passthrough = productPromptPassthrough(userPrompt, {
    checkProductNames: input.guardProductNames === true,
  })
  if (passthrough) {
    return {
      originalPrompt: input.prompt,
      enhancedPrompt: input.prompt,
      modelId: input.modelId,
      enhancementPromptId: null,
      enhancementModel: 'none',
      skill: null,
      passthrough,
      promptingSource: null,
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const mode: EnhancePromptMode = input.mode ?? 'standard'

  const source = await getPromptingSystemPrompt(input.modelId)
  const systemPrompt = source.text
  const enhancementPromptId = source.source === 'db' ? source.id : null
  const referenceImage = input.referenceImage
    ? await referenceToDataUrl(input.referenceImage)
    : undefined
  const requestContent =
    mode === 'iteration-edit'
      ? buildIterationRequestContent({ userPrompt, modelId: input.modelId })
      : buildRequestContent({
          userPrompt,
          modelId: input.modelId,
          hasReferenceImage: Boolean(referenceImage),
        })

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const enhancementModel =
    process.env.ANTHROPIC_PROMPT_ENHANCE_MODEL || DEFAULT_PROMPT_ENHANCE_MODEL

  // Iteration-edit mode wants a tight, deterministic rewrite. Standard mode
  // keeps the existing creative-temperature settings. The kit, when it is
  // the source, sets both for the standard mode.
  const kitSettings = mode === 'standard' ? source.settings : undefined
  const maxTokens = kitSettings?.maxTokens ?? (mode === 'iteration-edit' ? 600 : 2000)
  const temperature = kitSettings?.temperature ?? (mode === 'iteration-edit' ? 0.3 : 0.7)

  const message = await anthropic.messages.create({
    model: enhancementModel,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: buildMessageContent(requestContent, referenceImage) as never,
      },
    ],
  })

  let enhancedPrompt = ''
  const textBlocks = message.content.filter((b) => b.type === 'text')
  if (textBlocks.length > 0 && textBlocks[0].type === 'text') {
    enhancedPrompt = textBlocks[0].text
  }

  enhancedPrompt = enhancedPrompt
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/\n?```$/gm, '')
    .trim()

  if (!enhancedPrompt) {
    throw new Error('Enhancement model returned an empty response')
  }

  if (mode === 'iteration-edit') {
    // Strip wrapping quotes if Claude added them despite instructions.
    enhancedPrompt = enhancedPrompt.replace(/^["'\u201C\u201D\u2018\u2019]+|["'\u201C\u201D\u2018\u2019]+$/g, '').trim()
    // Hard cap so the rewrite steers the image model rather than burying it.
    const ITERATION_PROMPT_MAX_CHARS = 1200
    if (enhancedPrompt.length > ITERATION_PROMPT_MAX_CHARS) {
      enhancedPrompt = `${enhancedPrompt.slice(0, ITERATION_PROMPT_MAX_CHARS - 1).trimEnd()}\u2026`
    }
  }

  return {
    originalPrompt: input.prompt,
    enhancedPrompt,
    modelId: input.modelId,
    enhancementPromptId,
    enhancementModel,
    skill: skillVersionFromSource(source),
    passthrough: null,
    promptingSource: { source: source.source, sha256: source.sha256, version: source.version },
  }
}
