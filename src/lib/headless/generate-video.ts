/**
 * `generate_video`: the work itself (Veo, Kling, Seedance), separate from the
 * MCP entry in `./tools/generate-video.ts`. A job runs this directly, so it
 * can never queue itself again. Videos are recorded in the caller's "Claude"
 * project, session "Video".
 *
 * Two ways through. A Replicate video model (Kling 3.0, Seedance 2.5, Kling
 * 2.6 on Replicate) with a job to keep its handle is submitted and handed off
 * (`./video-handoff`); `advanceVideoJob` finishes it when the job is polled or
 * swept. Everything else (Veo 3.1, Kling 2.6 official, and any caller that
 * cannot poll) runs inline under the video wall, as before.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HeadlessGenerateVideoSchema } from '@/lib/api/validation'
import { getModel, getModelConfig } from '@/lib/models/registry'
import type { GenerationRequest, GenerationResponse } from '@/lib/models/base'
import { uploadBase64ToStorage, uploadUrlToStorage } from '@/lib/supabase/storage'
import { assertAllowlistedUrl } from '@/lib/net/fetch-allowlisted'
import { videoDimensionsOr } from '@/lib/video/mp4-dimensions'
import type { McpContent, ExecuteContext } from './generate-asset'
import { getMcpGenerationTimeoutMs } from './mcp-timeout'
import { estimateGenerationCostUsd } from './estimate-cost'
import {
  FINISH_LEASE_MS,
  HANDED_OFF,
  pendingOf,
  type HandedOff,
  type JobPayload,
  type JobRecord,
  type JobStore,
} from './jobs'
import { recordMcpGeneration, STREAM_SESSIONS } from './record-generation'
import { VIDEO_MODEL_IDS } from './model-allowlists'
import {
  checkVideoPrediction,
  submitVideoPrediction,
  supportsVideoHandoff,
  type HandoffDeps,
  type PendingReplicateVideo,
} from './video-handoff'
import type { UsageEntry } from './tools/types'

export { VIDEO_MODEL_IDS } from './model-allowlists'

const STORAGE_BUCKET = 'generated-images'

export type GenerateVideoArgs = z.infer<typeof HeadlessGenerateVideoSchema>

export interface GenerateVideoOutput {
  url: string
  width: number
  height: number
  mimeType: string
  duration?: number
  outputId: string | null
}

export interface GenerateVideoExecution {
  generationId: string
  modelId: string
  outputs: GenerateVideoOutput[]
  durationMs: number
  estimatedCostUsd: number | null
  provider: string | undefined
  isFallback: boolean
  routeReason: string | null
  recorded: { projectId: string; sessionId: string } | null
  recordError: string | null
}

/** What the video work needs beyond the image context: where a handed-off job keeps its handle. */
export interface ExecuteVideoContext extends ExecuteContext {
  jobStore?: Pick<JobStore, 'setPending'>
  /** Injected for tests: Replicate's submit and status calls. */
  handoff?: HandoffDeps
  /** Injected for tests: copying a provider's file into storage. */
  upload?: typeof uploadUrlToStorage
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export function parseGenerateVideoArgs(args: Record<string, unknown>): GenerateVideoArgs {
  const parsed = HeadlessGenerateVideoSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  return parsed.data
}

/**
 * A frame Vesper can hand a provider: an http(s) URL, a data URL, or bare base64. On
 * 2026-10-12 a Claude conversation passed its own upload path (`/root/.claude/uploads/...`) as
 * the start frame; Vesper cannot open a path on the caller's machine, and Kling answered "File
 * is not in a valid base64 format". That is now refused before anything is submitted.
 */
export function assertFrameReadable(name: string, value: string | undefined): void {
  if (!value) return
  if (/^https?:\/\//i.test(value)) return
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) return
  if (value.length >= 64 && /^[A-Za-z0-9+/=\s]+$/.test(value)) return
  const shown = value.length > 60 ? `${value.slice(0, 60)}…` : value
  throw new Error(
    `${name} must be an https URL or a data URL (data:image/png;base64,...). "${shown}" looks like a file on your side, ` +
      'which Vesper cannot open. Upload it first: create_upload_urls gives an upload URL to PUT the file to, and the url to pass here. An image already in Vesper (a generate_asset output, a product render) can be passed by its URL.'
  )
}

export function assertGenerateVideoAllowed(args: GenerateVideoArgs, allowedModels: string[]): void {
  if (!(VIDEO_MODEL_IDS as readonly string[]).includes(args.modelId)) {
    throw new Error(
      `Model '${args.modelId}' is not available for MCP video. Allowed: ${VIDEO_MODEL_IDS.join(', ')}.`
    )
  }
  if (allowedModels.length > 0 && !allowedModels.includes('*') && !allowedModels.includes(args.modelId)) {
    throw new Error(`This token is not permitted to use model '${args.modelId}'.`)
  }
  assertFrameReadable('referenceImage', args.referenceImage)
  assertFrameReadable('endFrameImage', args.endFrameImage)
  if (args.endFrameImage) {
    if (!args.referenceImage) {
      throw new Error('endFrameImage is the last frame and needs referenceImage as the first frame.')
    }
    if (getModelConfig(args.modelId)?.capabilities?.['frame-interpolation'] !== true) {
      const withFrames = VIDEO_MODEL_IDS.filter(
        (id) => getModelConfig(id)?.capabilities?.['frame-interpolation'] === true
      )
      throw new Error(`Model '${args.modelId}' takes no end frame. Models that do: ${withFrames.join(', ')}.`)
    }
  }
  // A frame may be fetched by our own adapter (Veo), so an https one must be on the allowlist.
  // The Seedance reference sets are fetched by the provider, not by this server.
  if (args.referenceImage && /^https?:\/\//i.test(args.referenceImage)) {
    assertAllowlistedUrl(args.referenceImage)
  }
  if (args.endFrameImage && /^https?:\/\//i.test(args.endFrameImage)) {
    assertAllowlistedUrl(args.endFrameImage)
  }
}

export async function executeGenerateVideo(
  args: GenerateVideoArgs,
  ctx: ExecuteVideoContext
): Promise<GenerateVideoExecution | HandedOff> {
  const startedAt = Date.now()
  const progress = ctx.progress
  assertGenerateVideoAllowed(args, ctx.allowedModels)

  const {
    prompt,
    modelId,
    aspectRatio,
    duration,
    resolution,
    referenceImage,
    endFrameImage,
    generateAudio,
    referenceImageUrls,
    referenceVideoUrls,
    referenceAudioUrls,
    allowFallback,
  } = args

  // Submitted and collected, when there is a job to keep the handle: no function waits on it.
  if (ctx.jobId && ctx.jobStore && supportsVideoHandoff(modelId)) {
    progress?.step('Submitting video generation')
    const pending = await submitVideoPrediction(args, ctx.handoff)
    await ctx.jobStore.setPending(ctx.jobId, pending)
    return HANDED_OFF
  }

  const adapter = getModel(modelId)
  if (!adapter) throw new Error(`Unknown model '${modelId}'.`)

  progress?.step('Submitting video generation')

  const parameters = {
    ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
    ...(referenceVideoUrls?.length ? { referenceVideoUrls } : {}),
    ...(referenceAudioUrls?.length ? { referenceAudioUrls } : {}),
    ...(endFrameImage ? { endFrameImageUrl: endFrameImage } : {}),
    ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
  }

  const request: GenerationRequest = {
    prompt,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(typeof resolution === 'number' ? { resolution } : {}),
    ...(referenceImage ? { referenceImage } : {}),
    // Reference sets, the end frame and the audio switch reach the adapter via `parameters`,
    // matching how the web app passes them through the generation record.
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
    allowFallback: allowFallback !== false,
  }

  // Doubled, as video always has been here: 120s for a video model, so a 240s wall.
  const timeoutMs = getMcpGenerationTimeoutMs(modelId) * 2
  const generation = await withTimeout(
    adapter.generate(request),
    timeoutMs,
    `Video generation timed out after ${Math.floor(timeoutMs / 1000)}s.`
  )

  if (generation.status !== 'completed' || !generation.outputs?.length) {
    throw new Error(generation.error || 'Video generation did not complete')
  }

  return finishGenerateVideo(args, ctx, generation, startedAt)
}

/** Persist the outputs, record them in the web app, and say what was made. */
async function finishGenerateVideo(
  args: GenerateVideoArgs,
  ctx: Pick<ExecuteVideoContext, 'credentialId' | 'ownerId' | 'jobId' | 'progress' | 'record' | 'upload'>,
  generation: GenerationResponse,
  startedAt: number
): Promise<GenerateVideoExecution> {
  const {
    prompt,
    modelId,
    aspectRatio,
    duration,
    resolution,
    endFrameImage,
    generateAudio,
    referenceImageUrls,
    referenceVideoUrls,
    referenceAudioUrls,
  } = args

  ctx.progress?.step('Persisting video')

  const generationId = randomUUID()
  const persisted = await Promise.all(
    (generation.outputs ?? []).map(async (output, idx) => {
      const path = `mcp/${ctx.credentialId}/${generationId}/${idx}.mp4`
      // A data URL used to be returned (and would now be recorded) as the URL itself; store it instead.
      const storedUrl = output.url.startsWith('data:')
        ? await uploadBase64ToStorage(output.url, STORAGE_BUCKET, path)
        : await (ctx.upload ?? uploadUrlToStorage)(output.url, STORAGE_BUCKET, path)
      return {
        url: storedUrl,
        width: output.width,
        height: output.height,
        duration: output.duration,
        mimeType: 'video/mp4',
      }
    })
  )

  const meta = generation.metadata ?? {}
  const config = getModelConfig(modelId)
  const estimatedCostUsd =
    estimateGenerationCostUsd({
      modelId,
      numOutputs: persisted.length,
      durationSeconds: duration ?? 8,
      ...(typeof resolution === 'number' ? { resolution } : {}),
      ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
    }) ?? null
  const provider = typeof meta.backend === 'string' ? meta.backend : config?.provider?.toLowerCase()
  const isFallback = Boolean(meta.isFallback)
  const routeReason = typeof meta.routeReason === 'string' ? meta.routeReason : null

  let outputIds: Array<string | null> = persisted.map(() => null)
  let recorded: GenerateVideoExecution['recorded'] = null
  let recordError: string | null = null
  try {
    const result = await (ctx.record ?? recordMcpGeneration)({
      ownerId: ctx.ownerId,
      generationId,
      stream: 'video',
      modelId,
      prompt,
      costUsd: estimatedCostUsd,
      outputs: persisted.map((p) => ({
        url: p.url,
        width: p.width,
        height: p.height,
        duration: typeof p.duration === 'number' ? p.duration : Number(p.duration) || null,
      })),
      parameters: {
        toolName: 'generate_video',
        credentialId: ctx.credentialId,
        mcpJobId: ctx.jobId ?? null,
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(typeof duration === 'number' ? { duration } : {}),
        ...(typeof resolution === 'number' ? { resolution } : {}),
        ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
        ...(endFrameImage ? { hasEndFrame: true } : {}),
        ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
        ...(referenceVideoUrls?.length ? { referenceVideoUrls } : {}),
        ...(referenceAudioUrls?.length ? { referenceAudioUrls } : {}),
        ...(typeof meta.predictionId === 'string' ? { replicatePredictionId: meta.predictionId } : {}),
        provider,
        isFallback,
        routeReason,
        estimatedCostUsd,
      },
    })
    outputIds = result.outputIds
    recorded = { projectId: result.projectId, sessionId: result.sessionId }
  } catch (err) {
    recordError = (err as Error)?.message || 'unknown error'
    console.warn('[mcp/generate_video] recording failed', recordError)
  }

  return {
    generationId,
    modelId,
    outputs: persisted.map((p, idx) => ({ ...p, outputId: outputIds[idx] ?? null })),
    durationMs: Date.now() - startedAt,
    estimatedCostUsd,
    provider,
    isFallback,
    routeReason,
    recorded,
    recordError,
  }
}

export interface AdvanceVideoDeps {
  store: JobStore
  /** Logs the finished job's spend, which the call that started it could not. */
  recordUsage: (job: JobRecord, entry: UsageEntry) => Promise<void>
  /** Injected for tests. */
  handoff?: HandoffDeps
  record?: ExecuteContext['record']
  upload?: typeof uploadUrlToStorage
  probe?: typeof videoDimensionsOr
}

/**
 * Check a handed-off video with its provider and, once it is done, finish it: once, by
 * whichever caller takes the lease (a poll and the sweeper can arrive together). Returns the job
 * as it stands afterwards. A failure to finish gives the lease back, so the next check tries again.
 */
export async function advanceVideoJob(job: JobRecord, deps: AdvanceVideoDeps): Promise<JobRecord> {
  const pending = pendingOf(job) as PendingReplicateVideo | null
  if (!pending || job.toolName !== 'generate_video') return job

  let state: Awaited<ReturnType<typeof checkVideoPrediction>>
  try {
    state = await checkVideoPrediction(pending.predictionId, deps.handoff)
  } catch (err) {
    // Replicate unreachable for a moment is not a failed video; the next check asks again.
    console.warn('[mcp/generate_video] could not check prediction', pending.predictionId, (err as Error)?.message)
    return job
  }
  if (state.kind === 'processing') return job
  if (state.kind === 'failed') {
    await deps.store.fail(job.id, state.error)
    return (await deps.store.get(job.id, job.ownerId)) ?? job
  }

  // Another caller holds it: read the job again, which that caller may already have finished.
  if (!(await deps.store.leasePending(job.id, new Date(Date.now() + FINISH_LEASE_MS)))) {
    return (await deps.store.get(job.id, job.ownerId)) ?? job
  }

  try {
    const args = parseGenerateVideoArgs(job.request)
    const dimensions = await (deps.probe ?? videoDimensionsOr)(state.url, pending.nominal)
    const generation: GenerationResponse = {
      id: pending.predictionId,
      status: 'completed',
      outputs: [
        {
          url: state.url,
          width: dimensions.width,
          height: dimensions.height,
          ...(pending.duration != null ? { duration: pending.duration } : {}),
        },
      ],
      metadata: { predictionId: pending.predictionId },
    }
    const startedAt = (job.startedAt ?? job.createdAt).getTime()
    const exec = await finishGenerateVideo(
      args,
      { credentialId: job.credentialId, ownerId: job.ownerId, jobId: job.id, record: deps.record, upload: deps.upload },
      generation,
      startedAt
    )
    const payload = generateVideoPayload(exec)
    await deps.store.complete(job.id, payload)
    await deps
      .recordUsage(job, {
        toolName: job.toolName,
        modelId: job.modelId,
        durationMs: exec.durationMs,
        costUsd: payload.costUsd,
        metadata: { jobId: job.id, background: true, predictionId: pending.predictionId },
      })
      .catch(() => undefined)
  } catch (err) {
    console.warn('[mcp/generate_video] finishing a handed-off video failed', (err as Error)?.message)
    await deps.store.releasePending(job.id).catch(() => undefined)
  }
  return (await deps.store.get(job.id, job.ownerId)) ?? job
}

export function generateVideoSummary(exec: GenerateVideoExecution): string {
  const n = exec.outputs.length
  const first = exec.outputs[0]
  const size = first?.width && first?.height ? ` at ${first.width}x${first.height}` : ''
  const parts = [
    `Generated ${n} video${n === 1 ? '' : 's'} with ${exec.modelId}${size}.`,
    exec.provider ? `Provider: ${exec.provider}${exec.isFallback ? ' (fallback)' : ''}.` : '',
    exec.routeReason ? `Route: ${exec.routeReason}.` : '',
    `View: ${first?.url ?? ''}`,
  ].filter(Boolean)
  if (exec.recorded) parts.push(`Saved in Vesper under Claude / ${STREAM_SESSIONS.video.name}.`)
  else if (exec.recordError) parts.push(`Not recorded in Vesper's web app (${exec.recordError}).`)
  return parts.join(' ')
}

export function generateVideoPayload(exec: GenerateVideoExecution): JobPayload {
  return {
    summary: generateVideoSummary(exec),
    structuredContent: {
      modelId: exec.modelId,
      generationId: exec.generationId,
      status: 'completed',
      outputs: exec.outputs,
      durationMs: exec.durationMs,
      estimatedCostUsd: exec.estimatedCostUsd,
      provider: exec.provider,
      isFallback: exec.isFallback,
      routeReason: exec.routeReason,
      recorded: exec.recorded,
    },
    outputIds: exec.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string'),
    costUsd: exec.estimatedCostUsd,
  }
}

export function videoResultContent(input: {
  summary: string
  modelId: string
  outputs: Array<{ url: string; mimeType: string }>
}): McpContent[] {
  return [
    { type: 'text', text: input.summary },
    ...input.outputs.map((out, idx) => ({
      type: 'resource_link' as const,
      uri: out.url,
      name: `${input.modelId}-video-${idx}.mp4`,
      mimeType: out.mimeType,
      description: `Video ${idx + 1} from ${input.modelId}`,
    })),
  ]
}
