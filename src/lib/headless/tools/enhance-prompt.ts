import { HeadlessEnhanceSchema } from '@/lib/api/validation'
import { enhancePrompt } from '@/lib/prompts/enhance'
import type { McpContent } from '../generate-asset'
import { assertModelAllowed, invalidArguments, type ToolHandler } from './types'

export const enhancePromptHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = HeadlessEnhanceSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    assertModelAllowed(ctx.principal.allowedModels, parsed.data.modelId)
    // On the MCP surface a prompt that names a Loop product also comes back
    // unchanged: the caller can send the product's code-filled skeleton instead.
    const result = await enhancePrompt({ ...parsed.data, guardProductNames: true })
    const content: McpContent[] = [{ type: 'text', text: result.enhancedPrompt }]
    if (result.passthrough) content.push({ type: 'text', text: result.passthrough.note })
    return {
      content,
      structuredContent: {
        originalPrompt: result.originalPrompt,
        enhancedPrompt: result.enhancedPrompt,
        modelId: result.modelId,
        enhancementModel: result.enhancementModel,
        skill: result.skill,
        passthrough: result.passthrough ?? null,
        promptingSource: result.promptingSource ?? null,
      },
    }
  },
}
