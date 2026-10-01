import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { KitSchema, ProductKitSchema, type Kit, type KitProduct, type ProductKit } from '../src/lib/creative/kit-schema'
import { fillSkeleton } from '../src/lib/creative/skeleton'
import { REPLICATE_MODEL_CONFIGS, seedreamEnhancePrompt } from '../src/lib/models/replicate-utils'
import { ReplicateAdapter, SEEDREAM_4_CONFIG } from '../src/lib/models/adapters/replicate'
import {
  describePromptingSource,
  getPromptingSkillForClaude,
  getPromptingSystemPrompt,
  setKitPromptingLoader,
  sha256Hex,
  FALLBACK_SYSTEM_PROMPT,
} from '../src/lib/prompts/prompting-source'
import {
  findLoopProductName,
  findSkeletonFingerprint,
  guardVocabulary,
  kitGuardWords,
  loadGuardVocabulary,
  productPromptPassthrough,
  setGuardWordsLoader,
  SKELETON_FINGERPRINTS,
} from '../src/lib/prompts/product-prompt-guard'
import { buildRequestContent, enhancePrompt, NANO_BANANA_PRO_SMALL_TYPE, skillVersionFromSource } from '../src/lib/prompts/enhance'
import { iteratePrompt, iterateSystemPrompt } from '../src/lib/prompts/iterate'
import { ITERATION_SLATE_MODE_HEADING } from '../src/lib/prompts/iteration-slate-mode'

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

  test('what Claude reads skips the admin override: it is one model\'s rewrite instruction, not the skill', async () => {
    const src = await getPromptingSkillForClaude({ bundled })
    expect(src.source).toBe('bundled')
    setKitPromptingLoader(async () => ({ text: 'LOOP EDITION', version: 'creative 0.5.0 (genai-prompting 1.0.2)' }))
    const kit = await getPromptingSkillForClaude({ bundled })
    expect(kit.source).toBe('kit')
    expect(kit.text).toBe('LOOP EDITION')
  })

  test('each source is named in words; any but the kit tells Claude to say the kit is unavailable', () => {
    const kit = describePromptingSource({ source: 'kit', version: 'creative 0.5.0 (genai-prompting 1.0.2)', id: null })
    expect(kit).toContain('the Loop edition, creative 0.5.0 (genai-prompting 1.0.2)')
    expect(kit).toContain('replaces any generic prompting skill')
    for (const source of ['db', 'bundled', 'fallback'] as const) {
      const line = describePromptingSource({ source, version: null, id: 'row-1' })
      expect(line).toContain('the creative kit could not be read')
      expect(line).toContain('Tell the person the kit is unavailable')
      expect(line).not.toContain('replaces any generic prompting skill')
    }
    expect(describePromptingSource({ source: 'bundled', version: '2026-09-01T00:00:00.000Z', id: null })).toContain("Vesper's bundled copy")
    expect(describePromptingSource({ source: 'fallback', version: null, id: null })).toContain('generic fallback')
  })
})

/**
 * iterate_prompt ran on the bundled skill file and reported its hash while
 * enhance_prompt ran on the kit (until 2026-10-01). It now reads the same
 * source as enhance, never the admin override, with the slate schema on top.
 */
