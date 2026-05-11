/**
 * Deterministic prompt builder for the CMF recolour pass.
 *
 * Mirrors the canonical prompt Damien hand-tuned on Nano Banana (see
 * `src/lib/skills/loop-cmf-generation/references/prompting.md`). The
 * structure is LOCK; the recolour lines and protected-surfaces list vary
 * per SKU.
 *
 * Skeleton:
 *
 *   Using the provided 3D clown CMF render of {product}, convert it into a
 *   photorealistic studio product shot in the "{colourway}" colourway.
 *
 *   Preserve clause (geometry, markings, background).
 *
 *   Replace only the materials, colors, and lighting as follows:
 *     - {label}: recolour to {pantone} ({hex}) — {rich material}, {rich finish}
 *     - ...
 *
 *   Do NOT change: {protected surfaces}.
 *
 *   Lighting clause (studio product photography, key/fill/rim, AO).
 *
 *   Quality bar: photorealistic 4K, real photographed sample, not CGI.
 *
 * The output is a single string designed to be passed straight to the
 * Vesper `enhancePrompt` service for Nano Banana–optimised polishing.
 */

import type { CmfSkuRow, ComponentSpec } from './schema'
import { getCmfProduct } from './products'

/* ── Prompt variants ───────────────────────────────────────────────────── */

/**
 * A prompt variant tweaks the *lighting / mood* clause of the canonical
 * prompt so each attempt in a bulk burst explores a meaningfully
 * different studio setup instead of producing N near-identical outputs.
 * The recolour spec, preserve clause, and quality bar stay LOCK across
 * variants so brand consistency holds.
 *
 * Order matters: `runCmfRender` picks a variant by `(attemptNumber - 1) %
 * PROMPT_VARIANTS.length`, so attempt 1 is always Studio Classic
 * (Damien's gold-standard), attempt 2 is Warm, attempt 3 is Clinical, etc.
 * This is intentionally reproducible — re-running with the same attempt
 * number lands the same variant.
 *
 * Adding a variant is a code change because each variant is part of the
 * brand-quality contract.
 */
export interface PromptVariant {
  /** Short stable id used in activity log + UI ("classic" / "warm" / ...). */
  id: string
  /** Human-readable name for the inspect lightbox / activity timeline. */
  name: string
  /** Lighting clause inserted between the recolour block and the quality bar. */
  lightingClause: string
}

export const PROMPT_VARIANTS: PromptVariant[] = [
  {
    id: 'classic',
    name: 'Studio Classic',
    lightingClause:
      'Lighting: clean studio product photography. Soft large key light from upper left, subtle fill from lower right to reveal material texture, gentle rim light to separate the products from the background. Realistic contact shadows and ambient occlusion where parts meet. Sharp focus across every unit.',
  },
  {
    id: 'warm',
    name: 'Studio Warm',
    lightingClause:
      'Lighting: clean studio product photography with a warm bias. Soft large key light from upper right with a gentle golden tone, cool blue fill from lower left adding micro-contrast, soft rim light tracing each silhouette. Realistic contact shadows and ambient occlusion where parts meet. Sharp focus across every unit.',
  },
  {
    id: 'clinical',
    name: 'Studio Clinical',
    lightingClause:
      'Lighting: catalogue-grade product photography. Crisp neutral key light from directly above, even fill light minimising harsh shadows, faint rim light. Soft contact shadows, accurate ambient occlusion. Tack-sharp focus across every unit. Precision over drama.',
  },
  {
    id: 'dramatic',
    name: 'Studio Dramatic',
    lightingClause:
      'Lighting: editorial-grade product photography. Single hard key light from upper left producing pronounced specular highlights on satin and metal surfaces, minimal fill so shadows hold their density, strong rim light separating each unit from the background. Crisp contact shadows and ambient occlusion. Sharp focus across every unit.',
  },
]

/**
 * Resolve a variant from an arbitrary numeric index. Cycles via modulo so
 * a 7-attempt burst still lands on real variants (1..4..1..4..1..4..1).
 */
export function selectPromptVariant(index: number): PromptVariant {
  const n = PROMPT_VARIANTS.length
  const i = ((index % n) + n) % n
  return PROMPT_VARIANTS[i]
}

/* ── Rich material / finish vocabulary ─────────────────────────────────── */

