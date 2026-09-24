import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  HEADLESS_TOOLS,
  TOOL_META,
  ORG_DEFAULT_TOOLS,
  SELF_ISSUED_TOOLS,
  ADMIN_ISSUABLE_TOOLS,
  effectiveTools,
  canPollJobs,
} from '../src/lib/headless/tool-registry'
import { MCP_TOOLS } from '../src/lib/headless/mcp-tools'
import { TOOL_HANDLERS } from '../src/lib/headless/tools'
import { HeadlessGenerateAssetSchema, HeadlessGenerateVideoSchema } from '../src/lib/api/validation'

/**
 * One registry decides which tools exist and who gets them. These tests hold
 * every other list to it, so a new tool cannot ship half-wired.
 */

test.describe('the tool registry', () => {
  test('registry, MCP definitions and handlers name the same tools', () => {
    const registry = [...HEADLESS_TOOLS].sort()
    expect(MCP_TOOLS.map((t) => t.name).sort()).toEqual(registry)
    expect(Object.keys(TOOL_HANDLERS).sort()).toEqual(registry)
    expect(Object.keys(TOOL_META).sort()).toEqual(registry)
  })

  test('every tool has a handler with run(), and paid tools estimate their cost', () => {
    for (const tool of HEADLESS_TOOLS) {
      expect(typeof TOOL_HANDLERS[tool].run).toBe('function')
    }
    expect(typeof TOOL_HANDLERS.generate_asset.estimateCostUsd).toBe('function')
    expect(typeof TOOL_HANDLERS.generate_video.estimateCostUsd).toBe('function')
    expect(TOOL_HANDLERS.list_models.estimateCostUsd).toBeUndefined()
  })

  test('newly issued org tokens get exactly the five tools the live one has', () => {
    expect(ORG_DEFAULT_TOOLS).toEqual([
      'enhance_prompt',
      'iterate_prompt',
      'list_models',
      'generate_asset',
      'list_product_renders',
    ])
  })

  test('self-issued tokens get all eight tools, admins may issue any', () => {
    expect([...SELF_ISSUED_TOOLS].sort()).toEqual([...HEADLESS_TOOLS].sort())
    expect([...ADMIN_ISSUABLE_TOOLS].sort()).toEqual([...HEADLESS_TOOLS].sort())
  })

  test('the org CLI script only names tools the registry knows', () => {
    const script = readFileSync(join(__dirname, '..', 'scripts', 'issue-org-credential.mjs'), 'utf8')
    const block = script.match(/const ALLOWED_TOOLS = \[([\s\S]*?)\]/)
    expect(block).not.toBeNull()
    const names = Array.from(block![1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1])
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) {
      expect(HEADLESS_TOOLS as readonly string[]).toContain(name)
    }
  })
})

test.describe('effectiveTools', () => {
  test('an explicit list is honoured as stored, unknown names dropped', () => {
    const tools = effectiveTools({ allowedTools: ['list_models', 'generate_asset', 'retired_tool'] })
    expect(tools).toEqual(['list_models', 'generate_asset'])
  })

  test('the live org token keeps its five tools and cannot poll', () => {
    const tools = effectiveTools({ allowedTools: ORG_DEFAULT_TOOLS })
    expect(tools).toEqual(ORG_DEFAULT_TOOLS)
    expect(canPollJobs(tools)).toBe(false)
  })

  test("'*' expands to every OAuth tool the owner's flags allow", () => {
    const tools = effectiveTools({ allowedTools: ['*'] }, { role: 'user' })
    expect([...tools].sort()).toEqual([...HEADLESS_TOOLS].sort())
    expect(canPollJobs(tools)).toBe(true)
  })
})

test.describe('async stays a schema option', () => {
  test('generate_asset defaults async to false, generate_video to true', () => {
    const a = HeadlessGenerateAssetSchema.parse({ prompt: 'x', modelId: 'gemini-nano-banana-pro' })
    expect(a.async).toBe(false)
    const v = HeadlessGenerateVideoSchema.parse({ prompt: 'x', modelId: 'gemini-veo-3.1' })
    expect(v.async).toBe(true)
  })
})