test.describe('iterate_prompt runs on the kit', () => {
  test.afterEach(() => setKitPromptingLoader(async () => null))

  test('the kit comes first, and the slate schema is appended once', async () => {
    setKitPromptingLoader(async () => ({ text: 'LOOP EDITION BODY', version: 'creative 0.5.0 (genai-prompting 1.0.2)' }))
    const { systemPrompt, source } = await iterateSystemPrompt('gemini-nano-banana-pro', { bundled })
    expect(source.source).toBe('kit')
    expect(source.version).toBe('creative 0.5.0 (genai-prompting 1.0.2)')
    expect(systemPrompt.startsWith('LOOP EDITION BODY')).toBe(true)
    expect(systemPrompt.split(ITERATION_SLATE_MODE_HEADING)).toHaveLength(2)
    expect(skillVersionFromSource(source).source).toBe('kit')
  })

  test('without the kit, the bundled skill, never the admin override', async () => {
    const { systemPrompt, source } = await iterateSystemPrompt('gemini-nano-banana-pro', { bundled })
    expect(source.source).toBe('bundled')
    expect(systemPrompt.startsWith('BUNDLED SKILL')).toBe(true)
    expect(systemPrompt).not.toContain('ADMIN OVERRIDE')
  })

  test('with nothing on disk, its own intro rather than the single-prompt fallback', async () => {
    const { systemPrompt, source } = await iterateSystemPrompt('m', { bundled: () => null })
    expect(source.source).toBe('fallback')
    expect(systemPrompt).toContain('Meta-Andromeda-aware ad creative iteration')
    expect(systemPrompt).not.toContain(FALLBACK_SYSTEM_PROMPT)
    expect(systemPrompt).toContain(ITERATION_SLATE_MODE_HEADING)
  })

  test('the real bundled file is still there as the fallback', async () => {
    const { source } = await iterateSystemPrompt('gemini-nano-banana-pro')
    expect(source.source).toBe('bundled')
    expect(source.text).toContain('Generative AI Prompt Engineering')
  })

  test('iteratePrompt still refuses without a key, before reading any skill', async () => {
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    let read = false
    setKitPromptingLoader(async () => {
      read = true
      return null
    })
    try {
      await expect(iteratePrompt({ prompt: 'x', modelId: 'gemini-nano-banana-pro' })).rejects.toThrow('ANTHROPIC_API_KEY')
      expect(read).toBe(false)
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
    }
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

/**
 * The guard reads the kits' words and matches a fingerprint only where a code-filled prompt has
 * it, at the start. Until 2026-10-01 it matched the short CMF sentence anywhere, so a free edit
 * prompt containing "Use the attached image as the exact base." came back unenhanced and labelled
 * a Loop skeleton, and the kit's own fingerprints were never read.
 */
test.describe('the guard reads the kits and matches how a code-filled prompt starts', () => {
  const FIX = join(__dirname, 'fixtures')
  const studio: Kit = KitSchema.parse(JSON.parse(readFileSync(join(FIX, 'creative', 'kit.v1.sample.json'), 'utf8')))
  const product: ProductKit = ProductKitSchema.parse(JSON.parse(readFileSync(join(FIX, 'creative', 'product-kit.v1.sample.json'), 'utf8')))
  const cmfFingerprint = (product.products.cmf as unknown as { template: { fingerprint: string } }).template.fingerprint
  // The creative kit as released since CMF moved out (studio-design-v0.5.0): no CMF fingerprint.
  const studioNow = JSON.parse(JSON.stringify(studio)) as Kit
  studioNow.prompting!.never_enhance_fingerprints = studioNow.prompting!.never_enhance_fingerprints.filter((fp) => fp !== cmfFingerprint)
  const fromKits = guardVocabulary(kitGuardWords(studioNow, product))
  const fromCode = guardVocabulary()

  // Real code-filled prompts: the Eclipse skeleton filled by code, the packaging finishing
  // skeleton, and a CMF prompt the plugin repository's prompt_build.py wrote.
  const eclipsePrompt = fillSkeleton(studio.products.eclipse as KitProduct, {
    n_refs: 2,
    colourway: 'Teal',
    scene: 'on a linen pillow in a hotel room at dawn',
    light: 'soft window light from the left',
    format: '4:5',
  })
  const packagingPrompt = String(((studio.products.packaging.generation ?? {}) as { skeleton: { text: string } }).skeleton.text).replace('[format]', '16:9')
  const cmfPrompt = JSON.parse(readFileSync(join(FIX, 'cmf', 'experience-2-cc--E--case-experience2--front.payload.json'), 'utf8')).prompt as string
  const freeWithSentence = 'Turn the sofa dark green. Use the attached image as the exact base. Keep the rug as it is.'

  const realCreate = Anthropic.Messages.prototype.create
  let modelCalls = 0
  let savedKey: string | undefined

  test.beforeEach(() => {
    modelCalls = 0
    savedKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key-not-sent'
    Anthropic.Messages.prototype.create = async function () {
      modelCalls++
      return { content: [{ type: 'text', text: 'A REWRITTEN PROMPT' }] }
    } as unknown as typeof realCreate
  })

  test.afterEach(() => {
    Anthropic.Messages.prototype.create = realCreate
    setGuardWordsLoader(null)
    setKitPromptingLoader(async () => null)
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })

  test("the kits' words are read: the creative kit's fingerprints and products, CMF's from the product kit", () => {
    expect(fromKits.source).toEqual({ studio: 'kit', cmf: 'kit' })
    expect(fromKits.fingerprints).toEqual(expect.arrayContaining([...studioNow.prompting!.never_enhance_fingerprints, cmfFingerprint]))
    expect(fromKits.fingerprints).not.toContain(SKELETON_FINGERPRINTS[1])
    expect(fromKits.products.map((p) => p.name).sort()).toEqual(['Eclipse', 'Packaging'])
    // A kit that cannot be read leaves only its own part to the copies.
    expect(guardVocabulary(kitGuardWords(studioNow, null)).source).toEqual({ studio: 'kit', cmf: 'code' })
    expect(guardVocabulary(kitGuardWords(null, product)).source).toEqual({ studio: 'code', cmf: 'kit' })
    expect(fromCode.source).toEqual({ studio: 'code', cmf: 'code' })
    expect([...fromCode.fingerprints].sort()).toEqual([...SKELETON_FINGERPRINTS].sort())
  })

  test('the kits are read at run time, and a kit that fails leaves the copies', async () => {
    setGuardWordsLoader(async () => kitGuardWords(studioNow, product))
    expect((await loadGuardVocabulary()).source).toEqual({ studio: 'kit', cmf: 'kit' })
    setGuardWordsLoader(async () => {
      throw new Error('GitHub is down')
    })
    expect((await loadGuardVocabulary()).source).toEqual({ studio: 'code', cmf: 'code' })
    setGuardWordsLoader(null)
    expect((await loadGuardVocabulary()).source).toEqual({ studio: 'code', cmf: 'code' }) // no GitHub App in tests
  })

  test('a real Eclipse, packaging or CMF prompt still passes through unchanged', () => {
    for (const vocabulary of [fromKits, fromCode]) {
      for (const p of [eclipsePrompt, packagingPrompt, cmfPrompt]) {
        expect(productPromptPassthrough(p, { vocabulary })?.reason, p.slice(0, 40)).toBe('skeleton')
      }
    }
  })

  test('a free prompt holding the CMF sentence mid-text is not a skeleton', () => {
    for (const vocabulary of [fromKits, fromCode]) {
      expect(productPromptPassthrough(freeWithSentence, { vocabulary })).toBeNull()
      expect(productPromptPassthrough(`Edit: ${eclipsePrompt}`, { vocabulary })).toBeNull()
    }
    // With the kit's longer fingerprint, a free prompt may even open with the sentence.
    expect(productPromptPassthrough('Use the attached image as the exact base. Make the sky pink.', { vocabulary: fromKits })).toBeNull()
  })

  test('enhancePrompt rewrites the free prompt and returns every skeleton unchanged without a model call', async () => {
    setGuardWordsLoader(async () => kitGuardWords(studioNow, product))
    const free = await enhancePrompt({ prompt: freeWithSentence, modelId: 'gemini-nano-banana-pro' })
    expect(free.passthrough).toBeNull()
    expect(free.enhancedPrompt).toBe('A REWRITTEN PROMPT')
    expect(modelCalls).toBe(1)
    for (const p of [eclipsePrompt, packagingPrompt, cmfPrompt]) {
      const out = await enhancePrompt({ prompt: p, modelId: 'gemini-nano-banana-pro' })
      expect(out.enhancedPrompt).toBe(p)
      expect(out.enhancementModel).toBe('none')
      expect(out.passthrough?.reason).toBe('skeleton')
    }
    expect(modelCalls).toBe(1)
  })

  // The name check counts full product names only, as main did: the kit product's own name beside
  // the brand, and the names main matched. A generic word (box, mask, packaging) never counts.
  const genericLoopPrompts = ['Loop packaging on a shelf', 'Loop box', 'a Loop mask', 'Loop sleep mask on a pillow']

  test('only a full product name counts, as on main; a generic word beside the brand does not', () => {
    for (const { products } of [fromKits, fromCode]) {
      expect(findLoopProductName('Loop Eclipse on a pillow', products)).toBe('Loop Eclipse')
      expect(findLoopProductName('A Loop Eclipse sleep mask on a linen pillow', products)).toBe('Loop Eclipse')
      expect(findLoopProductName('Eclipse sleep mask', products)).toBe('Eclipse sleep mask')
      expect(findLoopProductName('Coachella packaging on a festival table', products)).toBe('Coachella packaging')
      expect(findLoopProductName('a Coachella box at the gate', products)).toBe('Coachella box')
      expect(findLoopProductName("Loop's retail box on a shelf", products)).toBe("Loop's retail box")
      expect(findLoopProductName('a solar eclipse over the sea', products)).toBeNull()
      expect(findLoopProductName('a mask on the nightstand', products)).toBeNull()
      for (const p of genericLoopPrompts) expect(findLoopProductName(p, products), p).toBeNull()
    }
  })

  test('on the MCP surface, a generic Loop prompt is enhanced and a full product name passes through', async () => {
    setGuardWordsLoader(async () => kitGuardWords(studioNow, product))
    for (const p of genericLoopPrompts) {
      const out = await enhancePrompt({ prompt: p, modelId: 'gemini-nano-banana-pro', guardProductNames: true })
      expect(out.passthrough, p).toBeNull()
      expect(out.enhancedPrompt, p).toBe('A REWRITTEN PROMPT')
    }
    expect(modelCalls).toBe(genericLoopPrompts.length)
    for (const p of ['Loop Eclipse on a pillow', 'Eclipse sleep mask']) {
      const out = await enhancePrompt({ prompt: p, modelId: 'gemini-nano-banana-pro', guardProductNames: true })
      expect(out.passthrough?.reason, p).toBe('product')
      expect(out.enhancedPrompt, p).toBe(p)
    }
    expect(modelCalls).toBe(genericLoopPrompts.length)
  })

  test("the note names the tool that draws the product, not a tool still to come", () => {
    const eclipseNote = productPromptPassthrough('A Loop Eclipse on a pillow', { checkProductNames: true, vocabulary: fromKits })!
    expect(eclipseNote.reason).toBe('product')
    expect(eclipseNote.note).toContain('generate_product_image')
    expect(eclipseNote.note).not.toContain('once it is connected')
    const boxNote = productPromptPassthrough('The Loop Coachella box on a table', { checkProductNames: true, vocabulary: fromKits })!
    expect(boxNote.note).toContain('packaging_mockup, then packaging_finish')
  })
})

/** Seedream rewrote every prompt, the skeletons Vesper's own rewrite leaves alone included. */
test.describe("Seedream's own rewrite", () => {
  const product: ProductKit = ProductKitSchema.parse(
    JSON.parse(readFileSync(join(__dirname, 'fixtures', 'creative', 'product-kit.v1.sample.json'), 'utf8'))
  )
  const cmfPrompt = JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'cmf', 'experience-2-cc--E--case-experience2--front.payload.json'), 'utf8')
  ).prompt as string
  const vocabulary = guardVocabulary(kitGuardWords(null, product))
  const realFetch = globalThis.fetch

  test.afterEach(() => {
    globalThis.fetch = realFetch
    setGuardWordsLoader(null)
  })

  test('is off for a code-filled product prompt and on for every other prompt', () => {
    expect(seedreamEnhancePrompt(cmfPrompt, vocabulary)).toBe(false)
    expect(seedreamEnhancePrompt(cmfPrompt)).toBe(false)
    expect(seedreamEnhancePrompt("Using the provided mockup of Loop's retail box (image 1) as the exact picture")).toBe(false)
    expect(seedreamEnhancePrompt('a red chair in a white room', vocabulary)).toBe(true)
    expect(seedreamEnhancePrompt('Turn the sofa green. Use the attached image as the exact base.', vocabulary)).toBe(true)
    // A product name alone is not a code-filled prompt.
    expect(seedreamEnhancePrompt('A Loop Eclipse sleep mask on a pillow', vocabulary)).toBe(true)
  })

  test('the webhook path sends the same', () => {
    const build = REPLICATE_MODEL_CONFIGS['replicate-seedream-4'].buildInput
    expect(build({ prompt: cmfPrompt, guardVocabulary: vocabulary }).enhance_prompt).toBe(false)
    expect(build({ prompt: 'a red chair' }).enhance_prompt).toBe(true)
  })

  test('the adapter sends enhance_prompt false for a skeleton and true for a free prompt', async () => {
    setGuardWordsLoader(async () => kitGuardWords(null, product))
    const sent: Array<Record<string, unknown>> = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/models/')) return new Response(JSON.stringify({ latest_version: { id: 'v1' } }), { status: 200 })
      sent.push(JSON.parse(String(init?.body ?? '{}')).input)
      return new Response(JSON.stringify({ detail: 'stopped by the test' }), { status: 422 })
    }) as unknown as typeof fetch
    const adapter = new ReplicateAdapter(SEEDREAM_4_CONFIG)
    ;(adapter as unknown as { apiKey: string }).apiKey = 'test-token-not-sent'
    const skeleton = await adapter.generate({ prompt: cmfPrompt })
    const free = await adapter.generate({ prompt: 'a red chair in a white room' })
    expect(skeleton.status).toBe('failed')
    expect(free.status).toBe('failed')
    expect(sent.map((input) => input.enhance_prompt)).toEqual([false, true])
    expect(sent[0].prompt).toBe(cmfPrompt)
  })
})