/**
 * Returns a rich material description suitable for Nano Banana. Always
 * keeps the workbook material verbatim alongside the hint so factory
 * matching never loses information.
 */
function describeMaterial(component: ComponentSpec): string {
  const raw = component.material?.trim()
  const finishLower = (component.finish ?? '').toLowerCase()
  if (!raw) return ''

  const m = raw.toLowerCase()
  const wantsGloss = /(gloss|highgloss|mirror|polished)/.test(finishLower)
  const wantsNcvm = /(ncvm)/.test(finishLower)
  const wantsBrushed = /(brushed|satin|anodised|anodized)/.test(finishLower)
  const wantsMatte = /(matte|matt|vdi\s*2[0-9]|vdi\s*1[0-9])/.test(finishLower)
  const wantsTranslucent = /(translucent|milky|see.?through|shore\s*30)/.test(
    m + ' ' + finishLower
  )

  // POM
  if (m.includes('pom')) {
    return `${raw} (subtle matte finish, fine micro-texture, no specular hotspots)`
  }

  // Polycarbonate / ABS family
  if (m.includes('pc/abs') || m.includes('pc abs') || m.includes('polycarbonate')) {
    if (wantsGloss) {
      return `${raw} (high-gloss mirror polish, sharp specular highlights, deep reflections)`
    }
    if (wantsNcvm) {
      return `${raw} (NCVM-coated, satin metal-like finish, brushed anisotropic highlights, fine satin grain reminiscent of anodised aluminium)`
    }
    return `${raw} (satin micro-texture, soft diffuse sheen, low specular response)`
  }
  if (m.includes('abs')) {
    if (wantsNcvm) {
      return `${raw} (NCVM-coated, satin metal-like finish, brushed anisotropic highlights, fine satin grain reminiscent of anodised aluminium)`
    }
    if (wantsGloss) {
      return `${raw} (high-gloss surface, sharp specular highlights, deep reflections)`
    }
    return `${raw} (satin micro-texture, soft diffuse sheen, low specular response)`
  }

  // Silicone
  if (m.includes('silicon')) {
    if (wantsTranslucent || m.includes('shore 30')) {
      return `${raw} (translucent milky silicone with gentle subsurface light scattering, frosted appearance, smooth rubbery micro-surface, light visibly passes through the thinner edges, no hard reflections)`
    }
    if (m.includes('shore 90')) {
      return `${raw} (firm silicone with semi-gloss surface, slight specular response, smooth micro-texture)`
    }
    return `${raw} (opaque silicone with soft rubbery sheen, smooth micro-surface, gentle pliable appearance)`
  }

  // Aluminium
  if (m.includes('aluminum') || m.includes('aluminium') || m.includes('al6063')) {
    if (wantsGloss) {
      return `${raw} (polished mirror finish, sharp specular highlights, deep reflections)`
    }
    return `${raw} (anodised, brushed satin finish, fine anisotropic grain, soft metallic sheen)`
  }

  // Foam
  if (m.includes('foam')) {
    return `${raw} (open-cell, matte, slightly fibrous edge, soft diffuse surface)`
  }

  // Velcro
  if (m.includes('velcro') && (m.includes('loop') || m.includes('pa'))) {
    return `${raw} (looped velcro fabric, matte, no specular highlights, soft brushed appearance)`
  }
  if (m.includes('velcro') && (m.includes('hook') || m.includes('tpu'))) {
    return `${raw} (hooked TPU velcro, matte, micro-scale grid texture)`
  }

  // Fabric / nylon / microfiber
  if (
    m.includes('fabric') ||
    m.includes('microfiber') ||
    m.includes('nylon') ||
    m.includes('woven') ||
    m.includes('pa & el') ||
    m.includes('pa&el') ||
    m.includes('%pa')
  ) {
    return `${raw} (woven fabric, matte, visible fibre direction, no specular highlights)`
  }

  // TPE
  if (m.includes('tpe')) {
    return `${raw} (soft matte surface, slight pliability, no specular hotspots)`
  }

  // Generic fallback: workbook material wins, hint only if finish gives one.
  if (wantsMatte) return `${raw} (matte, diffuse, no specular hotspots)`
  if (wantsGloss) return `${raw} (high-gloss, sharp specular highlights)`
  return raw
}

