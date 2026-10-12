import {
  assertGenerateVideoAllowed,
  executeGenerateVideo,
  generateVideoPayload,
  parseGenerateVideoArgs,
  videoResultContent,
} from '../generate-video'
import { estimateGenerationCostUsd } from '../estimate-cost'
import { runLongCall } from './long-call'
import type { ToolHandler } from './types'

export const generateVideoHandler: ToolHandler = {
  estimateCostUsd(args) {
    const modelId = typeof args.modelId === 'string' ? args.modelId : ''
    const durationSeconds = typeof args.duration === 'number' ? args.duration : undefined
    const resolution = typeof args.resolution === 'number' ? args.resolution : undefined
    const generateAudio = typeof args.generateAudio === 'boolean' ? args.generateAudio : undefined
    return modelId ? estimateGenerationCostUsd({ modelId, durationSeconds, resolution, generateAudio }) : null
  },

  async run(args, ctx) {
    const parsed = parseGenerateVideoArgs(args)
    assertGenerateVideoAllowed(parsed, ctx.principal.allowedModels)
    return runLongCall({
      ctx,
      toolName: 'generate_video',
      modelId: parsed.modelId,
      request: args,
      // Video defaults to async (the schema's default), so it hands back a job at once.
      runAsync: parsed.async !== false,
      what: 'the video',
      execute: (jobId) =>
        executeGenerateVideo(parsed, {
          allowedModels: ctx.principal.allowedModels,
          credentialId: ctx.principal.credentialId,
          ownerId: ctx.principal.ownerId,
          progress: ctx.progress,
          jobId,
          // A Replicate video keeps its prediction on the job and is collected, not waited on.
          jobStore: ctx.jobs.store,
        }),
      toPayload: generateVideoPayload,
      toWire: async (exec) => {
        const payload = generateVideoPayload(exec)
        return {
          content: videoResultContent({ summary: payload.summary, modelId: exec.modelId, outputs: exec.outputs }),
          structuredContent: payload.structuredContent,
        }
      },
    })
  },
}
