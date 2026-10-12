/**
 * A Replicate video asked for through Claude: submitted, then collected, never waited on.
 *
 * The polling adapter held one function open for the whole render, and the MCP wall cut it at
 * 240 s while Replicate went on rendering and billing. Here the work submits the prediction with
 * the same input the web app's webhook path builds (`REPLICATE_MODEL_CONFIGS`), keeps the
 * prediction id on the job, and returns; `advanceVideoJob` (in `./generate-video`) checks it
 * whenever the job is polled or swept, and finishes it once.
 *
 * Kling 2.6 official and Veo 3.1 still run inline: Veo finishes in about 70 s, and the official
 * Kling adapter's own polling has not been split out.
 */

import {
  getPredictionStatus,
  nominalVideoDimensions,
  REPLICATE_MODEL_CONFIGS,
  submitReplicatePrediction,
} from '@/lib/models/replicate-utils'
import { getModelConfig } from '@/lib/models/registry'
import { MODEL_INPUT_TTL_SECONDS, signStoredUrlsDeep } from '@/lib/storage/access'
import { recordApiCall } from '@/lib/rate-limits/usage'
import { getScopeForModel } from '@/lib/rate-limits/config'
import type { PendingHandle } from './jobs'

/** What a handed-off Replicate video keeps on its job. */
export interface PendingReplicateVideo extends PendingHandle {
  provider: 'replicate'
  /** The size recorded when the file's header cannot be read. */
  nominal: { width: number; height: number }
  /** The duration Replicate was asked for, in seconds; null when the model chose (Seedance auto). */
  duration: number | null
}

export type PredictionState =
  | { kind: 'processing'; status: string }
  | { kind: 'succeeded'; url: string }
  | { kind: 'failed'; error: string }

/** The video arguments the handoff reads (the parsed `generate_video` arguments). */
export interface HandoffVideoArgs {
  prompt: string
  modelId: string
  aspectRatio?: string
  duration?: number
  resolution?: number
  referenceImage?: string
  endFrameImage?: string
  generateAudio?: boolean
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
}

export interface HandoffDeps {
  submit?: typeof submitReplicatePrediction
  status?: typeof getPredictionStatus
  recordCall?: typeof recordApiCall
  sign?: <T>(value: T) => Promise<T>
}

/** A Replicate video model the webhook path knows: those are submitted and collected. */
export function supportsVideoHandoff(modelId: string): boolean {
  return modelId in REPLICATE_MODEL_CONFIGS && getModelConfig(modelId)?.type === 'video'
}

/** The flat parameters `REPLICATE_MODEL_CONFIGS[...].buildInput` reads, as the web app passes them. */
export function handoffParams(args: HandoffVideoArgs): Record<string, unknown> {
  return {
    prompt: args.prompt,
    ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}),
    ...(typeof args.duration === 'number' ? { duration: args.duration } : {}),
    ...(typeof args.resolution === 'number' ? { resolution: args.resolution } : {}),
    ...(typeof args.generateAudio === 'boolean' ? { generateAudio: args.generateAudio } : {}),
    ...(args.referenceImage ? { referenceImage: args.referenceImage } : {}),
    ...(args.endFrameImage ? { endFrameImageUrl: args.endFrameImage } : {}),
    ...(args.referenceImageUrls?.length ? { referenceImageUrls: args.referenceImageUrls } : {}),
    ...(args.referenceVideoUrls?.length ? { referenceVideoUrls: args.referenceVideoUrls } : {}),
    ...(args.referenceAudioUrls?.length ? { referenceAudioUrls: args.referenceAudioUrls } : {}),
  }
}

/** Submit the prediction and say what the job should keep. Stored files go out signed for an hour. */
export async function submitVideoPrediction(
  args: HandoffVideoArgs,
  deps: HandoffDeps = {}
): Promise<PendingReplicateVideo> {
  const config = REPLICATE_MODEL_CONFIGS[args.modelId]
  if (!config) throw new Error(`Model '${args.modelId}' is not a Replicate video model.`)

  const sign = deps.sign ?? (<T,>(value: T) => signStoredUrlsDeep(value, MODEL_INPUT_TTL_SECONDS))
  const input = config.buildInput(await sign(handoffParams(args)))

  try {
    await (deps.recordCall ?? recordApiCall)('replicate', getScopeForModel(args.modelId), 1)
  } catch (err) {
    console.warn(`[mcp/generate_video] could not count the ${args.modelId} call`, err)
  }

  const prediction = await (deps.submit ?? submitReplicatePrediction)({ modelPath: config.modelPath, input })
  const duration = typeof input.duration === 'number' && input.duration > 0 ? input.duration : null

  return {
    provider: 'replicate',
    predictionId: prediction.predictionId,
    submittedAt: new Date().toISOString(),
    nominal: nominalVideoDimensions(input, args.aspectRatio ?? '16:9'),
    duration,
  }
}

/** The output URL of a finished prediction, whichever shape Replicate gave it. */
export function predictionOutputUrl(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return typeof output[0] === 'string' ? output[0] : null
  if (output && typeof output === 'object' && typeof (output as { url?: unknown }).url === 'string') {
    return (output as { url: string }).url
  }
  return null
}

/** Where the prediction stands. */
export async function checkVideoPrediction(
  predictionId: string,
  deps: HandoffDeps = {}
): Promise<PredictionState> {
  const state = await (deps.status ?? getPredictionStatus)(predictionId)
  if (state.status === 'succeeded') {
    const url = predictionOutputUrl(state.output)
    return url ? { kind: 'succeeded', url } : { kind: 'failed', error: 'Replicate finished the video but returned no file.' }
  }
  if (state.status === 'failed' || state.status === 'canceled') {
    return { kind: 'failed', error: `Video generation failed: ${state.error || state.status}` }
  }
  return { kind: 'processing', status: state.status }
}