function describeFinish(component: ComponentSpec): string {
  const finish = component.finish?.trim()
  if (!finish) return ''
  const f = finish.toLowerCase()
  if (/(holograph|iridescent|pearlescent)/.test(f)) {
    return `${finish} finish — embedded in the material, not painted on top. No chromatic banding outside the intended region.`
  }
  return `${finish.toLowerCase()} finish`
}

/* ── Per-component recolour line ───────────────────────────────────────── */

function describeComponent(component: ComponentSpec): string {
  const colour = component.pantone
    ? `${component.pantone}${component.colorHex ? ` (≈ ${component.colorHex})` : ''}`
    : component.colorHex ?? null

  const parts: string[] = []
  if (colour) parts.push(`recolour to ${colour}`)
  const material = describeMaterial(component)
  if (material) parts.push(material)
  const finish = describeFinish(component)
  if (finish) parts.push(finish)
  if (component.technique) parts.push(`technique: ${component.technique}`)
  if (parts.length === 0) {
    return `${component.label}: keep as in the reference`
  }
  return `${component.label}: ${parts.join(', ')}`
}

/* ── Public ─────────────────────────────────────────────────────────────── */

export interface BuildCmfPromptOptions {
  /**
   * Which lighting/mood variant to use (cycled per-attempt by the render
   * service). Defaults to attempt 1 (`Studio Classic`, Damien's gold
   * standard) when omitted, so any caller that doesn't care about variants
   * still produces the canonical prompt.
   */
  variantIndex?: number
}

export interface BuildCmfPromptResult {
  basePrompt: string
  componentLines: string[]
  variant: PromptVariant
}

/**
 * Build the CMF recolour prompt. Returns the prompt string, the
 * per-component lines (so the PDF generator can echo the same breakdown
 * the model saw), and the resolved variant (so the attempt row can record
 * which mood produced it).
 */
export function buildCmfPrompt(
  row: CmfSkuRow,
  opts?: BuildCmfPromptOptions
): BuildCmfPromptResult {
  const product = getCmfProduct(row.productSlug)
  if (!product) {
    throw new Error(`Unknown CMF product slug: ${row.productSlug}`)
  }

  const componentLines = row.components.map(describeComponent)

  const protectedSurfaces = product.components
    .filter((c) => !row.components.find((rc) => rc.region === c.region))
    .map((c) => c.label)

  const productPhrase = product.promptDescriptor
  const colourwayLabel = row.colorwayName ?? row.label
  const variant = selectPromptVariant(opts?.variantIndex ?? 0)

  const lines: string[] = [
    `Using the provided 3D clown CMF render of ${productPhrase}, convert it into a photorealistic studio product shot in the "${colourwayLabel}" colourway.`,
    '',
    `Preserve the geometry, design, angle, framing, composition, and the relative positions of every unit exactly as in the source image. Do not alter the pose, perspective, scale, silhouette, parting lines, or any structural detail. Keep any text, markings, or labels (e.g. "L"/"R", logos, etched artwork) intact in the same location and orientation. Keep the source background unchanged.`,
    '',
    `Replace only the materials, colors, and lighting as follows:`,
    ...componentLines.map((l) => `- ${l}`),
  ]

  if (protectedSurfaces.length > 0) {
    lines.push('')
    lines.push(
      `Do NOT change: ${protectedSurfaces.join(', ')}. Keep them visually identical to the reference image.`
    )
  }

  lines.push('')
  lines.push(variant.lightingClause)

  lines.push('')
  lines.push(
    `Photorealistic 4K product render quality with believable micro-surface detail. Output should look like a real photographed sample, not a CGI render.`
  )

  if (row.notes) {
    lines.push('')
    lines.push(`Designer notes: ${row.notes}`)
  }

  return {
    basePrompt: lines.join('\n'),
    componentLines,
    variant,
  }
}

/**
 * Build a filename-safe slug for the PDF output, matching the user-requested
 * pattern: `CMF-001234revA_Switch2_CMF_Sage.pdf`.
 */
export function buildPacketFileSlug(args: {
  cmfCode?: string | null
  productSlug: string
  colorwayName?: string | null
}): string {
  const product = getCmfProduct(args.productSlug)
  const productName = product?.name.replace(/\s+/g, '') ?? args.productSlug
  const cmf = args.cmfCode ?? 'CMF-DRAFT'
  const colour = args.colorwayName?.replace(/\s+/g, '_') ?? 'Colorway'
  return `${cmf}_${productName}_CMF_${colour}`
}
