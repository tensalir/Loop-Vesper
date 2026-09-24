/**
 * `generate_video`: the work itself (Veo, Kling, Seedance), separate from the
 * MCP entry in `./tools/generate-video.ts`. A job runs this directly, so it
 * can never queue itself again. Videos are recorded in the caller's "Claude"
 * project, session "Video".
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HeadlessGenerateVideoSchema } from '@/lib/api/validation'
import { getModel, getModelConfig } from '@/lib/models/registry'
import type { GenerationRequest } from '@/lib/models/base'
import { uploadBase64ToStorage, uploadUrlToStorage } from '@/lib/supabase/storage'
import { assertAllowlistedUrl } from '@/lib/net/fetch-allowlisted'
import type { McpContent, ExecuteContext } from './generate-asset'
import { getMcpGenerationTimeoutMs } from './mcp-timeout'
import { estimateGenerationCostUsd } from './estimate-cost'
import type { JobPayload } from './jobs'
import { recordMcpGeneration, STREAM_SESSIONS } from './record-generation'
import { VIDEO_MODEL_IDS } from './model-allowlists'

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

export function assertGenerateVideoAllowed(args: GenerateVideoArgs, allowedModels: string[]): void {
  if (!(VIDEO_MODEL_IDS as readonly string[]).includes(args.modelId)) {
    throw new Error(
      `Model '${args.modelId}' is not available for MCP video. Allowed: ${VIDEO_MODEL_IDS.join(', ')}.`
    )
  }
  if (allowedModels.length > 0 && !allowedModels.includes('*') && !allowedModels.includes(args.modelId)) {
    throw new Error(`This token is not permitted to use model '${args.modelId}'.`)
  }
  // The start frame may be fetched by our own adapter, so an https one must be on the allowlist.
  // The Seedance reference sets are fetched by the provider, not by this server.
  if (args.referenceImage && /^https?:\/\//i.test(args.referenceImage)) {
    assertAllowlistedUrl(args.referenceImage)
  }
}

export async function executeGenerateVideo(
  args: GenerateVideoArgs,
  ctx: ExecuteContext
): Promise<GenerateVideoExecution> {
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
    referenceImageUrls,
    referenceVideoUrls,
    referenceAudioUrls,
    allowFallback,
  } = args

  const adapter = getModel(modelId)
  if (!adapter) throw new Error(`Unknown model '${modelId}'.`)

  progress?.step('Submitting video generation')

  const request: GenerationRequest = {
    prompt,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(typeof resolution === 'number' ? { resolution } : {}),
    ...(referenceImage ? { referenceImage } : {}),
    // Reference sets reach the adapter via `parameters`, matching how the
    // web app passes them through the generation record.
    ...(referenceImageUrls?.length || referenceVideoUrls?.length || referenceAudioUrls?.length
      ? {
          parameters: {
            ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
            ...(referenceVideoUrls?.length ? { referenceVideoUrls } : {}),
            ...(referenceAudioUrls?.length ? { referenceAudioUrls } : {}),
          },
        }
      : {}),
    allowFallback: allowFallback !== false,
  }

  const timeoutMs = getMcpGenerationTimeoutMs(modelId) * 2
  const generation = await withTimeout(
    adapter.generate(request),
    timeoutMs,
    `Video generation timed out after ${Math.floor(timeoutMs / 1000)}s.`
  )

  if (generation.status !== 'completed' || !generation.outputs?.length) {
    throw new Error(generation.error || 'Video generation did not complete')
  }

  progress?.step('Persisting video')

  const generationId = randomUUID()
  const persisted = await Promise.all(
    generation.outputs.map(async (output, idx) => {
      const path = `mcp/${ctx.credentialId}/${generationId}/${idx}.mp4`
      // A data URL used to be returned (and would now be recorded) as the URL itself; store it instead.
      const storedUrl = output.url.startsWith('data:')
        ? await uploadBase64ToStorage(output.url, STORAGE_BUCKET, path)
        : await uploadUrlToStorage(output.url, STORAGE_BUCKET, path)
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
    estimateGenerationCostUsd({ modelId, numOutputs: persisted.length, durationSeconds: duration ?? 8 }) ?? null
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
        ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
        ...(referenceVideoUrls?.length ? { referenceVideoUrls } : {}),
        ...(referenceAudioUrls?.length ? { referenceAudioUrls } : {}),
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

export function generateVideoSummary(exec: GenerateVideoExecution): string {
  const n = exec.outputs.length
  const parts = [
    `Generated ${n} video${n === 1 ? '' : 's'} with ${exec.modelId}.`,
    exec.provider ? `Provider: ${exec.provider}${exec.isFallback ? ' (fallback)' : ''}.` : '',
    exec.routeReason ? `Route: ${exec.routeReason}.` : '',
    `View: ${exec.outputs[0]?.url ?? ''}`,
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
