/**
 * The shared shape of a long tool call (image and video generation).
 *
 * A caller that can poll gets the result inline when the work finishes
 * within the budget and a job id otherwise. A caller that cannot poll (the
 * organisation token has never carried `get_generation_status`) runs the
 * work to the end in the request, exactly as before jobs existed: handing it
 * a job id it cannot collect would lose the image.
 */

import { canPollJobs } from '../tool-registry'
import { runWithBudget, syncBudgetMs, type JobPayload } from '../jobs'
import type { ToolContext, ToolResult } from './types'

export interface LongCallInput<T> {
  ctx: ToolContext
  toolName: string
  modelId: string
  request: Record<string, unknown>
  runAsync: boolean
  execute: (jobId: string | null) => Promise<T>
  toPayload: (result: T) => JobPayload
  toWire: (result: T) => Promise<ToolResult>
  what: string
}

export async function runLongCall<T>(input: LongCallInput<T>): Promise<ToolResult> {
  const { ctx } = input

  if (!canPollJobs(ctx.principal.allowedTools)) {
    const result = await input.execute(null)
    const wire = await input.toWire(result)
    const note = input.runAsync
      ? [{ type: 'text' as const, text: 'This connection cannot call get_generation_status, so the call ran to the end instead of returning a job.' }]
      : []
    return { ...wire, content: [...note, ...wire.content], costUsd: input.toPayload(result).costUsd }
  }

  const budgetMs = syncBudgetMs(ctx.env, input.runAsync)
  const outcome = await runWithBudget<T>({
    store: ctx.jobs.store,
    waitUntil: ctx.jobs.waitUntil,
    credentialId: ctx.principal.credentialId,
    ownerId: ctx.principal.ownerId,
    toolName: input.toolName,
    modelId: input.modelId,
    request: input.request,
    budgetMs,
    work: (jobId) => input.execute(jobId),
    toPayload: input.toPayload,
    onBackgroundDone: async (result) => {
      const payload = input.toPayload(result)
      await ctx.recordBackgroundUsage({
        toolName: input.toolName,
        modelId: input.modelId,
        durationMs: Number((payload.structuredContent as { durationMs?: number }).durationMs) || 0,
        costUsd: payload.costUsd,
        metadata: { background: true },
      })
    },
  })

  if (outcome.kind === 'inline') {
    const wire = await input.toWire(outcome.result)
    const structured = (wire.structuredContent ?? {}) as Record<string, unknown>
    return {
      ...wire,
      structuredContent: { ...structured, jobId: outcome.jobId },
      costUsd: input.toPayload(outcome.result).costUsd,
    }
  }

  const waited = Math.round(budgetMs / 1000)
  const text =
    budgetMs === 0
      ? `Started ${input.what} as job ${outcome.jobId}; it is already running. Call get_generation_status with jobId ${outcome.jobId} in about 20 seconds to collect it.`
      : `Still running after ${waited} s, so this call returns job ${outcome.jobId} instead of waiting. Call get_generation_status with jobId ${outcome.jobId} in about 20 seconds; the result comes back there.`
  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      jobId: outcome.jobId,
      status: 'processing',
      modelId: input.modelId,
      outputs: [],
    },
    // Spend is logged when the job finishes, not here.
    costUsd: null,
  }
}
