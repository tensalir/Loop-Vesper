/**
 * Evaluation and rollout: metrics, shadow mode, quality gates.
 * Used by evaluation suite and rollout phases (shadow -> assisted -> default).
 */

import type { LayoutSpec } from '../schema/layoutSpec'
import { scoreLayoutSpec } from './layoutScore'

export type RolloutPhase = 'shadow' | 'assisted' | 'default'

export interface EvalMetrics {
  brandComplianceScore: number
  safeZoneViolationRate: number
  readabilityScore: number
  designerAcceptanceRate?: number
  correctionMagnitude?: number
}

/**
 * Compute evaluation metrics for a single layout spec.
 */
export function computeEvalMetrics(
  spec: LayoutSpec,
  formatId?: string
): Omit<EvalMetrics, 'designerAcceptanceRate' | 'correctionMagnitude'> {
  const score = scoreLayoutSpec(spec, formatId ?? spec.formatId)
  return {
    brandComplianceScore: score.brandComplianceScore,
    safeZoneViolationRate: score.valid ? 0 : score.violations.length,
    readabilityScore: score.readabilityScore,
  }
}

/**
 * Quality gate: whether the spec is acceptable for the current rollout phase.
 */
export function passesQualityGate(spec: LayoutSpec, phase: RolloutPhase, formatId?: string): boolean {
  const score = scoreLayoutSpec(spec, formatId ?? spec.formatId)
  if (phase === 'shadow') return true
  if (phase === 'assisted') return score.safeZoneScore >= 0.75
  return score.valid && score.brandComplianceScore >= 0.8
}

export interface EvalSuiteResult {
  count: number
  avgBrandCompliance: number
  avgReadability: number
  totalSafeZoneViolations: number
  safeZoneViolationRate: number
  shadowPassRate: number
  assistedPassRate: number
  defaultPassRate: number
}

/**
 * Run the evaluation suite on a set of layout specs (e.g. ~50 representative ads).
 */
export function runEvalSuite(
  specs: LayoutSpec[],
  options?: { formatId?: string }
): EvalSuiteResult {
  if (specs.length === 0) {
    return {
      count: 0,
      avgBrandCompliance: 0,
      avgReadability: 0,
      totalSafeZoneViolations: 0,
      safeZoneViolationRate: 0,
      shadowPassRate: 1,
      assistedPassRate: 1,
      defaultPassRate: 1,
    }
  }
  let totalBrand = 0
  let totalReadability = 0
  let totalViolations = 0
  let shadowPass = 0
  let assistedPass = 0
  let defaultPass = 0
  for (const spec of specs) {
    const m = computeEvalMetrics(spec, options?.formatId)
    totalBrand += m.brandComplianceScore
    totalReadability += m.readabilityScore
    totalViolations += m.safeZoneViolationRate
    if (passesQualityGate(spec, 'shadow', options?.formatId)) shadowPass++
    if (passesQualityGate(spec, 'assisted', options?.formatId)) assistedPass++
    if (passesQualityGate(spec, 'default', options?.formatId)) defaultPass++
  }
  const n = specs.length
  return {
    count: n,
    avgBrandCompliance: totalBrand / n,
    avgReadability: totalReadability / n,
    totalSafeZoneViolations: totalViolations,
    safeZoneViolationRate: totalViolations / n,
    shadowPassRate: shadowPass / n,
    assistedPassRate: assistedPass / n,
    defaultPassRate: defaultPass / n,
  }
}
