import { HeadlessIterateSchema } from '@/lib/api/validation'
import { iteratePrompt } from '@/lib/prompts/iterate'
import { assertModelAllowed, invalidArguments, type ToolHandler } from './types'

export const iteratePromptHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = HeadlessIterateSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    assertModelAllowed(ctx.principal.allowedModels, parsed.data.modelId)
    const result = await iteratePrompt(parsed.data)
    return {
      // Stable JSON for agents that prefer text-only consumption.
      content: [{ type: 'text', text: JSON.stringify(result.slate, null, 2) }],
      structuredContent: {
        slate: result.slate,
        variantCount: result.variantCount,
        modelId: result.modelId,
        enhancementModel: result.enhancementModel,
        skill: result.skill,
      },
    }
  },
}
