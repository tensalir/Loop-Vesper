import { test, expect } from '@playwright/test'
import { MCP_TOOLS, findMcpTool } from '../src/lib/headless/mcp-tools'
import {
  HeadlessEnhanceSchema,
  HeadlessIterateSchema,
  HeadlessGenerateAssetSchema,
  HeadlessEstimateCostSchema,
} from '../src/lib/api/validation'

test.describe('MCP_TOOLS catalog', () => {
  test('exposes the expected tool names', () => {
    const names = MCP_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual([
      'cmf_check_pdf',
      'cmf_list',
      'cmf_prompt',
      'cmf_render',
      'enhance_prompt',
      'estimate_generation_cost',
      'export_creative_records',
      'generate_asset',
      'generate_product_image',
      'generate_video',
      'get_creative_kit',
      'get_generation_status',
      'get_product_references',
      'grade_image',
      'iterate_prompt',
      'list_creative_products',
      'list_feedback',
      'list_feedback_targets',
      'list_models',
      'list_product_renders',
      'packaging_finish',
      'packaging_list_looks',
      'packaging_mockup',
      'preview_feedback',
      'record_grade',
      'record_verdict',
      'submit_feedback',
    ])
  })

  test('every tool has description, inputSchema, and annotations', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(typeof tool.inputSchema).toBe('object')
      expect((tool.inputSchema as { type?: string }).type).toBe('object')
      expect(tool.annotations).toBeDefined()
    }
  })

  test('generate_asset is registered with inline default and allowFallback', () => {
    const tool = findMcpTool('generate_asset')
    expect(tool).toBeDefined()
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties
    expect((props?.inlineBase64 as { default?: boolean })?.default).toBe(true)
    expect((props?.allowFallback as { default?: boolean })?.default).toBe(true)
  })

  test('read-only tools set readOnlyHint', () => {
    for (const name of ['list_models', 'list_product_renders', 'get_generation_status']) {
      const tool = findMcpTool(name)
      expect(tool?.annotations?.readOnlyHint).toBe(true)
    }
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
})

test.describe('HeadlessGenerateAssetSchema', () => {
  test('defaults inlineBase64 to true and allowFallback to true', () => {
    const result = HeadlessGenerateAssetSchema.safeParse({
      prompt: 'test',
      modelId: 'gemini-nano-banana-pro',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.inlineBase64).toBe(true)
      expect(result.data.allowFallback).toBe(true)
    }
  })
})

test.describe('HeadlessEstimateCostSchema', () => {
  test('accepts modelId only', () => {
    const result = HeadlessEstimateCostSchema.safeParse({
      modelId: 'openai-gpt-image-2',
    })
    expect(result.success).toBe(true)
  })
})
