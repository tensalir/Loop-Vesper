import { test, expect } from '@playwright/test'
import { checkDailyCostCap, dailyCostCapUsd, startOfUtcDay } from '../src/lib/headless/cost-cap'
import { geminiImagePriceUsd, normaliseResolution } from '../src/lib/models/pricing'
import { calculateGenerationCost } from '../src/lib/cost/calculator'
import { estimateGenerationCostUsd } from '../src/lib/headless/estimate-cost'

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

  test('Nano Banana 2 by resolution', () => {
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 512)).toBe(0.045)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 1024)).toBe(0.067)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 2048)).toBe(0.101)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 4096)).toBe(0.151)
  })

  test('labels and in-between sizes', () => {
    expect(normaliseResolution('2K')).toBe(2048)
    expect(normaliseResolution('0.5K')).toBe(512)
    expect(geminiImagePriceUsd('gemini-nano-banana-2', 1500)).toBe(0.101)
    expect(geminiImagePriceUsd('some-other-model', 1024)).toBeNull()
  })

  test('the web app cost calculator uses them, by resolution', () => {
    expect(calculateGenerationCost('gemini-nano-banana-pro', { outputCount: 2, resolution: 4096 }).cost).toBeCloseTo(0.48)
    expect(calculateGenerationCost('gemini-nano-banana-2', { outputCount: 1, resolution: 2048 }).cost).toBeCloseTo(0.101)
  })

  test('the MCP estimate uses them', () => {
    expect(estimateGenerationCostUsd({ modelId: 'gemini-nano-banana-pro', numOutputs: 2 })).toBeCloseTo(0.268)
    expect(estimateGenerationCostUsd({ modelId: 'gemini-nano-banana-pro', resolution: 4096 })).toBeCloseTo(0.24)
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
