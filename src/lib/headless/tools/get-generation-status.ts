import { HeadlessGetGenerationStatusSchema } from '@/lib/api/validation'
import { asJobPayload, isStale, pendingOf, staleMessageFor, type JobRecord } from '../jobs'
import type { McpContent } from '../generate-asset'
import { advanceVideoJob, type AdvanceVideoDeps } from '../generate-video'
import { STREAM_SESSIONS } from '../record-generation'
import { contentForPayload, executeQueuedJob } from './job-runner'
import { invalidArguments, type ToolContext, type ToolHandler } from './types'

/** How long one poll waits on a video still rendering at its provider, checking every 5 s. */
const DEFAULT_STATUS_WAIT_MS = 40_000
const STATUS_CHECK_EVERY_MS = 5_000

function inlineWanted(job: JobRecord): boolean {
  return job.request.inlineBase64 !== false
}

function statusWaitMs(env: NodeJS.ProcessEnv): number {
  const raw = Number(env.MCP_STATUS_WAIT_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_STATUS_WAIT_MS
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

    // A video still rendering at its provider: check it, and finish it here once it is done.
    // One poll waits a while, so a render of several minutes takes a few polls, not dozens.
    if (pendingOf(job)) {
      const deps: AdvanceVideoDeps = {
        store,
        recordUsage: (j, entry) =>
          ctx.recordBackgroundUsage({ ...entry, metadata: { ...entry.metadata, jobId: j.id } }),
      }
      const deadline = Date.now() + statusWaitMs(ctx.env)
      job = await advanceVideoJob(job, deps)
      while (pendingOf(job) && Date.now() + STATUS_CHECK_EVERY_MS <= deadline) {
        await new Promise((resolve) => setTimeout(resolve, STATUS_CHECK_EVERY_MS))
        job = await advanceVideoJob(job, deps)
      }
    }

    if (isStale(job)) {
      const message = staleMessageFor(job)
      await store.fail(job.id, message)
      job = { ...job, status: 'failed', error: message }
    }

    const base = { jobId: job.id, status: job.status, toolName: job.toolName, modelId: job.modelId }

    if (pendingOf(job)) {
      const since = Math.round((Date.now() - (job.startedAt ?? job.createdAt).getTime()) / 1000)
      return {
        content: [
          {
            type: 'text',
            text:
              `The provider is still rendering job ${job.id} (${since} s so far). Call get_generation_status again; ` +
              `a video of 10 s or more at 1080p can take several minutes. When it is done it is saved in Vesper under ` +
              `Claude / ${STREAM_SESSIONS.video.name}, even if you stop asking.`,
          },
        ],
        structuredContent: base,
        costUsd: null,
      }
    }

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
