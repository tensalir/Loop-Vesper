/**
 * Prompts a model must not rewrite.
 *
 * Loop's product prompts are filled by code from a skeleton (Eclipse), a
 * template (CMF) or a finishing skeleton (packaging), and the graded rounds
 * showed that a model rewrite of them invents colour words and moves the
 * product. Such a prompt is recognised by the fixed first words its skeleton
 * starts with and returned unchanged.
 *
 * Until the creative kit arrives (it carries these fingerprints and every
 * product's aliases from the plugin repository), the three fingerprints are
 * copied here from their sources:
 *   - products/eclipse/skill/references/generation.md, skeleton v3
 *   - workstreams/cmf/plugin/skills/review/references/prompt-template.md
 *   - products/packaging/skill/references/finishing.md, skeleton v2
 */

export const SKELETON_FINGERPRINTS: readonly string[] = [
  'Using the provided product render of the Loop Eclipse',
  'Use the attached image as the exact base.',
  "Using the provided mockup of Loop's retail box",
]

/**
 * Names that mark a prompt as being about a Loop product. Checked only on the
 * MCP `enhance_prompt` tool, where the caller can send the product's filled
 * skeleton instead; the web app's Enhance button is unchanged until the
 * product tools exist.
 */
const LOOP_PRODUCT_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'Loop Eclipse', pattern: /\bLoop\s+Eclipse\b/i },
  { name: 'Eclipse sleep mask', pattern: /\bEclipse\s+sleep\s*mask\b/i },
  { name: 'Coachella box', pattern: /\bCoachella\s+(?:box|packaging)\b/i },
  { name: "Loop's retail box", pattern: /\bLoop(?:'s|\u2019s)?\s+retail\s+box\b/i },
]

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function findSkeletonFingerprint(prompt: string): string | null {
  const flat = squash(prompt)
  return SKELETON_FINGERPRINTS.find((fp) => flat.includes(squash(fp))) ?? null
}

export function findLoopProductName(prompt: string): string | null {
  return LOOP_PRODUCT_PATTERNS.find(({ pattern }) => pattern.test(prompt))?.name ?? null
}

export interface PromptPassthrough {
  reason: 'skeleton' | 'product'
  match: string
  note: string
}

export function productPromptPassthrough(
  prompt: string,
  options: { checkProductNames?: boolean } = {}
): PromptPassthrough | null {
  const fingerprint = findSkeletonFingerprint(prompt)
  if (fingerprint) {
    return {
      reason: 'skeleton',
      match: fingerprint,
      note:
        'This prompt was filled by code from a Loop product skeleton or the CMF template, so it is returned unchanged: send it as it is. A model rewrite of these prompts invents colour words and moves the product.',
    }
  }
  if (options.checkProductNames) {
    const name = findLoopProductName(prompt)
    if (name) {
      return {
        reason: 'product',
        match: name,
        note:
          `This prompt names a Loop product (${name}), so it is returned unchanged. Loop product prompts are filled by code from the product's skeleton and sent as they are, with the product render as the first image: use generate_product_image once it is connected, and until then generate_asset with the render first.`,
      }
    }
  }
  return null
}
