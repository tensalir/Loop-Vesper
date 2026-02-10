/**
 * Fuzzy constraint interpreter: hard rails (deterministic) + soft brand intent.
 * Hard rails: safe zones, contrast, legal text size. Soft: LLM-interpreted brand intent.
 */

import type { LayoutSpec, LayoutSpecTextBlock } from '../schema/layoutSpec'
import { getSocialCreativeSpec, type SocialCreativeSpec } from '../schema/socialCreativeSpec'

export interface ValidationResult {
  valid: boolean
  violations: string[]
  /** Per-block violations (e.g. "block headline-1 in safe zone"). */
  blockViolations?: Array<{ blockId: string; message: string }>
}

/**
 * Hard rails: validate that a LayoutSpec obeys safe zones and legal/CTA constraints.
 * All coordinates in spec are normalized 0-1; we convert to px using spec widthPx/heightPx.
 */
export function validateLayoutSpec(
  spec: LayoutSpec,
  formatId?: string
): ValidationResult {
  const creativeSpec = getSocialCreativeSpec(formatId ?? spec.formatId)
  if (!creativeSpec) {
    return {
      valid: false,
      violations: [`Unknown format: ${formatId ?? spec.formatId}`],
    }
  }

  const violations: string[] = []
  const blockViolations: Array<{ blockId: string; message: string }> = []
  const sz = creativeSpec.platformFormat.safeZone
  const w = spec.widthPx
  const h = spec.heightPx

  const topNorm = sz.topPx / h
  const bottomNorm = 1 - sz.bottomPx / h
  const leftNorm = sz.leftPx / w
  const rightNorm = 1 - sz.rightPx / w

  for (const block of spec.textBlocks) {
    const { bbox } = block
    const blockId = block.id

    if (bbox.y < topNorm) {
      blockViolations.push({
        blockId,
        message: `Text block "${blockId}" extends into top safe zone (y=${bbox.y.toFixed(2)} < ${topNorm.toFixed(2)})`,
      })
    }
    if (bbox.y + bbox.height > bottomNorm) {
      blockViolations.push({
        blockId,
        message: `Text block "${blockId}" extends into bottom safe zone`,
      })
    }
    if (bbox.x < leftNorm) {
      blockViolations.push({
        blockId,
        message: `Text block "${blockId}" extends into left safe zone`,
      })
    }
    if (bbox.x + bbox.width > rightNorm) {
      blockViolations.push({
        blockId,
        message: `Text block "${blockId}" extends into right safe zone`,
      })
    }

    if (block.role === 'cta') {
      const minH = creativeSpec.ctaConstraint.minHeightPx ?? 44
      const minW = creativeSpec.ctaConstraint.minWidthPx ?? 120
      const blockH = bbox.height * h
      const blockW = bbox.width * w
      if (blockH < minH || blockW < minW) {
        blockViolations.push({
          blockId,
          message: `CTA block "${blockId}" below minimum size (${blockW.toFixed(0)}x${blockH.toFixed(0)} px, min ${minW}x${minH})`,
        })
      }
    }

    if (block.role === 'legal') {
      const minSize = creativeSpec.legalTextConstraint.minFontSizePx
      const scale = block.scale ?? 1
      const approxPx = scale * 16
      if (approxPx < minSize) {
        blockViolations.push({
          blockId,
          message: `Legal text "${blockId}" effective size ~${approxPx.toFixed(0)}px below minimum ${minSize}px`,
        })
      }
    }
  }

  if (blockViolations.length > 0) {
    violations.push(...blockViolations.map((b) => b.message))
  }

  return {
    valid: violations.length === 0,
    violations,
    blockViolations: blockViolations.length > 0 ? blockViolations : undefined,
  }
}

/**
 * Apply language scale factor to text block max width or scale (for longer languages).
 */
export function getLanguageScaleFactor(
  language: string,
  creativeSpec: SocialCreativeSpec | null
): number {
  const factors = creativeSpec?.languageScaleFactors
  if (!factors) return 1
  const key = language.toLowerCase().slice(0, 2)
  return factors[key] ?? 1
}
