import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { determineProviderRoute } from '../src/lib/models/routing'
import { checkGoogleRateLimit, clearBlock } from '../src/lib/rate-limits/trackedFetch'

/**
 * `allowFallback: false` keeps a generation on Google. Until 2026-10-01 the web worker
 * (`/api/generate/process`) rerouted Nano Banana 2 to Replicate's Nano Banana Pro, and Veo 3.1 to
 * Kling 2.6, without reading the flag. Without the flag the route is as it was.
 *
 * The rate limits are set in memory (a 429 the provider sent), so nothing here reaches the database.
 */

const RATE_LIMITED = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } }

const CASES = [
  { model: 'gemini-nano-banana-2', googleScope: 'gemini-nano-banana-2', replicateScope: 'replicate-nano-banana', fallback: 'replicate-nano-banana-pro' },
  { model: 'gemini-veo-3.1', googleScope: 'gemini-veo-3.1', replicateScope: 'replicate-kling-2.6', fallback: 'replicate-kling-2.6' },
] as const

test.describe('the provider route honours allowFallback: false', () => {
  test.afterEach(() => {
    for (const c of CASES) {
      clearBlock('gemini', c.googleScope)
      clearBlock('replicate', c.replicateScope)
    }
  })

  for (const c of CASES) {
    test(`${c.model}: Google rate limited, the flag false never routes to ${c.fallback}`, async () => {
      expect(checkGoogleRateLimit(RATE_LIMITED, 'gemini', c.googleScope)).toBe(true)
      const route = await determineProviderRoute(c.model, { allowFallback: false })
      expect('error' in route && route.error).toBe(true)
      if (!('error' in route)) throw new Error('expected a refusal')
      expect(route.message).toContain('allowFallback: false')
      expect(route.message).toContain(c.fallback)
      expect(route.retryAfterSeconds).toBeGreaterThan(0)
    })

    test(`${c.model}: without the flag the route still reaches for Replicate, as before`, async () => {
      // Both blocked in memory: the old path runs to its end without the database.
      checkGoogleRateLimit(RATE_LIMITED, 'gemini', c.googleScope)
      checkGoogleRateLimit(RATE_LIMITED, 'replicate', c.replicateScope)
      for (const options of [undefined, { allowFallback: true }]) {
        const route = await determineProviderRoute(c.model, options)
        if (!('error' in route)) throw new Error('expected both providers blocked')
        expect(route.message).toContain('Both Google')
        expect(route.message).toContain('Replicate')
        expect(route.message).not.toContain('allowFallback')
      }
    })
  }

  test("the web worker passes the generation's flag to the route", () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/generate/process/route.ts'), 'utf8')
    expect(src).toMatch(/const allowFallback = \(generation\.parameters as any\)\?\.allowFallback !== false/)
    expect(src).toMatch(/determineProviderRoute\(generation\.modelId, \{ allowFallback \}\)/)
  })
})
