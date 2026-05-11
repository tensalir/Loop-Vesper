/**
 * Deterministic prompt builder for the CMF recolour pass.
 *
 * This is the LOCK / GUIDE-band counterpart to the `loop-cmf-generation`
 * skill in `src/lib/skills/loop-cmf-generation/`. The skill carries the
 * judgment (which attempts are good, when to push back). This file carries
 * the deterministic prompt grammar so every SKU in a packet sees the same
 * sentence structure and every workbook produces a reproducible prompt.
 *
 * The output is a single string designed to be passed straight to the
 * Vesper `enhancePrompt` service for Nano Banana-optimised polishing. That
 * service expects the prefix "Using the attached image,"; we add it here
 * so callers never forget.
 */

import type { CmfSkuRow, ComponentSpec } from './schema'
import { getCmfProduct } from './products'

/** GUIDE-level material hint appended after the workbook material text.
 * Returns null when the workbook material already carries enough signal
 * (or we have nothing useful to add). The workbook value is always kept
 * verbatim so factory matching never loses information.
 */
function describeMaterialHint(component: ComponentSpec): string | null {
  if (!component.material) return null
  const m = component.material.toLowerCase()
  // Holographic / iridescent / pearlescent are explicit hints — handled in
  // describeFinish so we don't compete with it here.
  if (m.includes('silicon')) {
    if (m.includes('shore 30') || /translucent|milky|see.?through/.test((component.finish ?? '').toLowerCase()))
      return '~30% milky translucency, soft sheen, slight light transmission'
    if (m.includes('shore 90')) return 'firm silicone, semi-gloss'
  }
  if (m.includes('foam')) return 'open-cell, slightly fibrous edge'
  if (m.includes('aluminum') || m.includes('aluminium') || m.includes('al6063')) {
    return /polish|mirror|gloss/.test((component.finish ?? '').toLowerCase())
      ? 'polished aluminium, mirror finish'
      : 'anodised aluminium, brushed satin'
  }
  return null
}

function describeFinish(component: ComponentSpec): string | null {
  if (!component.finish) return null
  const f = component.finish.toLowerCase()
  if (/(holograph|iridescent|pearlescent)/.test(f)) {
    return `${component.finish} finish, embedded in the material rather than painted on top`
  }
  return `${component.finish.toLowerCase()} finish`
}

function describeComponent(component: ComponentSpec): string {
  const colour = component.pantone
    ? `${component.pantone}${component.colorHex ? ` (≈ ${component.colorHex})` : ''}`
    : component.colorHex ?? null

  const parts: string[] = []
  if (colour) parts.push(`recolour to ${colour}`)
  if (component.material) {
    const hint = describeMaterialHint(component)
    parts.push(hint ? `material ${component.material} (${hint})` : `material ${component.material}`)
  }
  const finish = describeFinish(component)
  if (finish) parts.push(finish)
  if (component.technique) parts.push(`technique ${component.technique}`)
  if (parts.length === 0) {
    return `${component.label}: keep as in the reference`
  }
  return `${component.label}: ${parts.join(', ')}`
}

export interface BuildCmfPromptResult {
  basePrompt: string
  /** Components used in prompt — handy for unit tests and PDF spec tables. */
  componentLines: string[]
}

/**
 * Build the CMF recolour prompt. Returns both the prompt string and the
 * per-component lines so the PDF generator can show the same breakdown the
 * model saw.
 */
export function buildCmfPrompt(row: CmfSkuRow): BuildCmfPromptResult {
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

  const lines: string[] = [
    `Using the attached image as a strict geometry reference, generate ${productPhrase} in the "${colourwayLabel}" colourway.`,
    `Match the product silhouette, proportions, parting lines, lighting, camera angle and background of the reference exactly.`,
    `Apply the following CMF spec component-by-component:`,
    ...componentLines.map((l) => `- ${l}`),
  ]

  if (protectedSurfaces.length > 0) {
    lines.push(
      `Do NOT change: ${protectedSurfaces.join(
        ', '
      )}. Keep them visually identical to the reference image.`
    )
  }

  lines.push(
    `Render at production quality: clean, crisp edges; correct material response (POM matte, silicone soft sheen, polycarbonate semi-gloss unless overridden).`
  )
  lines.push(
    `Do NOT add logos, text, packaging, hands, models, props, lifestyle context, or background gradients. Single product on a clean neutral backdrop, suitable for a product CMF spec sheet.`
  )

  // If any component requests an iridescent / pearlescent / holographic
  // finish, surface the matching negative so we do not get chromatic banding
  // outside the intended region.
  const wantsIridescent = row.components.some((c) =>
    /(holograph|iridescent|pearlescent)/i.test(c.finish ?? '')
  )
  if (wantsIridescent) {
    lines.push(
      `No chromatic banding or rainbow striping outside the iridescent / holographic region. Keep the effect embedded in the material, not as a sticker.`
    )
  }

  if (row.notes) {
    lines.push(`Designer notes: ${row.notes}`)
  }

  return {
    basePrompt: lines.join('\n'),
    componentLines,
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
