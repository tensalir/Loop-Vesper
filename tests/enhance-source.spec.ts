import { test, expect } from '@playwright/test'
import {
  getPromptingSystemPrompt,
  setKitPromptingLoader,
  sha256Hex,
  FALLBACK_SYSTEM_PROMPT,
} from '../src/lib/prompts/prompting-source'
import {
  findLoopProductName,
  findSkeletonFingerprint,
  productPromptPassthrough,
  SKELETON_FINGERPRINTS,
} from '../src/lib/prompts/product-prompt-guard'
import { buildRequestContent, enhancePrompt, skillVersionFromSource } from '../src/lib/prompts/enhance'

/**
 * The prompt rewrite's system prompt comes from one place, in a fixed order,
 * and code-filled Loop product prompts are never rewritten.
 */

const bundled = () => ({ text: 'BUNDLED SKILL', lastModified: new Date('2026-09-01T00:00:00Z') })
const noOverride = async () => null
const override = async () => ({ id: 'row-1', systemPrompt: 'ADMIN OVERRIDE', updatedAt: new Date('2026-09-02T00:00:00Z') })

test.describe('getPromptingSystemPrompt order', () => {
  test.afterEach(() => setKitPromptingLoader(async () => null))

  test('with no kit: the admin override comes before the bundled skill', async () => {
    const src = await getPromptingSystemPrompt('m', { override, bundled })
    expect(src.source).toBe('db')
    expect(src.id).toBe('row-1')
    expect(src.text).toBe('ADMIN OVERRIDE')
  })

  test('without an override: the bundled skill, hashed', async () => {
    const src = await getPromptingSystemPrompt('m', { override: noOverride, bundled })
    expect(src.source).toBe('bundled')
    expect(src.sha256).toBe(sha256Hex('BUNDLED SKILL'))
    expect(src.settings).toBeUndefined()
  })

  test('the admin override can be skipped (iterate and slates)', async () => {
    const src = await getPromptingSystemPrompt('m', { override, bundled, allowDbOverride: false })
    expect(src.source).toBe('bundled')
  })

  test('nothing on disk: the generic fallback, which no longer adds lighting or camera', async () => {
    const src = await getPromptingSystemPrompt('m', { override: noOverride, bundled: () => null })
    expect(src.source).toBe('fallback')
    expect(src.text).toBe(FALLBACK_SYSTEM_PROMPT)
    expect(src.text).not.toMatch(/lighting, camera, framing/)
  })

  test('the kit, once wired, comes first and carries its settings', async () => {
    setKitPromptingLoader(async () => ({ text: 'LOOP EDITION', version: '0.2.0', settings: { temperature: 0.3 } }))
    const src = await getPromptingSystemPrompt('m', { override, bundled })
    expect(src.source).toBe('kit')
    expect(src.version).toBe('0.2.0')
    expect(src.settings?.temperature).toBe(0.3)
  })

  test('a failing kit loader falls through', async () => {
    setKitPromptingLoader(async () => {
      throw new Error('github down')
    })
    const src = await getPromptingSystemPrompt('m', { override: noOverride, bundled })
    expect(src.source).toBe('bundled')
  })

  test('the reported skill version names the source that ran', () => {
    const v = skillVersionFromSource({
      text: 'x',
      source: 'db',
      sha256: sha256Hex('x'),
      version: '2026-09-02T00:00:00.000Z',
      id: 'row-1',
    })
    expect(v.skillId).toBe('prompt-override:row-1')
    expect(v.hash).toHaveLength(12)
    expect(v.source).toBe('db')
  })
})

test.describe('code-filled product prompts are not rewritten', () => {
  const eclipse =
    'Using the provided product render of the Loop Eclipse sleep mask (image 1) as the exact object,\nand the reference photograph (image 2) for how it is worn, a hotel room at dawn.'
  const cmf =
    'Use the attached image as the exact base. Keep geometry, proportions, camera angle, framing, lighting and background unchanged.'
  const packaging = "Using the provided mockup of Loop's retail box (image 1) as the exact picture, the white render"

  test('each skeleton fingerprint is recognised, across line wraps', () => {
    expect(findSkeletonFingerprint(eclipse)).toBe(SKELETON_FINGERPRINTS[0])
    expect(findSkeletonFingerprint(cmf)).toBe(SKELETON_FINGERPRINTS[1])
    expect(findSkeletonFingerprint(packaging)).toBe(SKELETON_FINGERPRINTS[2])
    expect(findSkeletonFingerprint('Using the provided product render of the Loop\n   Eclipse mask')).toBe(
      SKELETON_FINGERPRINTS[0]
    )
    expect(findSkeletonFingerprint('a cat on a sofa')).toBeNull()
  })

  test('product names are only checked when asked (the MCP tool asks, the web button does not)', () => {
    const prompt = 'A Loop Eclipse sleep mask on a linen pillow'
    expect(findLoopProductName(prompt)).toBe('Loop Eclipse')
    expect(productPromptPassthrough(prompt)).toBeNull()
    expect(productPromptPassthrough(prompt, { checkProductNames: true })?.reason).toBe('product')
    expect(findLoopProductName('a solar eclipse over the sea')).toBeNull()
  })

  test('enhancePrompt returns a skeleton prompt unchanged without calling a model', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const result = await enhancePrompt({ prompt: eclipse, modelId: 'gemini-nano-banana-pro' })
      expect(result.enhancedPrompt).toBe(eclipse)
      expect(result.enhancementModel).toBe('none')
      expect(result.passthrough?.reason).toBe('skeleton')
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
  })
})

test.describe('the standard text-to-image request', () => {
  test('no longer asks the model to add lighting, camera and framing', () => {
    const content = buildRequestContent({ userPrompt: 'a red chair', modelId: 'gemini-nano-banana-pro', hasReferenceImage: false })
    expect(content).not.toMatch(/lighting, camera, framing/)
    expect(content).toContain('Clarify ambiguous elements')
  })
})
