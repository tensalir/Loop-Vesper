/**
 * Prompts a model must not rewrite.
 *
 * Loop's product prompts are filled by code from a skeleton (Eclipse), a
 * template (CMF) or a finishing skeleton (packaging), and the graded rounds
 * showed that a model rewrite of them invents colour words and moves the
 * product (the kit lesson `no-model-rewrite`, CMF round 0, 2026-09-24). Such a
 * prompt is recognised by how it starts: the fixed first words its skeleton
 * opens with. It is returned unchanged.
 *
 * The words come from the kits, at their release tags:
 *   - the creative kit's `prompting.never_enhance_fingerprints` (Eclipse, packaging);
 *   - the product kit's `products.cmf.template.fingerprint` (CMF, read from Loop
 *     AI Product Design since 2026-09-29; the creative kit stopped carrying it);
 *   - the creative kit's products, by their own `name`, for the MCP name check.
 * A kit that cannot be read leaves its part to the copies in this file, so the
 * guard never fails on a kit.
 *
 * Until 2026-10-01 a fingerprint matched anywhere in a prompt, and the CMF one
 * was the short sentence 'Use the attached image as the exact base.': a free
 * edit prompt containing that common sentence came back unenhanced and
 * labelled a Loop skeleton. The kit's longer fingerprints were parsed and
 * never read. A fingerprint now matches only where a code-filled prompt has
 * it, at the start.
 *
 * The name check counts full product names only: a kit product's own name
 * beside the brand ("Loop Eclipse"), and the names this file matched before
 * the kit was read ("Eclipse sleep mask", "Coachella packaging"). The kit's
 * `aliases` are not read: they hold generic words ("the box", "the mask",
 * "Packaging"), and reading them sent "Loop packaging" or "a Loop mask" to the
 * packaging and product tools, which need access most colleagues do not have
 * (the pre-merge review of #34, 2026-10-01).
 */

import type { AnyKit } from '@/lib/creative/kit-schema'

/**
 * The copies, used when a kit cannot be read, in the order Eclipse, CMF,
 * packaging:
 *   - products/eclipse/skill/references/generation.md, skeleton v3
 *   - the CMF template, `skills/cmf-review/references/prompt-template.md` in Loop AI Product
 *     Design (tensalir/loop-ai-product, until its rename tensalir/loop-product-plugins; in Loop
 *     Studio Design until 2026-09-29)
 *   - products/packaging/skill/references/finishing.md, skeleton v2
 */
export const SKELETON_FINGERPRINTS: readonly string[] = [
  'Using the provided product render of the Loop Eclipse',
  'Use the attached image as the exact base.',
  "Using the provided mockup of Loop's retail box",
]

const CODE_STUDIO_FINGERPRINTS = [SKELETON_FINGERPRINTS[0], SKELETON_FINGERPRINTS[2]]
const CODE_CMF_FINGERPRINTS = [SKELETON_FINGERPRINTS[1]]

/** A product a free prompt can name, and the tool that draws it instead. */
export interface GuardProduct {
  name: string
  kind: 'product-imagery' | 'packaging'
}

/** The copies of the kit's products, used when the creative kit cannot be read. */
export const CODE_PRODUCTS: readonly GuardProduct[] = [
  { name: 'Eclipse', kind: 'product-imagery' },
  { name: 'Packaging', kind: 'packaging' },
]

/**
 * A product name that is a common noun is not a full name: the kit calls its
 * packaging product "Packaging", and "Loop packaging" is how a colleague asks
 * for any picture of a box.
 */
const GENERIC_NAMES = new Set(['packaging', 'box', 'retail box', 'mask', 'sleep mask'])

/**
 * The full names this file matched before the kit was read, kept as they were.
 * "Loop Eclipse" is not here: it is the kit product's own name beside the brand.
 */
