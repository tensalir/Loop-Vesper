/**
 * Cost calculation utilities for different AI model providers
 * 
 * Pricing sources:
 * - Gemini: https://ai.google.dev/pricing (Nano Banana: ~$0.01/image, Veo 3.1: ~$0.05/second)
 * - Replicate: https://replicate.com/pricing (compute time based, varies by hardware)
 *   - Pricing is per-second based on actual predict_time from API response
 *   - Different models run on different hardware with different rates
 * - Kling Official: https://app.klingai.com/global/dev/document-api
 *   - Pro mode: ~$0.07 per second of video
 *   - Standard mode: ~$0.035 per second of video
 * - FAL.ai: Pay-per-use, typically similar to Replicate
 */

export interface CostCalculationResult {
  cost: number // Cost in USD
  unit: string // Unit description (e.g., "per image", "per second")
  isActual?: boolean // True if based on actual metrics, false if estimated
}

/**
 * Replicate hardware pricing per second (USD)
 * Source: https://replicate.com/pricing
 * Updated: January 2026
 */
const REPLICATE_HARDWARE_PRICING: Record<string, number> = {
  // GPU pricing per second
  'cpu': 0.0001,
  'nvidia-t4': 0.000225,
  'nvidia-a10g': 0.000725,
  'nvidia-a40-small': 0.000575,
  'nvidia-a40': 0.000725,
  'nvidia-a40-large': 0.00145,
  'nvidia-a100-40gb': 0.0014,
  'nvidia-a100-80gb': 0.00195,
  'nvidia-h100': 0.0035,
}

/**
 * Model to hardware mapping (based on Replicate model pages)
 * These are the default hardware types used by each model
 */
const MODEL_HARDWARE_MAP: Record<string, string> = {
  // Image models
  'replicate-seedream-4': 'nvidia-a40-large', // Seedream 4.5 runs on A40 Large
  'replicate-reve': 'nvidia-a40',
  'gemini-nano-banana-pro': 'nvidia-a40-large', // When using Replicate fallback
  'replicate-nano-banana-pro': 'nvidia-a40-large', // Replicate Nano Banana Pro
  // Video models
  'replicate-kling-2.6': 'nvidia-a100-80gb', // Kling uses A100 for video
  'gemini-veo-3.1': 'nvidia-a100-80gb', // When using Kling fallback
}

/**
 * Calculate cost for Gemini models
 */
export function calculateGeminiCost(
  modelId: string,
  outputCount: number = 1,
  videoDurationSeconds?: number
): CostCalculationResult {
  // Gemini Nano Banana Pro - Image generation
  if (modelId === 'gemini-nano-banana-pro') {
    // ~$0.01 per image (approximate, based on documentation)
    return {
      cost: 0.01 * outputCount,
      unit: `per image (${outputCount} image${outputCount > 1 ? 's' : ''})`,
      isActual: false, // Gemini doesn't provide exact billing in API
    }
  }

  // Gemini Veo 3.1 - Video generation
  if (modelId === 'gemini-veo-3.1' || modelId.includes('veo')) {
    // ~$0.05 per second of video
    const duration = videoDurationSeconds || 8 // Default to 8 seconds if not specified
    return {
      cost: 0.05 * duration * outputCount,
      unit: `per second (${duration}s × ${outputCount} video${outputCount > 1 ? 's' : ''})`,
      isActual: false,
    }
  }

  // Default fallback for unknown Gemini models
  return {
    cost: 0,
    unit: 'unknown model',
    isActual: false,
  }
}

/**
 * Calculate cost for Replicate models
 * Uses actual compute time from API response when available
 * Falls back to estimates based on typical generation times
 */
export function calculateReplicateCost(
  modelId: string,
  computeTimeSeconds?: number
): CostCalculationResult {
  // Get hardware type for this model
  const hardware = MODEL_HARDWARE_MAP[modelId] || 'nvidia-a40'
  const pricePerSecond = REPLICATE_HARDWARE_PRICING[hardware] || 0.000725
  
  // Use actual compute time if provided, otherwise estimate
  const isActual = computeTimeSeconds !== undefined && computeTimeSeconds > 0
  const time = isActual ? computeTimeSeconds : getEstimatedComputeTime(modelId)
  
  const cost = pricePerSecond * time
  
  return {
    cost,
    unit: isActual 
      ? `${time.toFixed(2)}s @ $${(pricePerSecond * 1000).toFixed(4)}/ms`
      : `~${time.toFixed(0)}s (estimated)`,
    isActual,
  }
}

/**
 * Get estimated compute time for Replicate models (in seconds)
 * Based on typical generation times observed in practice
 */
