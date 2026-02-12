/**
 * Behavioral Cohorts & Intent Funnels
 * 
 * Identifies usage patterns and tracks semantic journey quality.
 * Cohorts describe exploration styles, not productivity.
 */

/**
 * Behavioral cohort types (neutral, descriptive labels)
 */
export const COHORT_TYPES = {
  BURST: 'burst',           // High activity, short windows
  ITERATIVE: 'iterative',   // Many revisions per concept
  EXPLORER: 'explorer',     // Many model switches
  CONVERTER: 'converter',   // Reaches download/completion phase
  CASUAL: 'casual',         // Low frequency, occasional use
} as const

export type CohortType = typeof COHORT_TYPES[keyof typeof COHORT_TYPES]

/**
 * User cohort assignment with confidence
 */
export interface UserCohort {
  userId: string
  primaryCohort: CohortType
  confidence: number // 0-1
  secondaryCohort?: CohortType
  
  // Supporting metrics
  metrics: {
    avgSessionDuration?: number // minutes
    avgIterationsPerConcept?: number
    modelSwitchRate?: number // switches per 10 generations
    completionRate?: number // percentage
    frequencyDays?: number // generations per day
  }
}

/**
 * Funnel stages for intent-to-outcome tracking
 */
export const FUNNEL_STAGES = {
  GENERATED: 'generated',         // Output was created
  ANALYZED: 'analyzed',           // Output was semantically analyzed
  ITERATED: 'iterated',           // User created follow-up generation
  ENGAGED: 'engaged',             // Output was bookmarked, noted, or approved
  COMPLETED: 'completed',         // Output was downloaded or shared
} as const

export type FunnelStage = typeof FUNNEL_STAGES[keyof typeof FUNNEL_STAGES]

/**
 * Funnel metrics by dimension
 */
export interface FunnelMetrics {
  dimension: string // intent category, model ID, project ID, etc
  dimensionLabel: string
  
  stages: {
    [K in FunnelStage]: {
      count: number
      percentage: number // relative to GENERATED
      dropoffFromPrevious?: number // percentage dropped from previous stage
    }
  }
  
  // Conversion rates
  generatedToCompleted: number // end-to-end conversion percentage
  engagementRate: number // percentage that reached ENGAGED or beyond
}

/**
 * Calculate user cohort from behavior metrics
 */
export function calculateUserCohort(metrics: {
  totalGenerations: number
  timeSpanDays: number
  avgIterationsPerSession?: number
  uniqueModelsUsed?: number
  downloadsOrShares?: number
}): UserCohort | null {
  const { totalGenerations, timeSpanDays, avgIterationsPerSession, uniqueModelsUsed, downloadsOrShares } = metrics
  
  if (totalGenerations === 0 || timeSpanDays === 0) {
    return null
  }
  
  const generationsPerDay = totalGenerations / timeSpanDays
  const completionRate = downloadsOrShares ? (downloadsOrShares / totalGenerations) * 100 : 0
  const modelSwitchRate = uniqueModelsUsed ? (uniqueModelsUsed / totalGenerations) * 10 : 0
  
  let primaryCohort: CohortType
  let confidence = 0.5
  let secondaryCohort: CohortType | undefined
  
  // Decision tree for cohort assignment
  
  // High completion rate → Converter
  if (completionRate > 40) {
    primaryCohort = COHORT_TYPES.CONVERTER
    confidence = 0.7 + (completionRate - 40) / 200 // 0.7-0.9
  }
  // High iterations → Iterative
  else if (avgIterationsPerSession && avgIterationsPerSession > 5) {
    primaryCohort = COHORT_TYPES.ITERATIVE
    confidence = 0.6 + (avgIterationsPerSession - 5) / 50 // 0.6-0.8
    if (completionRate > 20) {
      secondaryCohort = COHORT_TYPES.CONVERTER
    }
  }
  // High model switching → Explorer
  else if (modelSwitchRate > 3) {
    primaryCohort = COHORT_TYPES.EXPLORER
    confidence = 0.6 + modelSwitchRate / 50 // 0.6-0.8
  }
  // High frequency, short time span → Burst
  else if (generationsPerDay > 10 && timeSpanDays < 7) {
    primaryCohort = COHORT_TYPES.BURST
    confidence = 0.7
    if (avgIterationsPerSession && avgIterationsPerSession > 3) {
      secondaryCohort = COHORT_TYPES.ITERATIVE
    }
  }
  // Low frequency → Casual
  else if (generationsPerDay < 1) {
    primaryCohort = COHORT_TYPES.CASUAL
    confidence = 0.6
  }
  // Default to explorer with low confidence
  else {
    primaryCohort = COHORT_TYPES.EXPLORER
    confidence = 0.4
  }
  
  return {
    userId: '', // Set by caller
    primaryCohort,
    confidence: Math.min(0.95, confidence),
    secondaryCohort,
    metrics: {
      avgIterationsPerConcept: avgIterationsPerSession,
      modelSwitchRate,
      completionRate,
      frequencyDays: generationsPerDay,
    },
  }
}

