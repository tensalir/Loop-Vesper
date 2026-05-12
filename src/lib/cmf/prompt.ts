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

import type { CmfSkuRow, ComponentSpec, PaletteSwatch } from './schema'
import { getCmfProduct } from './products'

/* ── Clown reference metadata ──────────────────────────────────────────── */

/**
 * The "clown" reference image is a multi-coloured render of the product
 * where each recolourable surface is painted a distinct, easy-to-identify
 * colour. When the resolved clown asset carries per-region colour metadata,
 * we can tell the model which clown colour maps to which CMF component
 * instead of relying on label-only addressing.
 *
 * Example: "the red surface on the reference (POM ring): recolour to
 * Pantone 7720C …" gives Nano Banana an unambiguous region anchor and
 * dramatically improves which surface actually gets the new material.
 */
export interface ClownComponentMeta {
  region: string
  label: string
  colorHex?: string | null
}

/**
 * Map an unbounded hex value to a short, model-friendly colour word. Hex
 * itself is ambiguous to image models ("#ff3344 region" is hard to spot);
 * named colours line up with how a designer points at the clown verbally.
 */
function describeClownHex(hex: string): string {
  const normalised = hex.startsWith('#') ? hex.slice(1) : hex
  if (normalised.length !== 6) return hex
  const r = parseInt(normalised.slice(0, 2), 16)
  const g = parseInt(normalised.slice(2, 4), 16)
  const b = parseInt(normalised.slice(4, 6), 16)
  // HSL conversion for an easy hue/saturation/lightness bucketing.
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case rN:
        h = ((gN - bN) / d) % 6
        break
      case gN:
        h = (bN - rN) / d + 2
        break
      default:
        h = (rN - gN) / d + 4
    }
    h = Math.round(h * 60)
    if (h < 0) h += 360
  }

  // Very dark / very light → grayscale buckets, even when saturated.
  if (l < 0.1) return 'near-black'
  if (l > 0.92 && s < 0.2) return 'white'
  if (s < 0.12) return l < 0.4 ? 'dark grey' : l > 0.7 ? 'light grey' : 'grey'

  // Hue buckets tuned for the clown palettes designers tend to author.
  if (h < 15 || h >= 345) return 'red'
  if (h < 35) return 'orange'
  if (h < 55) return 'yellow-orange'
  if (h < 70) return 'yellow'
  if (h < 95) return 'lime green'
  if (h < 150) return 'green'
  if (h < 175) return 'teal'
  if (h < 200) return 'cyan'
  if (h < 235) return 'blue'
  if (h < 265) return 'indigo'
  if (h < 290) return 'purple'
  if (h < 320) return 'magenta'
  return 'pink'
}

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
  // VDI 21 / VDI 22 are explicit matte texture spec; treat them as the
  // "deep matte" cue the factory sheet expects.
  const wantsVdiMatte = /(vdi\s*2[0-9]|vdi\s*1[0-9])/.test(finishLower)
  const wantsMatte = /(matte|matt)/.test(finishLower) || wantsVdiMatte
  const wantsTranslucent = /(translucent|milky|see.?through|shore\s*30)/.test(
    m + ' ' + finishLower
  )

  // POM — matte spec from Damien's Switch 2 pack. Carry the verbatim "Matte"
  // wording the workbook uses so the model never confuses POM with a glossy
  // injection-moulded plastic.
  if (m.includes('pom')) {
    if (wantsGloss) {
      return `${raw} (rare gloss POM, sharp specular highlights, smooth micro-texture)`
    }
    return `${raw} (deeply matte engineering plastic, fine micro-texture, completely diffuse with no specular hotspots, body colour visible through pigment not coating)`
  }

  // Polycarbonate / ABS family
  if (m.includes('pc/abs') || m.includes('pc abs') || m.includes('polycarbonate')) {
    if (wantsGloss) {
      return `${raw} (high-gloss mirror polish, sharp specular highlights, deep reflections, smooth glassy injection-moulded surface)`
    }
    if (wantsNcvm) {
      return `${raw} (NCVM-coated, satin metal-like finish, brushed anisotropic highlights, fine satin grain reminiscent of anodised aluminium, subtle metallic sheen layered on top of the plastic)`
    }
    if (wantsVdiMatte) {
      return `${raw} (${component.finish} texture: deep matte injection-mould grain, fine even sand-like micro-texture, fully diffuse, no specular hotspots)`
    }
    return `${raw} (satin micro-texture, soft diffuse sheen, low specular response)`
  }
  if (m.includes('abs')) {
    if (wantsNcvm) {
      return `${raw} (NCVM-coated, satin metal-like finish, brushed anisotropic highlights, fine satin grain reminiscent of anodised aluminium, subtle metallic sheen layered on top of the plastic)`
    }
    if (wantsGloss) {
      return `${raw} (high-gloss injection-moulded plastic, sharp specular highlights, deep reflections, smooth glassy surface — clearly a polished plastic, not a metallic coating)`
    }
    if (wantsVdiMatte) {
      return `${raw} (${component.finish} texture: deep matte injection-mould grain, fine even sand-like micro-texture, fully diffuse, no specular hotspots)`
    }
    return `${raw} (satin micro-texture, soft diffuse sheen, low specular response)`
  }

  // Silicone
  if (m.includes('silicon')) {
    // "Milky see through 30%" reads as: clearly translucent, but only
    // 30% light passes — i.e. frosted, not glassy. Spell that out so the
    // model doesn't default to either fully opaque or fully transparent.
    const seeThroughMatch = /see.?through\s*(\d{1,3})/.exec(finishLower)
    if (seeThroughMatch) {
      const pct = Math.min(95, Math.max(5, Number(seeThroughMatch[1] ?? '30')))
      return `${raw} (translucent milky silicone, roughly ${pct}% light transmission so colour is clearly tinted but not glassy, gentle subsurface light scattering, frosted appearance, smooth rubbery micro-surface, light visibly passes through the thinner edges, no hard specular reflections)`
    }
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
  if (wantsBrushed) return `${raw} (brushed/satin micro-texture, soft anisotropic sheen, no harsh highlights)`
  if (wantsNcvm) return `${raw} (NCVM-coated, satin metal-like finish, brushed anisotropic highlights)`
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

/**
 * Format the target colour for a component. We lead with the hex value
 * because vision-language models parse hex literally and use it as a
 * direct sRGB target, whereas they treat Pantone codes as opaque text
 * tokens and approximate the colour from context (which lets the clown
 * reference colours bleed in). The Pantone code follows in parentheses so
 * the factory still has the canonical reference.
 */
function describeComponentColour(component: ComponentSpec): string | null {
  if (component.colorHex && component.pantone) {
    return `${component.colorHex} (${component.pantone})`
  }
  if (component.colorHex) return component.colorHex
  if (component.pantone) return component.pantone
  return null
}

function describeComponent(
  component: ComponentSpec,
  clownByRegion: Map<string, ClownComponentMeta> | null
): string {
  const colour = describeComponentColour(component)

  // Anchor the line on the clown reference colour when we have one. This is
  // the single biggest reason the model misses a region: the label "Cosmetic
  // cap" is ambiguous in the reference, but "the orange surface (Cosmetic
  // cap)" is not.
  const clownMatch = clownByRegion?.get(component.region) ?? null
  const clownColourWord =
    clownMatch?.colorHex ? describeClownHex(clownMatch.colorHex) : null
  const lineHead = clownColourWord
    ? `${component.label} (the ${clownColourWord} surface on the reference)`
    : component.label

  const parts: string[] = []
  if (colour) parts.push(`TARGET COLOUR ${colour}`)
  const material = describeMaterial(component)
  if (material) parts.push(material)
  const finish = describeFinish(component)
  if (finish) parts.push(finish)
  if (component.technique) parts.push(`technique: ${component.technique}`)
  if (parts.length === 0) {
    return `${lineHead}: keep as in the reference`
  }
  return `${lineHead}: ${parts.join(', ')}`
}

/* ── Palette context ───────────────────────────────────────────────────── */

function describePaletteSwatch(swatch: PaletteSwatch): string | null {
  const colour = swatch.pantone
    ? `${swatch.pantone}${swatch.colorHex ? ` (≈ ${swatch.colorHex})` : ''}`
    : swatch.colorHex ?? null
  if (!colour) return null
  return `${swatch.label} → ${colour}`
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
  /**
   * Optional clown reference metadata. When provided, prompt lines use
   * "the {colour} surface on the reference (Label)" addressing instead of
   * label-only, which dramatically improves which surface the model
   * recolours. Falls back silently when no metadata is available.
   */
  clownComponents?: ClownComponentMeta[] | null
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

  // Build a region → clown metadata lookup once so per-component rendering
  // stays O(1). Skip entries without a hex (they add noise without info).
  const clownByRegion = (() => {
    const entries = (opts?.clownComponents ?? []).filter((c) => c.colorHex)
    if (entries.length === 0) return null
    return new Map(entries.map((c) => [c.region, c]))
  })()

  const componentLines = row.components.map((c) =>
    describeComponent(c, clownByRegion)
  )

  const protectedSurfaces = product.components
    .filter((c) => !row.components.find((rc) => rc.region === c.region))
    .map((c) => c.label)

  const productPhrase = product.promptDescriptor
  const colourwayLabel = row.colorwayName ?? row.label
  const variant = selectPromptVariant(opts?.variantIndex ?? 0)

  const lines: string[] = [
    `Using the provided 3D clown CMF render of ${productPhrase}, convert it into a photorealistic studio product shot in the "${colourwayLabel}" colourway.`,
    '',
    // The single biggest failure mode in this pipeline is the model
    // borrowing saturated identifier colours straight from the clown
    // reference (magenta, lime, electric blue, etc.). Spell out — at the
    // top of the prompt, before the model has any colour intent —
    // that the clown's surface colours are PURELY for region
    // identification and MUST NOT appear in the output.
    `IMPORTANT — the reference image is a multi-coloured "clown" render where each surface has been painted a distinct primary colour purely to identify its region. The clown's painted colours (magenta, lime green, electric blue, orange, etc.) are LABELS, not the target palette. The output MUST use exclusively the per-component target colours listed below; none of the clown's identifier colours may appear on the final product.`,
    '',
    `Preserve the geometry, design, angle, framing, composition, and the relative positions of every unit exactly as in the source image. Do not alter the pose, perspective, scale, silhouette, parting lines, or any structural detail. Keep any text, markings, or labels (e.g. "L"/"R", logos, etched artwork) intact in the same location and orientation. Keep the source background unchanged.`,
  ]

  // Insert the clown reference legend right after the preserve clause so the
  // model knows which surface maps to which label before it reads the
  // recolour instructions. We only emit the legend for components the SKU
  // is actually touching — listing untouched regions here just dilutes
  // attention.
  if (clownByRegion) {
    const legendEntries: string[] = []
    for (const component of row.components) {
      const meta = clownByRegion.get(component.region)
      if (meta?.colorHex) {
        legendEntries.push(`${describeClownHex(meta.colorHex)} → ${component.label}`)
      }
    }
    if (legendEntries.length > 0) {
      lines.push('')
      lines.push(
        `Clown reference legend (which solid colour on the reference maps to which surface): ${legendEntries.join('; ')}.`
      )
    }
  }

  lines.push('')
  lines.push(`Replace only the materials, colors, and lighting as follows:`)
  lines.push(...componentLines.map((l) => `- ${l}`))

  if (protectedSurfaces.length > 0) {
    lines.push('')
    lines.push(
      `Do NOT change: ${protectedSurfaces.join(', ')}. Keep them visually identical to the reference image.`
    )
  }

  // Palette context: the workbook often carries an overall CMF palette
  // beyond the per-component swatches (collection accents, packaging cues,
  // etc.). Surface it so the model keeps cross-part colour harmony rather
  // than treating every component as a free variable.
  const paletteLines = (row.palette ?? [])
    .map(describePaletteSwatch)
    .filter((s): s is string => Boolean(s))
  if (paletteLines.length > 0) {
    lines.push('')
    lines.push(
      `Overall CMF palette context (for colour harmony, not extra surfaces to recolour): ${paletteLines.join('; ')}.`
    )
  }

  // Final colour palette recap. We deliberately repeat the per-component
  // target colours one more time as a flat, easy-to-scan list right
  // before the quality bar. Models that fall back to the dominant
  // colours in the reference image when the prompt gets long benefit
  // hugely from a second pass at the intended palette — and it's the
  // place to put the negative constraint about clown colours again so
  // it's still in attention when the model commits to its output.
  const finalPaletteLines: string[] = []
  for (const component of row.components) {
    const colour = describeComponentColour(component)
    if (colour) finalPaletteLines.push(`${component.label} → ${colour}`)
  }
  if (finalPaletteLines.length > 0) {
    lines.push('')
    lines.push(
      `Final colour palette (these are the ONLY colours that may appear on the recoloured surfaces; do not borrow any colour from the clown reference): ${finalPaletteLines.join('; ')}.`
    )
  }

  lines.push('')
  lines.push(variant.lightingClause)

  lines.push('')
  lines.push(
    `Photorealistic 4K product render quality with believable micro-surface detail. Material fidelity is critical — finish (matte vs satin vs gloss, NCVM, VDI texture, milky translucent silicone, brushed metal) must read correctly even when the colour is matched. Colour fidelity is equally critical — every recoloured surface must read as its specified hex/Pantone target, NOT as the saturated identifier colour from the clown reference. Output should look like a real photographed sample, not a CGI render.`
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
