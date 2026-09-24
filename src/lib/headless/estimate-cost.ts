import { getModelConfig } from '@/lib/models/registry'

/**
 * Preflight cost estimate for MCP `estimate_generation_cost` / enriched list_models,
 * and for the daily spend cap. Priced by resolution when the model's price varies with it.
 */
export function estimateGenerationCostUsd(input: {
  modelId: string
  numOutputs?: number
  durationSeconds?: number
  /** Output long edge (1024, 2048, 4096) when the caller set one. */
  resolution?: number
}): number | null {
  const config = getModelConfig(input.modelId)
  if (!config?.pricing) return null

  const count = Math.max(1, input.numOutputs ?? 1)
  if (config.type === 'video' && config.pricing.perSecond != null) {
    const duration = Math.max(1, input.durationSeconds ?? 8)
    return config.pricing.perSecond * duration * count
  }
  const byResolution = config.pricing.perImageByResolution
  if (byResolution && input.resolution != null && byResolution[input.resolution] != null) {
    return byResolution[input.resolution] * count
  }
  if (config.pricing.perImage != null) {
    return config.pricing.perImage * count
  }
  return null
}
