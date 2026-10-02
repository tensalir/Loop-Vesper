import { test, expect } from '@playwright/test'
import { RENDER_TYPES, RENDER_TYPE_LABELS, canonicalProductName } from '../src/lib/product-renders/types'
import { HeadlessListProductRendersSchema } from '../src/lib/api/validation'
import { findMcpTool } from '../src/lib/headless/mcp-tools'

test.describe('product render types', () => {
  test('the MCP filter takes every type the library holds, packaging and in-ear included', () => {
    for (const renderType of RENDER_TYPES) {
      expect(HeadlessListProductRendersSchema.safeParse({ renderType }).success).toBe(true)
    }
    expect(RENDER_TYPES).toContain('packaging')
    expect(RENDER_TYPES).toContain('in-ear')
    expect(HeadlessListProductRendersSchema.safeParse({ renderType: 'box' }).success).toBe(false)
  })

  test('the MCP tool advertises the same types the schema accepts', () => {
    const tool = findMcpTool('list_product_renders')
    const props = (tool?.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties
    expect(props.renderType.enum).toEqual([...RENDER_TYPES])
  })

  test('every type has a label for the browser and the settings', () => {
    for (const renderType of RENDER_TYPES) {
      expect(RENDER_TYPE_LABELS[renderType]).toBeTruthy()
    }
  })
})

test.describe('canonicalProductName', () => {
  test('a codename and the brand-prefixed name find the product', () => {
    expect(canonicalProductName('Aphrodite')).toBe('Live Pro')
    expect(canonicalProductName('aphrodite')).toBe('Live Pro')
    expect(canonicalProductName('Loop Live Pro')).toBe('Live Pro')
    // the library is searched case-insensitively, so the caller's casing may stay
    expect(canonicalProductName('  loop   live pro ')).toBe('live pro')
    expect(canonicalProductName('Loop Aphrodite')).toBe('Live Pro')
  })

  test('other names come back as they are, without the brand', () => {
    expect(canonicalProductName('Live Pro')).toBe('Live Pro')
    expect(canonicalProductName('Engage 2')).toBe('Engage 2')
    expect(canonicalProductName('Loop Dream')).toBe('Dream')
    expect(canonicalProductName('Loop')).toBe('Loop')
  })
})