function getEstimatedComputeTime(modelId: string): number {
  if (modelId === 'replicate-seedream-4' || modelId === 'gemini-nano-banana-pro' || modelId === 'replicate-nano-banana-pro') {
    return 12 // ~12 seconds for Seedream 4.5 / Nano Banana image generation
  }
  if (modelId === 'replicate-reve') {
    return 8 // ~8 seconds for Reve
  }
  if (modelId === 'replicate-kling-2.6' || modelId === 'gemini-veo-3.1') {
    return 120 // ~2 minutes for Kling video generation
  }
  return 15 // Default estimate
}

/**
 * Calculate cost for Kling Official API
 * Pricing based on video duration and quality mode
 */
export function calculateKlingOfficialCost(
  modelId: string,
  videoDurationSeconds?: number,
  mode?: string
): CostCalculationResult {
  // Kling pricing: Pro mode ~$0.07/second, Standard ~$0.035/second
  const isPro = mode === 'pro' || !mode // Default to pro
  const pricePerSecond = isPro ? 0.07 : 0.035
  const duration = videoDurationSeconds || 5 // Default 5 seconds
  
  return {
    cost: pricePerSecond * duration,
    unit: `${duration}s @ $${pricePerSecond.toFixed(3)}/s (${isPro ? 'pro' : 'std'})`,
    isActual: true, // We know the exact duration
  }
}

/**
 * Calculate cost for FAL.ai models
 * FAL.ai pricing is similar to Replicate (compute time based)
 */
export function calculateFalCost(
  modelId: string,
  computeTimeSeconds?: number
): CostCalculationResult {
  const isActual = computeTimeSeconds !== undefined && computeTimeSeconds > 0
  const estimatedTime = isActual ? computeTimeSeconds : getEstimatedComputeTime(modelId)
  
  // FAL.ai uses similar hardware pricing to Replicate
  const pricePerSecond = 0.000725 // Approximate A40 equivalent

  if (modelId === 'fal-seedream-v4') {
    return {
      cost: pricePerSecond * estimatedTime,
      unit: isActual 
        ? `${estimatedTime.toFixed(2)}s compute`
        : `~${estimatedTime.toFixed(0)}s (estimated)`,
      isActual,
    }
  }

  return {
    cost: 0,
    unit: 'unknown model',
    isActual: false,
  }
}

/**
 * Calculate cost for a generation based on model ID
 * 
 * @param modelId - The model identifier (e.g., 'replicate-seedream-4')
 * @param options - Additional options for cost calculation
 * @param options.outputCount - Number of outputs generated
 * @param options.videoDurationSeconds - Duration of video (for video models)
 * @param options.computeTimeSeconds - Actual compute time from API (for accurate billing)
 */
export function calculateGenerationCost(
  modelId: string,
  options: {
    outputCount?: number
    videoDurationSeconds?: number
    computeTimeSeconds?: number
  } = {}
): CostCalculationResult {
  const { outputCount = 1, videoDurationSeconds, computeTimeSeconds } = options

  // For Nano Banana Pro, check if it's using Replicate fallback
  // (We pass computeTimeSeconds when using Replicate)
  if (modelId === 'gemini-nano-banana-pro' && computeTimeSeconds) {
    // Using Replicate fallback - calculate using Replicate pricing
    return calculateReplicateCost(modelId, computeTimeSeconds)
  }

  // For Veo 3.1, check if it's using Kling fallback
  // (We pass computeTimeSeconds when using Replicate/Kling)
  if (modelId === 'gemini-veo-3.1' && computeTimeSeconds) {
    // Using Kling fallback - calculate using Replicate pricing for A100
    return calculateReplicateCost('replicate-kling-2.6', computeTimeSeconds)
  }

  // Handle replicate-nano-banana-pro (explicit fallback model ID from routing)
  if (modelId === 'replicate-nano-banana-pro') {
    return calculateReplicateCost(modelId, computeTimeSeconds)
  }

  // Determine provider and calculate cost
  if (modelId.startsWith('gemini-') || modelId.includes('veo')) {
    return calculateGeminiCost(modelId, outputCount, videoDurationSeconds)
  }

  if (modelId.startsWith('replicate-')) {
    return calculateReplicateCost(modelId, computeTimeSeconds)
  }

  if (modelId.startsWith('fal-')) {
    return calculateFalCost(modelId, computeTimeSeconds)
  }

  if (modelId.startsWith('kling-')) {
    return calculateKlingOfficialCost(modelId, videoDurationSeconds)
  }

  // Unknown model
  return {
    cost: 0,
    unit: 'unknown model',
    isActual: false,
  }
}

/**
 * Format cost as currency string
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(6)}`
  if (cost < 1) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

