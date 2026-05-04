import { test, expect } from '@playwright/test'
import { MCP_TOOLS, findMcpTool } from '../src/lib/headless/mcp-tools'
import {
  HeadlessEnhanceSchema,
  HeadlessIterateSchema,
} from '../src/lib/api/validation'

/**
 * MCP contract tests. These guard the public shape of the tool catalog
 * and the validation schemas the MCP dispatcher uses, so changes to the
 * tool list, descriptions, or required fields are intentional.
 */

test.describe('MCP_TOOLS catalog', () => {
  test('exposes the expected tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual(['enhance_prompt', 'iterate_prompt', 'list_models'])
  })

  test('every tool has a non-empty description and inputSchema', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(typeof tool.inputSchema).toBe('object')
      expect((tool.inputSchema as { type?: string }).type).toBe('object')
    }
  })

  test('findMcpTool returns the expected definition', () => {
    expect(findMcpTool('enhance_prompt')?.name).toBe('enhance_prompt')
    expect(findMcpTool('iterate_prompt')?.name).toBe('iterate_prompt')
    expect(findMcpTool('list_models')?.name).toBe('list_models')
  })

  test('findMcpTool returns undefined for unknown tools', () => {
    expect(findMcpTool('generate_asset')).toBeUndefined()
    expect(findMcpTool('definitely_not_a_tool')).toBeUndefined()
  })
})

test.describe('HeadlessEnhanceSchema', () => {
  test('accepts a minimal valid payload', () => {
    const result = HeadlessEnhanceSchema.safeParse({
      prompt: 'A cinematic still of a desert at dusk.',
      modelId: 'gemini-nano-banana-2',
    })
    expect(result.success).toBe(true)
  })

  test('rejects empty prompts', () => {
    const result = HeadlessEnhanceSchema.safeParse({
      prompt: '',
      modelId: 'gemini-nano-banana-2',
    })
    expect(result.success).toBe(false)
  })

  test('rejects oversized reference images', () => {
    const oversize = 'data:image/png;base64,' + 'A'.repeat(7 * 1024 * 1024)
    const result = HeadlessEnhanceSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      referenceImage: oversize,
    })
    expect(result.success).toBe(false)
  })

  test('accepts an 8000-char prompt', () => {
    const result = HeadlessEnhanceSchema.safeParse({
      prompt: 'a'.repeat(8000),
      modelId: 'm',
    })
    expect(result.success).toBe(true)
  })

  test('rejects an 8001-char prompt', () => {
    const result = HeadlessEnhanceSchema.safeParse({
      prompt: 'a'.repeat(8001),
      modelId: 'm',
    })
    expect(result.success).toBe(false)
  })
})

test.describe('HeadlessIterateSchema', () => {
  test('accepts a minimal valid payload and defaults variantCount to 4', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'baseline ad concept',
      modelId: 'gemini-nano-banana-2',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variantCount).toBe(4)
    }
  })

  test('rejects variantCount below 2', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      variantCount: 1,
    })
    expect(result.success).toBe(false)
  })

  test('rejects variantCount above 8', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      variantCount: 9,
    })
    expect(result.success).toBe(false)
  })

  test('accepts well-formed anchors', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      anchors: {
        product: 'Loop Switch',
        offer: 'Free shipping',
        audience: 'Focus workers',
        brand: 'Loop tone-of-voice rules',
        lockedText: 'Find your sound',
        theme: 'Concentration without isolation',
      },
    })
    expect(result.success).toBe(true)
  })

  test('rejects too many lockedAxes', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      lockedAxes: ['1', '2', '3', '4', '5', '6', '7', '8'],
    })
    expect(result.success).toBe(false)
  })

  test('rejects non-uuid baselineOutputId', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      baselineOutputId: 'not-a-uuid',
    })
    expect(result.success).toBe(false)
  })

  test('accepts a valid uuid baselineOutputId', () => {
    const result = HeadlessIterateSchema.safeParse({
      prompt: 'p',
      modelId: 'm',
      baselineOutputId: '123e4567-e89b-12d3-a456-426614174000',
    })
    expect(result.success).toBe(true)
  })
})
