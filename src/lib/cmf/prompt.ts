/**
 * Deterministic prompt builder for the CMF recolour pass.
 *
 * Given a normalised SKU row (product + components + Pantone/material/finish),
 * we produce a compact prompt that tells Nano Banana Pro:
 *   - Treat the attached image as the existing product geometry.
 *   - Recolour each named component to the supplied Pantone (or hex fallback).
 *   - Preserve geometry, lighting, framing, and identity.
 *   - Do not add extraneous elements.
 *
 * The output is a single string designed to be passed straight to the Vesper
 * `enhancePrompt` service for Nano Banana–optimised polishing. The downstream
 * prompt-enhancement service requires the prefix "Using the attached image,"
 * for editing flows; we add it here so callers don't have to.
 */

import type { CmfSkuRow, ComponentSpec } from './schema'
import { getCmfProduct } from './products'

function describeComponent(component: ComponentSpec): string {
  const colour = component.pantone
    ? `${component.pantone}${component.colorHex ? ` (≈ ${component.colorHex})` : ''}`
    : component.colorHex ?? null

  const parts: string[] = []
  if (colour) {
    parts.push(`recolour to ${colour}`)
  }
  if (component.material) {
    parts.push(`material ${component.material}`)
  }
  if (component.finish) {
    parts.push(`${component.finish.toLowerCase()} finish`)
  }
  if (component.technique) {
    parts.push(`(${component.technique})`)
  }
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
