import { test, expect } from '@playwright/test'
import { cmfLegacyPrompting, pickVariantIndex } from '../src/lib/cmf/render'

/**
 * CMF Studio sends the code-built prompt as it is and holds the light fixed.
 * CMF_LEGACY_PROMPTING=1 restores the model rewrite and the rotating light.
 */

test('legacy prompting is off unless the flag is exactly 1', () => {
  expect(cmfLegacyPrompting({} as NodeJS.ProcessEnv)).toBe(false)
  expect(cmfLegacyPrompting({ CMF_LEGACY_PROMPTING: '0' } as unknown as NodeJS.ProcessEnv)).toBe(false)
  expect(cmfLegacyPrompting({ CMF_LEGACY_PROMPTING: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false)
  expect(cmfLegacyPrompting({ CMF_LEGACY_PROMPTING: '1' } as unknown as NodeJS.ProcessEnv)).toBe(true)
})

test('by default every attempt gets variant 0 (Studio Classic)', () => {
  for (const attemptNumber of [1, 2, 3, 4, 5, 9]) {
    expect(pickVariantIndex({ attemptNumber, isRefinement: false })).toBe(0)
  }
})

test('a refinement still reuses its parent variant, in both modes', () => {
  expect(pickVariantIndex({ attemptNumber: 6, parentAttemptNumber: 3, isRefinement: true })).toBe(2)
  expect(
    pickVariantIndex({ attemptNumber: 6, parentAttemptNumber: 3, isRefinement: true, legacyRotation: true })
  ).toBe(2)
})
