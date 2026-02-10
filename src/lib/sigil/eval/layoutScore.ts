/**
 * Layout scoring: brand compliance and readability (for evaluation and rollout).
 */

import type { LayoutSpec } from '../schema/layoutSpec'
import { validateLayoutSpec } from '../interpret/fuzzyConstraintInterpreter'

export interface LayoutScoreResult {
  /** 0-1, 1 = no violations. */
  safeZoneScore: number
  /** 0-1, placeholder for contrast/readability (requires pixel analysis to be accurate). */
  readabilityScore: number
  /** 0-1, composite. */
  brandComplianceScore: number
  violations: string[]
  valid: boolean
}

/**
 * Score a layout spec for brand compliance and readability.
 */
export function scoreLayoutSpec(spec: LayoutSpec, formatId?: string): LayoutScoreResult {
  const validation = validateLayoutSpec(spec, formatId ?? spec.formatId)
  const violationCount = validation.violations.length
  const safeZoneScore = violationCount === 0 ? 1 : Math.max(0, 1 - violationCount * 0.25)
  const readabilityScore = 0.9
  const brandComplianceScore = (safeZoneScore + readabilityScore) / 2
  return {
    safeZoneScore,
    readabilityScore,
    brandComplianceScore,
    violations: validation.violations,
    valid: validation.valid,
  }
}
