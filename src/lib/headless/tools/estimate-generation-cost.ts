import { HeadlessEstimateCostSchema } from '@/lib/api/validation'
import { estimateGenerationCostUsd } from '../estimate-cost'
import { invalidArguments, type ToolHandler } from './types'

export const estimateGenerationCostHandler: ToolHandler = {
  async run(args) {
    const parsed = HeadlessEstimateCostSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const estimatedCostUsd = estimateGenerationCostUsd(parsed.data)
    return {
      content: [
        {
          type: 'text',
          text:
            estimatedCostUsd != null
              ? `Estimated cost for ${parsed.data.modelId}: $${estimatedCostUsd.toFixed(4)} USD`
              : `No published pricing for ${parsed.data.modelId}.`,
        },
      ],
      structuredContent: { modelId: parsed.data.modelId, estimatedCostUsd },
    }
  },
}
