/**
 * Pattern-Based Analytics Insights
 * 
 * Rule-based insights that surface semantic patterns, model affinity,
 * and convergence signals. No efficiency/waste framing.
 */

import { CohortType, FunnelMetrics } from './cohorts'

/**
 * Insight types
 */
export const INSIGHT_TYPES = {
  OPPORTUNITY: 'opportunity',     // Potential action or exploration
  WARNING: 'warning',             // Attention needed
  SUCCESS: 'success',             // Positive pattern
  NEUTRAL: 'neutral',             // Informational observation
} as const

export type InsightType = typeof INSIGHT_TYPES[keyof typeof INSIGHT_TYPES]

/**
 * Insight card
 */
export interface Insight {
  id: string
  type: InsightType
  title: string
  description: string
  actionable?: string // Suggested action
  metrics?: Record<string, number | string> // Supporting data
  confidence: number // 0-1
}

/**
 * Analyze project funnel for pattern insights
 */
export function analyzeProjectFunnel(
  projectName: string,
  funnel: FunnelMetrics
): Insight[] {
  const insights: Insight[] = []
  
  // High exploration, low engagement → may need clearer direction
  if (funnel.stages.generated.count > 25 && funnel.engagementRate < 20) {
    insights.push({
      id: `funnel-exploration-${funnel.dimension}`,
      type: INSIGHT_TYPES.NEUTRAL,
      title: `${projectName}: Broad Exploration`,
      description: `${funnel.stages.generated.count} generations with ${funnel.engagementRate.toFixed(1)}% reaching engagement (bookmarks/approvals). This suggests wide exploration—you may still be finding the direction.`,
      actionable: 'Consider reviewing early outputs to identify patterns you want to explore further.',
      metrics: {
        generations: funnel.stages.generated.count,
        engagementRate: `${funnel.engagementRate.toFixed(1)}%`,
      },
      confidence: 0.6,
    })
  }
  
  // High engagement but few completions → workflow observation
  if (funnel.stages.engaged.count > 12 && funnel.stages.engaged.percentage > 35 && funnel.generatedToCompleted < 25) {
    insights.push({
      id: `funnel-engagement-pattern-${funnel.dimension}`,
      type: INSIGHT_TYPES.NEUTRAL,
      title: `${projectName}: High Engagement Pattern`,
      description: `${funnel.stages.engaged.percentage.toFixed(0)}% of outputs receive engagement (bookmarks/approvals) but ${funnel.generatedToCompleted.toFixed(1)}% reach download. This shows clear curation happening.`,
      actionable: 'Your engaged outputs may reveal your quality criteria—review what patterns they share.',
      metrics: {
        engagementRate: `${funnel.stages.engaged.percentage.toFixed(0)}%`,
        completionRate: `${funnel.generatedToCompleted.toFixed(1)}%`,
      },
      confidence: 0.7,
    })
  }
  
  // Strong convergence pattern
  if (funnel.stages.generated.count > 20 && funnel.generatedToCompleted > 45) {
    insights.push({
      id: `funnel-strong-convergence-${funnel.dimension}`,
      type: INSIGHT_TYPES.SUCCESS,
      title: `${projectName}: Strong Convergence`,
      description: `${funnel.generatedToCompleted.toFixed(1)}% of generations reach completion across ${funnel.stages.generated.count} outputs. This suggests focused exploration with clear success criteria.`,
      actionable: 'Document what makes these outputs successful—this pattern could guide similar work.',
      metrics: {
        completionRate: `${funnel.generatedToCompleted.toFixed(1)}%`,
        generations: funnel.stages.generated.count,
      },
      confidence: 0.8,
    })
  }
  
  return insights
}

/**
 * Analyze semantic patterns for insights
 */
