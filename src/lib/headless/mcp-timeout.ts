import { getModelConfig } from '@/lib/models/registry'
import { PHASE_1_MODEL_IDS } from './model-allowlists'

/** Sync image models: allow Vertex/Gemini retries under load. */
const DEFAULT_SYNC_IMAGE_TIMEOUT_MS = 120_000

/** Fast OpenAI / Replicate-direct models. */
const FAST_MODEL_TIMEOUT_MS = 90_000

/**
 * Video models. `generate_video` doubles this, so the wall it applies is 240s.
 *
 * It was 30s, doubled to 60s, and Veo 3.1 does not finish in a minute: a render still going was
 * given up on and the job dropped. Video defaults to async and a queued job runs under
 * `/api/cron/mcp-jobs` (`maxDuration = 300`), so a minute was never the budget it had. 240s
 * leaves the upload and the recording their room inside the function's 300s.
 */
const VIDEO_MODEL_TIMEOUT_MS = 120_000

const FAST_MODEL_IDS = new Set([
  'openai-gpt-image-2',
  'replicate-seedream-4',
  'replicate-reve',
  'replicate-nano-banana-pro',
])

/**
 * Model-aware MCP generation timeout. Must stay below Vercel `maxDuration`
 * (300s on MCP routes) and ideally below client MCP tool-call walls when
 * using synchronous `generate_asset`.
 */
export function getMcpGenerationTimeoutMs(modelId: string): number {
  if (!(PHASE_1_MODEL_IDS as readonly string[]).includes(modelId)) {
    const config = getModelConfig(modelId)
    if (config?.type === 'video') return VIDEO_MODEL_TIMEOUT_MS
  }
  if (FAST_MODEL_IDS.has(modelId)) return FAST_MODEL_TIMEOUT_MS
  return DEFAULT_SYNC_IMAGE_TIMEOUT_MS
}