const FULL_NAME_PATTERNS: ReadonlyArray<{ pattern: RegExp; kind: GuardProduct['kind'] }> = [
  { pattern: /\bEclipse\s+sleep\s*mask\b/i, kind: 'product-imagery' },
  { pattern: /\bCoachella\s+(?:box|packaging)\b/i, kind: 'packaging' },
  { pattern: /\bLoop(?:'s|’s)?\s+retail\s+box\b/i, kind: 'packaging' },
]

/** What the guard matches against, and where each part came from. */
export interface GuardVocabulary {
  /** How a code-filled prompt starts, whitespace squashed. */
  fingerprints: readonly string[]
  products: readonly GuardProduct[]
  source: { studio: 'kit' | 'code'; cmf: 'kit' | 'code' }
}

/** The kits' words for the guard; a part is null or absent when its kit could not be read. */
export interface KitGuardWords {
  studioFingerprints?: readonly string[] | null
  cmfFingerprints?: readonly string[] | null
  products?: readonly GuardProduct[] | null
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** The kits' words, each part falling back to this file's copies. */
export function guardVocabulary(kit: KitGuardWords = {}): GuardVocabulary {
  const studio = kit.studioFingerprints?.length ? kit.studioFingerprints : null
  const cmf = kit.cmfFingerprints?.length ? kit.cmfFingerprints : null
  const fingerprints = Array.from(
    new Set([...(studio ?? CODE_STUDIO_FINGERPRINTS), ...(cmf ?? CODE_CMF_FINGERPRINTS)].map(squash))
  ).filter((fp) => fp.length >= 8)
  return {
    fingerprints,
    products: kit.products?.length ? kit.products : CODE_PRODUCTS,
    source: { studio: studio ? 'kit' : 'code', cmf: cmf ? 'kit' : 'code' },
  }
}

/** The words for the guard from the creative kit and the product kit as loaded; either may be null. */
export function kitGuardWords(studio: AnyKit | null, product: AnyKit | null): KitGuardWords {
  const cmfFingerprints = product
    ? Object.values(product.products)
        .filter((p) => p.kind === 'cmf')
        .map((p) => (p as { template?: { fingerprint?: unknown } }).template?.fingerprint)
        .filter((fp): fp is string => typeof fp === 'string' && fp.trim().length >= 8)
    : null
  const products = studio
    ? Object.values(studio.products)
        .filter((p): p is typeof p & { kind: GuardProduct['kind'] } => p.kind !== 'cmf' && p.status !== 'retired')
        .map((p) => ({ name: p.name, kind: p.kind }))
    : null
  return {
    studioFingerprints: studio?.prompting?.never_enhance_fingerprints ?? null,
    cmfFingerprints,
    products,
  }
}

export type GuardWordsLoader = () => Promise<KitGuardWords | null>

/**
 * The kits, only when Vesper's GitHub App is configured, so nothing here
 * reaches GitHub or the database otherwise.
 */
const defaultLoader: GuardWordsLoader = async () => {
  const { githubAppConfigFromEnv } = await import('@/lib/github/app')
  if (!githubAppConfigFromEnv()) return null
  const { loadKitGuardWords } = await import('@/lib/creative/kit-runtime')
  return loadKitGuardWords()
}

let loader: GuardWordsLoader = defaultLoader

/** Tests set it; null puts the kits back. */
export function setGuardWordsLoader(next: GuardWordsLoader | null): void {
  loader = next ?? defaultLoader
}

/** The guard's words now: the kits' where they can be read, this file's copies otherwise. Never throws. */
export async function loadGuardVocabulary(): Promise<GuardVocabulary> {
  const words = await loader().catch((err) => {
    console.warn('[product-prompt-guard] the kits could not be read, using the copies:', (err as Error)?.message)
    return null
  })
  return guardVocabulary(words ?? {})
}

/** The fingerprint a code-filled prompt starts with, or null. */
export function findSkeletonFingerprint(
  prompt: string,
  fingerprints: readonly string[] = SKELETON_FINGERPRINTS
): string | null {
  const flat = squash(prompt)
  return fingerprints.find((fp) => flat.startsWith(squash(fp))) ?? null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A kit product's own name as a free prompt would write it: beside the brand
 * ("Loop Eclipse"), or on its own when the name carries the brand already.
 * Null for a name that is a common noun ("Packaging").
 */
function namePattern(name: string): RegExp | null {
  const words = squash(name).split(' ').filter(Boolean)
  if (words.length === 0 || GENERIC_NAMES.has(words.join(' ').toLowerCase())) return null
  const body = words.map(escapeRegExp).join('\\s+')
  const brand = /^loop(?:'s|’s)?$/i.test(words[0]) ? '' : "Loop(?:'s|’s)?\\s+"
  return new RegExp(`\\b${brand}${body}(?!\\w)`, 'i')
}

/** The Loop product a free prompt names by its full name, as the prompt writes it, or null. */
export function findLoopProduct(
  prompt: string,
  products: readonly GuardProduct[] = CODE_PRODUCTS
): { kind: GuardProduct['kind']; match: string } | null {
  const patterns = [
    ...products.flatMap((p) => {
      const pattern = namePattern(p.name)
      return pattern ? [{ pattern, kind: p.kind }] : []
    }),
    ...FULL_NAME_PATTERNS,
  ]
  // The name the prompt writes first, the longest where two start together.
  let best: { kind: GuardProduct['kind']; match: string; index: number } | null = null
  for (const { pattern, kind } of patterns) {
    const m = pattern.exec(prompt)
    if (!m) continue
    if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.match.length)) {
      best = { kind, match: m[0], index: m.index }
    }
  }
  return best ? { kind: best.kind, match: squash(best.match) } : null
}

export function findLoopProductName(prompt: string, products: readonly GuardProduct[] = CODE_PRODUCTS): string | null {
  return findLoopProduct(prompt, products)?.match ?? null
}

export interface PromptPassthrough {
  reason: 'skeleton' | 'product'
  match: string
  note: string
}

function toolFor(kind: GuardProduct['kind']): string {
  return kind === 'packaging'
    ? 'packaging_mockup, then packaging_finish'
    : 'generate_product_image, which fills the skeleton and attaches the render first'
}

/**
 * Null when a model may rewrite the prompt. Product names are checked only
 * when asked: the MCP `enhance_prompt` tool asks, the web app's Enhance button
 * does not.
 */
export function productPromptPassthrough(
  prompt: string,
  options: { checkProductNames?: boolean; vocabulary?: GuardVocabulary } = {}
): PromptPassthrough | null {
  const vocabulary = options.vocabulary ?? guardVocabulary()
  const fingerprint = findSkeletonFingerprint(prompt, vocabulary.fingerprints)
  if (fingerprint) {
    return {
      reason: 'skeleton',
      match: fingerprint,
      note:
        'This prompt was filled by code from a Loop product skeleton or the CMF template, so it is returned unchanged: send it as it is. A model rewrite of these prompts invents colour words and moves the product.',
    }
  }
  if (options.checkProductNames) {
    const found = findLoopProduct(prompt, vocabulary.products)
    if (found) {
      return {
        reason: 'product',
        match: found.match,
        note: `This prompt names a Loop product (${found.match}), so it is returned unchanged. A Loop product prompt is filled by code from the product's skeleton and sent as it is, never rewritten by a model: use ${toolFor(found.kind)}.`,
      }
    }
  }
  return null
}