export function analyzeSemanticPatterns(
  patterns: {
    topSubjects?: Array<{ subject: string; count: number }>
    topStyles?: Array<{ style: string; count: number }>
    topMoods?: Array<{ mood: string; count: number }>
  }
): Insight[] {
  const insights: Insight[] = []
  
  if (!patterns.topSubjects || !patterns.topStyles) {
    return insights
  }
  
  // Dominant subject + style combination
  if (patterns.topSubjects.length > 0 && patterns.topStyles.length > 0) {
    const topSubject = patterns.topSubjects[0]
    const topStyle = patterns.topStyles[0]
    
    if (topSubject.count > 5 && topStyle.count > 5) {
      insights.push({
        id: 'semantic-primary-territory',
        type: INSIGHT_TYPES.NEUTRAL,
        title: 'Primary Creative Territory',
        description: `Your work clusters around ${topSubject.subject} subjects with ${topStyle.style} styling. This is your most-explored creative space.`,
        metrics: {
          subject: topSubject.subject,
          style: topStyle.style,
          subjectCount: topSubject.count,
          styleCount: topStyle.count,
        },
        confidence: 0.7,
      })
    }
  }
  
  // Mood signature
  if (patterns.topMoods && patterns.topMoods.length > 0) {
    const topMood = patterns.topMoods[0]
    
    if (topMood.count > 8) {
      insights.push({
        id: 'semantic-mood-signature',
        type: INSIGHT_TYPES.NEUTRAL,
        title: 'Mood Signature',
        description: `${topMood.mood} mood appears in ${topMood.count} outputs. This may be a signature aesthetic element of your work.`,
        metrics: {
          mood: topMood.mood,
          count: topMood.count,
        },
        confidence: 0.65,
      })
    }
  }
  
  return insights
}

/**
 * Analyze model affinity patterns
 */
export function analyzeModelAffinity(
  modelPatterns: Array<{
    modelName: string
    topSubjects?: Array<{ subject: string; count: number }>
    topStyles?: Array<{ style: string; count: number }>
    totalGenerations: number
  }>
): Insight[] {
  const insights: Insight[] = []
  
  if (modelPatterns.length < 2) {
    return insights
  }
  
  // Find models with distinct subject territories
  for (let i = 0; i < Math.min(2, modelPatterns.length); i++) {
    const model = modelPatterns[i]
    
    if (!model.topSubjects || model.topSubjects.length === 0) {
      continue
    }
    
    const topSubject = model.topSubjects[0]
    
    if (topSubject.count > 5 && model.totalGenerations > 10) {
      insights.push({
        id: `model-affinity-${model.modelName.replace(/[^a-z0-9]/gi, '-')}`,
        type: INSIGHT_TYPES.NEUTRAL,
        title: `${model.modelName}: Creative Territory`,
        description: `This model is your primary choice for ${topSubject.subject} subjects (${topSubject.count} generations). It has established territory in your workflow.`,
        metrics: {
          model: model.modelName,
          primarySubject: topSubject.subject,
          count: topSubject.count,
        },
        confidence: 0.7,
      })
    }
  }
  
  return insights
}

/**
 * Analyze convergence signals (what patterns appear in keeper outputs)
 */
export function analyzeConvergenceSignals(
  signals: {
    keeperSubjects?: Array<{ subject: string; convergenceRate: number; keeperCount: number }>
    keeperStyles?: Array<{ style: string; convergenceRate: number; keeperCount: number }>
    keeperMoods?: Array<{ mood: string; convergenceRate: number; keeperCount: number }>
  }
): Insight[] {
  const insights: Insight[] = []
  
  // High-convergence subjects
  if (signals.keeperSubjects && signals.keeperSubjects.length > 0) {
    const topConvergence = signals.keeperSubjects
      .filter(s => s.keeperCount >= 3)
      .sort((a, b) => b.convergenceRate - a.convergenceRate)[0]
    
    if (topConvergence && topConvergence.convergenceRate > 50) {
      insights.push({
        id: 'convergence-subject',
        type: INSIGHT_TYPES.SUCCESS,
        title: 'High-Value Subject Pattern',
        description: `${topConvergence.subject} subjects convert to keepers at ${topConvergence.convergenceRate.toFixed(0)}%—significantly higher than average. This may be your quality signature.`,
        actionable: 'Consider focusing on this subject for important work.',
        metrics: {
          subject: topConvergence.subject,
          convergenceRate: `${topConvergence.convergenceRate.toFixed(0)}%`,
          keeperCount: topConvergence.keeperCount,
        },
        confidence: 0.75,
      })
    }
  }
  
  // High-convergence styles
  if (signals.keeperStyles && signals.keeperStyles.length > 0) {
    const topStyle = signals.keeperStyles
      .filter(s => s.keeperCount >= 3)
      .sort((a, b) => b.convergenceRate - a.convergenceRate)[0]
    
    if (topStyle && topStyle.convergenceRate > 55) {
      insights.push({
        id: 'convergence-style',
        type: INSIGHT_TYPES.SUCCESS,
        title: 'Style Resonance',
        description: `${topStyle.style} styling appears in ${topStyle.convergenceRate.toFixed(0)}% of your keeper outputs. This style resonates with your goals.`,
        metrics: {
          style: topStyle.style,
          convergenceRate: `${topStyle.convergenceRate.toFixed(0)}%`,
        },
        confidence: 0.7,
      })
    }
  }
  
  return insights
}

