import { test, expect } from '@playwright/test'
import { checkDailyCostCap, dailyCostCapUsd, startOfUtcDay } from '../src/lib/headless/cost-cap'
import { geminiImagePriceUsd, normaliseResolution } from '../src/lib/models/pricing'
import { calculateGenerationCost } from '../src/lib/cost/calculator'
import { estimateGenerationCostUsd } from '../src/lib/headless/estimate-cost'
import { drawPriceUsd, vesperModelId } from '../src/lib/creative/work-runtime'

/**
 * Nano Banana was priced at $0.01 an image, about 13 times under Google's
 * price for Pro, so logged costs and any cap built on them were wrong.
 */

test.describe('Gemini image prices (Google, read 2026-09-24)', () => {
  test('Nano Banana Pro: $0.134 at 1K and 2K, $0.24 at 4K', () => {
    expect(geminiImagePriceUsd('gemini-nano-banana-pro', 1024)).toBe(0.134)
    expect(geminiImagePriceUsd('gemini-nano-banana-pro', 2048)).toBe(0.134)
    expect(geminiImagePriceUsd('gemini-nano-banana-pro', 4096)).toBe(0.24)
    expect(geminiImagePriceUsd('gemini-nano-banana-pro', '4K')).toBe(0.24)
    expect(geminiImagePriceUsd('gemini-nano-banana-pro')).toBe(0.134)
  })

  test('gemini-nano-banana-2 is Nano Banana 2.1 (read 2026-10-07), with no 0.5K tier', () => {
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 1024)).toBe(0.0336)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 2048)).toBe(0.0504)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 4096)).toBe(0.113)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 512)).toBe(0.0336)
  })

  test('a kit that still names Nano Banana 2 is priced as Nano Banana 2', () => {
    expect(drawPriceUsd('gemini-3.1-flash-image', '0.5K')).toBe(0.045)
    expect(drawPriceUsd('gemini-3.1-flash-image', '2K')).toBe(0.101)
    expect(drawPriceUsd('gemini-nano-banana-2.1', '2K')).toBe(0.0504)
    expect(vesperModelId('gemini-nano-banana-2.1')).toBe('gemini-nano-banana-2')
    expect(drawPriceUsd('gemini-3-pro-image', '4K')).toBe(0.24)
  })

  test('labels and in-between sizes', () => {
    expect(normaliseResolution('2K')).toBe(2048)
    expect(normaliseResolution('0.5K')).toBe(512)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 1500)).toBe(0.0504)
    expect(geminiImagePriceUsd('some-other-model', 1024)).toBeNull()
  })

  test('the web app cost calculator uses them, by resolution', () => {
    expect(calculateGenerationCost('gemini-nano-banana-pro', { outputCount: 2, resolution: 4096 }).cost).toBeCloseTo(0.48)
    expect(calculateGenerationCost('gemini-nano-banana-2', { outputCount: 1, resolution: 2048 }).cost).toBeCloseTo(0.0504)
  })

  test('the MCP estimate uses them', () => {
    expect(estimateGenerationCostUsd({ modelId: 'gemini-nano-banana-pro', numOutputs: 2 })).toBeCloseTo(0.268)
    expect(estimateGenerationCostUsd({ modelId: 'gemini-nano-banana-pro', resolution: 4096 })).toBeCloseTo(0.24)
    // gemini-veo-3.1 is Gemini Omni Flash: about $0.10 a second at 720p
    expect(estimateGenerationCostUsd({ modelId: 'gemini-veo-3.1', durationSeconds: 8 })).toBeCloseTo(0.8)
  })
})

test.describe('daily spend cap', () => {
  const env = (cap?: string) => ({ ...(cap ? { MCP_DAILY_COST_CAP_USD: cap } : {}) }) as NodeJS.ProcessEnv

  test('unset or zero means no cap', async () => {
    expect(dailyCostCapUsd(env())).toBeNull()
    expect(dailyCostCapUsd(env('0'))).toBeNull()
    const d = await checkDailyCostCap({
      ownerId: 'o',
      estimateUsd: 100,
      env: env(),
      spentToday: async () => {
        throw new Error('must not read spend without a cap')
      },
    })
    expect(d.ok).toBe(true)
  })

  test('refuses a call that would pass the cap, and says when it resets', async () => {
    const d = await checkDailyCostCap({ ownerId: 'o', estimateUsd: 0.27, env: env('25'), spentToday: async () => 24.9 })
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.message).toContain('$25.00')
      expect(d.message).toContain('00:00 UTC')
    }
    const ok = await checkDailyCostCap({ ownerId: 'o', estimateUsd: 0.1, env: env('25'), spentToday: async () => 24.9 })
    expect(ok.ok).toBe(true)
  })

  test('the day starts at 00:00 UTC', () => {
    expect(startOfUtcDay(new Date('2026-09-24T23:30:00+02:00')).toISOString()).toBe('2026-09-24T00:00:00.000Z')
  })
})
