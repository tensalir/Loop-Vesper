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
