/** MCP-sync image models (fast, synchronous). */
export const PHASE_1_MODEL_IDS = [
  'gemini-nano-banana-pro',
  'gemini-nano-banana-2',
  'openai-gpt-image-2',
  'replicate-seedream-4',
  'replicate-reve',
  'replicate-nano-banana-pro',
] as const

export type Phase1ModelId = (typeof PHASE_1_MODEL_IDS)[number]

/** MCP video models (async-first). */
export const VIDEO_MODEL_IDS = [
  'gemini-veo-3.1',
  'replicate-kling-2.6',
  'replicate-kling-3',
  'replicate-seedance-2.5',
  'kling-official',
] as const