test.describe('the standard text-to-image request', () => {
  test('no longer asks the model to add lighting, camera and framing', () => {
    const content = buildRequestContent({ userPrompt: 'a red chair', modelId: 'gemini-nano-banana-pro', hasReferenceImage: false })
    expect(content).not.toMatch(/lighting, camera, framing/)
    expect(content).toContain('Clarify ambiguous elements')
  })

  test("no longer tells the rewrite that Nano Banana Pro renders text precisely: the kit's small-type-in-code", () => {
    for (const userPrompt of ['give me a prompt for a poster', 'give me a prompt in this style for a poster', 'make the sky pink']) {
      const content = buildRequestContent({ userPrompt, modelId: 'gemini-nano-banana-pro', hasReferenceImage: true })
      expect(content).not.toMatch(/precise text\/layout rendering|precision for typography/)
    }
    const prompted = buildRequestContent({ userPrompt: 'give me a prompt for a poster', modelId: 'gemini-nano-banana-pro', hasReferenceImage: true })
    expect(prompted).toContain(`polished asset quality when relevant. ${NANO_BANANA_PRO_SMALL_TYPE}`)
    const styled = buildRequestContent({ userPrompt: 'give me a prompt in this style for a poster', modelId: 'gemini-nano-banana-pro', hasReferenceImage: true })
    expect(styled).toContain(`production-ready assets. ${NANO_BANANA_PRO_SMALL_TYPE}`)
    expect(NANO_BANANA_PRO_SMALL_TYPE).toContain('2026-09-24')
  })

  test('the small-type line is a dated observation: it never tells a web or MCP caller that type is placed in code', () => {
    // The packaging lesson places small type in code; the web app has no code that places type.
    for (const userPrompt of ['give me a prompt for a poster', 'give me a prompt in this style for a poster', 'make the sky pink']) {
      for (const hasReferenceImage of [true, false]) {
        const content = buildRequestContent({ userPrompt, modelId: 'gemini-nano-banana-pro', hasReferenceImage })
        expect(content).not.toMatch(/placed in code|never drawn by the model/)
      }
    }
    expect(NANO_BANANA_PRO_SMALL_TYPE).toMatch(/^On Loop packaging round 1 \(2026-09-24\), Nano Banana Pro redrew small type at 2K/)
  })
})
