/**
 * Semantic Taxonomy for Output Analysis
 * 
 * Maps actual claudeParsed fields from Claude's parsing to semantic profiles.
 * Works with the real schema from src/lib/analysis/claude.ts
 */

/**
 * Actual shape of claudeParsed (from ParsedAnalysis in claude.ts)
 */
export interface ParsedAnalysis {
  subjects: string[]      // "woman", "car", "landscape"
  styles: string[]        // "photorealistic", "cinematic", "anime"
  mood: string | null     // "dramatic", "peaceful"
  keywords: string[]      // general descriptive terms
  composition: string[]   // "close-up", "wide shot"
  lighting: string[]      // "golden hour", "studio lighting"
  colors: string[]        // "warm tones", "blue"
  quality: string[]       // "high detail", "soft focus"
  motion?: string[]       // video only: "slow pan", "tracking shot"
}

/**
 * Semantic profile extracted from claudeParsed
 */
export interface SemanticProfile {
  subjects: string[]      // Main subjects/entities
  styles: string[]        // Visual styles
  mood: string | null     // Overall mood
  colors: string[]        // Color palette
  techniques: string[]    // Combined composition + lighting + quality
  motion?: string[]       // Video motion (if present)
  keywords: string[]      // General keywords
}

/**
 * Extract semantic profile from Claude's parsed JSON
 */
export function extractSemanticProfile(claudeParsed: any): SemanticProfile {
  if (!claudeParsed || typeof claudeParsed !== 'object') {
    return { 
      subjects: [], 
      styles: [], 
      mood: null, 
      colors: [], 
      techniques: [],
      keywords: [],
    }
  }

  // Extract subjects (already arrays of strings)
  const subjects = Array.isArray(claudeParsed.subjects)
    ? claudeParsed.subjects.filter((s: any) => typeof s === 'string')
    : []

  // Extract styles
  const styles = Array.isArray(claudeParsed.styles)
    ? claudeParsed.styles.filter((s: any) => typeof s === 'string')
    : []

  // Extract mood (string or null)
  const mood = typeof claudeParsed.mood === 'string' ? claudeParsed.mood : null

  // Extract colors
  const colors = Array.isArray(claudeParsed.colors)
    ? claudeParsed.colors.filter((c: any) => typeof c === 'string')
    : []

  // Combine composition, lighting, and quality into techniques
  const techniques: string[] = []
  
  if (Array.isArray(claudeParsed.composition)) {
    techniques.push(...claudeParsed.composition.filter((c: any) => typeof c === 'string'))
  }
  
  if (Array.isArray(claudeParsed.lighting)) {
    techniques.push(...claudeParsed.lighting.filter((l: any) => typeof l === 'string'))
  }
  
  if (Array.isArray(claudeParsed.quality)) {
    techniques.push(...claudeParsed.quality.filter((q: any) => typeof q === 'string'))
  }

  // Extract motion (video only)
  const motion = Array.isArray(claudeParsed.motion)
    ? claudeParsed.motion.filter((m: any) => typeof m === 'string')
    : undefined

  // Extract keywords
  const keywords = Array.isArray(claudeParsed.keywords)
    ? claudeParsed.keywords.filter((k: any) => typeof k === 'string')
    : []

  return {
    subjects,
    styles,
    mood,
    colors,
    techniques,
    ...(motion && motion.length > 0 ? { motion } : {}),
    keywords,
  }
}

/**
 * Project-level semantic fingerprint
 */
export interface ProjectSemanticFingerprint {
  projectId: string
  projectName: string
  
  // Top subjects explored
  topSubjects: Array<{
    subject: string
    count: number
    percentage: number
  }>
  
  // Dominant styles
  dominantStyles: Array<{
    style: string
    count: number
    percentage: number
  }>
  
  // Mood distribution
  moodDistribution: Array<{
    mood: string
    count: number
    percentage: number
  }>
  
  // Color palette
  colorPalette: Array<{
    color: string
    count: number
    percentage: number
  }>
  
  // Common techniques
  techniques: Array<{
    technique: string
    count: number
    percentage: number
  }>
  
  // Metadata
  totalAnalyzed: number
  analysisCompleteness: number // percentage of outputs analyzed
  lastUpdated: Date
}

/**
 * Convergence signals - what patterns appear in "keeper" outputs
 */
export interface ConvergenceSignals {
  // Patterns in downloaded/approved outputs
  keeperSubjects: Array<{
    subject: string
    keeperCount: number
    totalCount: number
    convergenceRate: number // keeperCount / totalCount
  }>
  
  keeperStyles: Array<{
    style: string
    keeperCount: number
    totalCount: number
    convergenceRate: number
  }>
  
  keeperMoods: Array<{
    mood: string
    keeperCount: number
    totalCount: number
    convergenceRate: number
  }>
  
  // Overall metrics
  totalKeepers: number
  totalOutputs: number
  overallConvergenceRate: number
}

/**
 * Model affinity - which models are used for which semantic patterns
 */
export interface ModelAffinity {
  modelId: string
  modelName: string
  
  // Semantic patterns for this model
  topSubjects: Array<{
    subject: string
    count: number
    percentage: number
  }>
  
  topStyles: Array<{
    style: string
    count: number
    percentage: number
  }>
  
  totalGenerations: number
}

/**
 * Calculate tag distribution from an array of tags
 */
export function calculateTagDistribution<T extends string>(
  tags: T[],
  total: number
): Array<{ tag: T; count: number; percentage: number }> {
  const counts = new Map<T, number>()
  
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) || 0) + 1)
  }
  
  return Array.from(counts.entries())
    .map(([tag, count]) => ({
      tag,
      count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * Calculate exploration breadth for a project
 */
export interface ExplorationBreadth {
  projectId: string
  projectName: string
  
  // Diversity metrics
  uniqueSubjects: number
  uniqueStyles: number
  uniqueMoods: number
  uniqueModels: number
  
  // Total outputs
  totalOutputs: number
  
  // Breadth scores (0-100, normalized)
  subjectBreadth: number  // uniqueSubjects / totalOutputs * 100
  styleBreadth: number
  modelBreadth: number
}
