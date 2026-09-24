import {
  assertGenerateAssetAllowed,
  executeGenerateAsset,
  generateAssetPayload,
  generateAssetStructured,
  generateAssetSummary,
  imageResultContent,
  parseGenerateAssetArgs,
} from '../generate-asset'
import { estimateGenerationCostUsd } from '../estimate-cost'
import { runLongCall } from './long-call'
import type { ToolHandler } from './types'

export const generateAssetHandler: ToolHandler = {
  estimateCostUsd(args) {
    const modelId = typeof args.modelId === 'string' ? args.modelId : ''
    const numOutputs = typeof args.numOutputs === 'number' ? args.numOutputs : 1
    return modelId ? estimateGenerationCostUsd({ modelId, numOutputs }) : null
  },

  async run(args, ctx) {
    const parsed = parseGenerateAssetArgs(args)
    // Refuse a bad call before a job exists for it.
    assertGenerateAssetAllowed(parsed, ctx.principal.allowedModels)
    const inline = parsed.inlineBase64 !== false
    return runLongCall({
      ctx,
      toolName: 'generate_asset',
      modelId: parsed.modelId,
      request: args,
      runAsync: parsed.async === true,
      what: 'the image',
      execute: (jobId) =>
        executeGenerateAsset(parsed, {
          allowedModels: ctx.principal.allowedModels,
          credentialId: ctx.principal.credentialId,
          ownerId: ctx.principal.ownerId,
          progress: ctx.progress,
          jobId,
        }),
      toPayload: generateAssetPayload,
      toWire: async (exec) => ({
        content: await imageResultContent({
          summary: generateAssetSummary(exec),
          outputs: exec.outputs,
          modelId: exec.modelId,
          previewSources: exec.previewSources,
          inline,
        }),
        structuredContent: generateAssetStructured(exec),
      }),
    })
  },
}
