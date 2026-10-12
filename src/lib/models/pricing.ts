/**
 * Per-image prices for Google's image models, by output resolution.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing, read 2026-09-24.
 * The registry priced both models at $0.01 an image, about 13 times under
 * Nano Banana Pro's real price, so logged costs and any spend cap built on
 * them were wrong by the same factor.
 *
 * Keys are the long edge in pixels as the app passes it (`resolution`);
 * 512 is Google's "0.5K" tier.
 */

export const GEMINI_IMAGE_PRICES_USD: Record<string, Record<number, number>> = {
  // gemini-3-pro-image: $0.134 per 1K/2K image, $0.24 per 4K image.
  'gemini-nano-banana-pro': { 1024: 0.134, 2048: 0.134, 4096: 0.24 },
  // gemini-3.1-flash-image: $0.045 (0.5K), $0.067 (1K), $0.101 (2K), $0.151 (4K).
  'gemini-nano-banana-2': { 512: 0.045, 1024: 0.067, 2048: 0.101, 4096: 0.151 },
}

/** Resolutions are sent as numbers (1024) or labels ('2K'); read both. */
export function normaliseResolution(resolution: unknown): number | null {
  if (typeof resolution === 'number' && Number.isFinite(resolution)) return resolution
  if (typeof resolution === 'string') {
    const label = resolution.trim().toUpperCase()
    if (label === '0.5K') return 512
    const k = label.match(/^(\d)K$/)
    if (k) return Number(k[1]) * 1024
    const n = Number(label)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/**
 * The price of one image, or null when the model is not priced here.
 * An unknown or missing resolution is priced at 1K, the models' default.
 */
export function geminiImagePriceUsd(modelId: string, resolution?: unknown): number | null {
  const table = GEMINI_IMAGE_PRICES_USD[modelId]
  if (!table) return null
  const res = normaliseResolution(resolution) ?? 1024
  if (table[res] != null) return table[res]
  // Between tiers, charge the next tier up; above the top, the top tier.
  const tiers = Object.keys(table).map(Number).sort((a, b) => a - b)
  const next = tiers.find((t) => t >= res) ?? tiers[tiers.length - 1]
  return table[next]
}

/**
 * Kling 3.0 on Replicate (kwaivgi/kling-v3-video), USD per second of output video.
 *
 * Source: https://replicate.com/kwaivgi/kling-v3-video, read 2026-10-12. An official Replicate
 * model, billed per second of output by mode and audio, never by compute time. The mode is the
 * resolution: 'standard' renders 720p, 'pro' 1080p, '4k' 4K; 4K costs the same with audio.
 */
export const KLING_3_PRICES_USD = {
  standard: { silent: 0.168, audio: 0.252 },
  pro: { silent: 0.224, audio: 0.336 },
  '4k': { silent: 0.42, audio: 0.42 },
} as const

export type Kling3Mode = keyof typeof KLING_3_PRICES_USD

/** The Kling 3.0 mode for a resolution: 720 and below standard, 2160 and above 4K, else 1080p (pro). */
export function kling3Mode(resolution: unknown): Kling3Mode {
  const lines = typeof resolution === 'string'
    ? resolution.trim().toLowerCase() === '4k' ? 2160 : parseInt(resolution, 10)
    : typeof resolution === 'number' ? resolution : NaN
  if (!Number.isFinite(lines)) return 'pro'
  if (lines <= 720) return 'standard'
  if (lines >= 2160) return '4k'
  return 'pro'
}

/** Kling 3.0's price for one second of output at a resolution, with or without audio. */
export function kling3PricePerSecondUsd(resolution: unknown, generateAudio: boolean): number {
  const prices = KLING_3_PRICES_USD[kling3Mode(resolution)]
  return generateAudio ? prices.audio : prices.silent
}
