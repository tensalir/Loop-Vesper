import { HeadlessGetGenerationStatusSchema } from '@/lib/api/validation'
import { asJobPayload, isStale, STALE_MESSAGE, type JobRecord } from '../jobs'
import type { McpContent } from '../generate-asset'
import { contentForPayload, executeQueuedJob } from './job-runner'
import { invalidArguments, type ToolContext, type ToolHandler } from './types'

function inlineWanted(job: JobRecord): boolean {
  return job.request.inlineBase64 !== false
}

export const getGenerationStatusHandler: ToolHandler = {
  async run(args, ctx: ToolContext) {
    const parsed = HeadlessGetGenerationStatusSchema.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const { store } = ctx.jobs

    // Scoped by owner: a person who connects again can still collect their job.
    let job = await store.get(parsed.data.jobId, ctx.principal.ownerId)
    if (!job) throw new Error(`Unknown job '${parsed.data.jobId}'.`)

    if (job.status === 'queued') {
      // Only rows from before this change are queued; run them once, here.
      job = await executeQueuedJob(job, {
        store,
        recordUsage: (j, entry) =>
          ctx.recordBackgroundUsage({ ...entry, metadata: { ...entry.metadata, jobId: j.id } }),
      })
    }

    if (isStale(job)) {
      await store.fail(job.id, STALE_MESSAGE)
      job = { ...job, status: 'failed', error: STALE_MESSAGE }
    }

    const base = { jobId: job.id, status: job.status, toolName: job.toolName, modelId: job.modelId }

    if (job.status === 'processing' || job.status === 'queued') {
      const since = Math.round((Date.now() - (job.startedAt ?? job.createdAt).getTime()) / 1000)
      return {
        content: [
          {
            type: 'text',
            text: `Job ${job.id} is still running (${since} s so far). Poll get_generation_status again in about 15 seconds.`,
          },
        ],
        structuredContent: base,
        costUsd: null,
      }
    }

    if (job.status === 'failed') {
      throw new Error(job.error || 'Job failed')
    }

    // Spend was logged when the job finished; polling logs none.
    const payload = asJobPayload(job.result)
    if (payload) {
      return {
        content: await contentForPayload(job.toolName, payload, { inline: inlineWanted(job) }),
        structuredContent: { ...payload.structuredContent, ...base },
        costUsd: null,
      }
    }

    // A row finished by the code before this change holds the whole MCP result.
    const legacy = (job.result ?? {}) as { content?: McpContent[]; structuredContent?: Record<string, unknown> }
    if (!Array.isArray(legacy.content)) {
      throw new Error('Job completed but its result is missing.')
    }
    return {
      content: legacy.content,
      structuredContent: { ...(legacy.structuredContent ?? {}), ...base },
      costUsd: null,
    }
  },
}
