/**
 * Running a stored job, and turning a finished one back into MCP content.
 *
 * `executeQueuedJob` is for rows still `queued`: those left by the code
 * before this change (the migration strips their `async` flag) and anything
 * the sweeper finds. It claims the row, then runs the work function directly,
 * never the tool entry, so the job cannot queue itself again.
 */

import { prisma } from '@/lib/prisma'
import {
  executeGenerateAsset,
  generateAssetPayload,
  imageResultContent,
  parseGenerateAssetArgs,
} from '../generate-asset'
import {
  executeGenerateVideo,
  generateVideoPayload,
  parseGenerateVideoArgs,
  videoResultContent,
} from '../generate-video'
import { stripAsync, type JobPayload, type JobRecord, type JobStore } from '../jobs'
import type { McpContent } from '../generate-asset'
import type { UsageEntry } from './types'

type Executor = (
  request: Record<string, unknown>,
  ctx: { allowedModels: string[]; credentialId: string; ownerId: string; jobId: string }
) => Promise<JobPayload>

export const JOB_EXECUTORS: Record<string, Executor> = {
  generate_asset: async (request, ctx) =>
    generateAssetPayload(await executeGenerateAsset(parseGenerateAssetArgs(request), ctx)),
  generate_video: async (request, ctx) =>
    generateVideoPayload(await executeGenerateVideo(parseGenerateVideoArgs(request), ctx)),
}

export interface QueuedJobDeps {
  store: JobStore
  recordUsage: (job: JobRecord, entry: UsageEntry) => Promise<void>
  /** Reads the credential's model list and whether it still works; injected for tests. */
  loadCredential?: (credentialId: string) => Promise<{ allowedModels: string[]; revokedAt: Date | null } | null>
  executors?: Record<string, Executor>
}

const loadCredentialFromDb = async (credentialId: string) =>
  prisma.headlessCredential.findUnique({
    where: { id: credentialId },
    select: { allowedModels: true, revokedAt: true },
  })

/** Claim a queued job and run it to the end. Returns the job as it stands afterwards. */
export async function executeQueuedJob(job: JobRecord, deps: QueuedJobDeps): Promise<JobRecord> {
  const claimed = await deps.store.claimQueued(job.id)
  if (!claimed) return (await deps.store.get(job.id, job.ownerId)) ?? job

  const startedAt = Date.now()
  const executor = (deps.executors ?? JOB_EXECUTORS)[job.toolName]
  try {
    if (!executor) throw new Error(`Unsupported job tool: ${job.toolName}`)
    const credential = await (deps.loadCredential ?? loadCredentialFromDb)(job.credentialId)
    if (!credential || credential.revokedAt) {
      throw new Error('The credential that started this job has been revoked.')
    }
    const payload = await executor(stripAsync(job.request), {
      allowedModels: credential.allowedModels,
      credentialId: job.credentialId,
      ownerId: job.ownerId,
      jobId: job.id,
    })
    await deps.store.complete(job.id, payload)
    await deps
      .recordUsage(job, {
        toolName: job.toolName,
        modelId: job.modelId,
        durationMs: Date.now() - startedAt,
        costUsd: payload.costUsd,
        metadata: { jobId: job.id, background: true, legacyQueued: true },
      })
      .catch(() => undefined)
  } catch (err) {
    await deps.store.fail(job.id, (err as Error)?.message || 'Job failed')
  }
  return (await deps.store.get(job.id, job.ownerId)) ?? job
}

/** MCP content for a finished job, rebuilt from its stored payload (previews made from storage). */
export async function contentForPayload(
  toolName: string,
  payload: JobPayload,
  options: { inline: boolean }
): Promise<McpContent[]> {
  const structured = payload.structuredContent as {
    modelId?: string
    outputs?: Array<{ url: string; width: number; height: number; mimeType: string }>
  }
  const outputs = Array.isArray(structured.outputs) ? structured.outputs : []
  const modelId = structured.modelId ?? 'vesper'
  if (toolName === 'generate_video') {
    return videoResultContent({ summary: payload.summary, modelId, outputs })
  }
  return imageResultContent({ summary: payload.summary, outputs, modelId, inline: options.inline })
}