/**
 * Analyze cohort distribution for insights
 */
export function analyzeCohortDistribution(
  cohortDistribution: { cohort: CohortType; percentage: number }[]
): Insight[] {
  const insights: Insight[] = []
  
  if (cohortDistribution.length === 0) return insights
  
  const converter = cohortDistribution.find(c => c.cohort === 'converter')
  const explorer = cohortDistribution.find(c => c.cohort === 'explorer')
  const iterative = cohortDistribution.find(c => c.cohort === 'iterative')
  
  // High converter ratio
  if (converter && converter.percentage > 40) {
    insights.push({
      id: 'cohort-converter-pattern',
      type: INSIGHT_TYPES.NEUTRAL,
      title: 'Converter Pattern',
      description: `${converter.percentage.toFixed(0)}% of users show a converter pattern (high completion rate). The workspace workflow supports reaching final outputs.`,
      metrics: {
        converterPercentage: `${converter.percentage.toFixed(0)}%`,
      },
      confidence: 0.7,
    })
  }
  
  // High explorer ratio
  if (explorer && explorer.percentage > 45) {
    insights.push({
      id: 'cohort-explorer-pattern',
      type: INSIGHT_TYPES.NEUTRAL,
      title: 'Explorer Pattern Dominant',
      description: `${explorer.percentage.toFixed(0)}% of users show explorer patterns (model variety, breadth-first). This suggests active experimentation across the workspace.`,
      metrics: {
        explorerPercentage: `${explorer.percentage.toFixed(0)}%`,
      },
      confidence: 0.65,
    })
  }
  
  // High iterative ratio
  if (iterative && iterative.percentage > 35) {
    insights.push({
      id: 'cohort-iterative-pattern',
      type: INSIGHT_TYPES.NEUTRAL,
      title: 'Iterative Working Style',
      description: `${iterative.percentage.toFixed(0)}% of users work iteratively (many revisions per concept). Deep exploration is common in this workspace.`,
      metrics: {
        iterativePercentage: `${iterative.percentage.toFixed(0)}%`,
      },
      confidence: 0.7,
    })
  }
  
  return insights
}

/**
 * Generate comprehensive insight set from analytics data
 */
export interface AnalyticsInsightInput {
  projectFunnels?: FunnelMetrics[]
  semanticPatterns?: {
    topSubjects?: Array<{ subject: string; count: number }>
    topStyles?: Array<{ style: string; count: number }>
    topMoods?: Array<{ mood: string; count: number }>
  }
  modelAffinity?: Array<{
    modelName: string
    topSubjects?: Array<{ subject: string; count: number }>
    topStyles?: Array<{ style: string; count: number }>
    totalGenerations: number
  }>
  convergenceSignals?: {
    keeperSubjects?: Array<{ subject: string; convergenceRate: number; keeperCount: number }>
    keeperStyles?: Array<{ style: string; convergenceRate: number; keeperCount: number }>
    keeperMoods?: Array<{ mood: string; convergenceRate: number; keeperCount: number }>
  }
  cohorts?: { cohort: CohortType; percentage: number }[]
}

export function generateInsights(input: AnalyticsInsightInput): Insight[] {
  const allInsights: Insight[] = []
  
  // Project funnel insights
  if (input.projectFunnels) {
    for (const funnel of input.projectFunnels) {
      allInsights.push(...analyzeProjectFunnel(funnel.dimensionLabel, funnel))
    }
  }
  
  // Semantic pattern insights
  if (input.semanticPatterns) {
    allInsights.push(...analyzeSemanticPatterns(input.semanticPatterns))
  }
  
  // Model affinity insights
  if (input.modelAffinity) {
    allInsights.push(...analyzeModelAffinity(input.modelAffinity))
  }
  
  // Convergence signal insights
  if (input.convergenceSignals) {
    allInsights.push(...analyzeConvergenceSignals(input.convergenceSignals))
  }
  
  // Cohort insights
  if (input.cohorts) {
    allInsights.push(...analyzeCohortDistribution(input.cohorts))
  }
  
  // Sort by type priority and confidence
  return allInsights
    .sort((a, b) => {
      // Sort by type priority first (success > neutral > opportunity > warning)
      const typePriority = { success: 0, neutral: 1, opportunity: 2, warning: 3 }
      const aPriority = typePriority[a.type]
      const bPriority = typePriority[b.type]
      if (aPriority !== bPriority) return aPriority - bPriority
      
      // Then by confidence
      return b.confidence - a.confidence
    })
    .slice(0, 8) // Top 8 insights
}