/**
 * Calculate funnel conversion metrics
 */
export function calculateFunnelMetrics(
  dimension: string,
  dimensionLabel: string,
  stageCounts: Partial<Record<FunnelStage, number>>
): FunnelMetrics {
  const generated = stageCounts[FUNNEL_STAGES.GENERATED] || 0
  const analyzed = stageCounts[FUNNEL_STAGES.ANALYZED] || 0
  const iterated = stageCounts[FUNNEL_STAGES.ITERATED] || 0
  const engaged = stageCounts[FUNNEL_STAGES.ENGAGED] || 0
  const completed = stageCounts[FUNNEL_STAGES.COMPLETED] || 0
  
  const toPercentage = (count: number) => generated > 0 ? (count / generated) * 100 : 0
  
  return {
    dimension,
    dimensionLabel,
    stages: {
      [FUNNEL_STAGES.GENERATED]: {
        count: generated,
        percentage: 100,
      },
      [FUNNEL_STAGES.ANALYZED]: {
        count: analyzed,
        percentage: toPercentage(analyzed),
        dropoffFromPrevious: generated > 0 ? ((generated - analyzed) / generated) * 100 : 0,
      },
      [FUNNEL_STAGES.ITERATED]: {
        count: iterated,
        percentage: toPercentage(iterated),
        dropoffFromPrevious: analyzed > 0 ? ((analyzed - iterated) / analyzed) * 100 : 0,
      },
      [FUNNEL_STAGES.ENGAGED]: {
        count: engaged,
        percentage: toPercentage(engaged),
        dropoffFromPrevious: iterated > 0 ? ((iterated - engaged) / iterated) * 100 : 0,
      },
      [FUNNEL_STAGES.COMPLETED]: {
        count: completed,
        percentage: toPercentage(completed),
        dropoffFromPrevious: engaged > 0 ? ((engaged - completed) / engaged) * 100 : 0,
      },
    },
    generatedToCompleted: toPercentage(completed),
    engagementRate: toPercentage(Math.max(engaged, completed)),
  }
}

/**
 * Cohort distribution summary
 */
export interface CohortDistribution {
  total: number
  cohorts: Array<{
    cohort: CohortType
    count: number
    percentage: number
    avgConfidence: number
  }>
}

/**
 * Calculate cohort distribution from user cohorts
 */
export function calculateCohortDistribution(userCohorts: UserCohort[]): CohortDistribution {
  const total = userCohorts.length
  const cohortCounts = new Map<CohortType, { count: number; totalConfidence: number }>()
  
  for (const uc of userCohorts) {
    const existing = cohortCounts.get(uc.primaryCohort) || { count: 0, totalConfidence: 0 }
    cohortCounts.set(uc.primaryCohort, {
      count: existing.count + 1,
      totalConfidence: existing.totalConfidence + uc.confidence,
    })
  }
  
  const cohorts = Array.from(cohortCounts.entries())
    .map(([cohort, data]) => ({
      cohort,
      count: data.count,
      percentage: total > 0 ? (data.count / total) * 100 : 0,
      avgConfidence: data.count > 0 ? data.totalConfidence / data.count : 0,
    }))
    .sort((a, b) => b.count - a.count)
  
  return { total, cohorts }
}
