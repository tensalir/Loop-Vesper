import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { getPromptingSkillForClaude, promptingSkillForChat, setKitPromptingLoader } from '../src/lib/prompts/prompting-source'
import { combineSkills } from '../src/lib/skills/registry'
import { enhancePrompt } from '../src/lib/prompts/enhance'
import { iteratePrompt } from '../src/lib/prompts/iterate'
import { getGenAiSkillResourceText, getMcpPromptMessages, MCP_PROMPTS } from '../src/lib/headless/mcp-prompts'
import { readMcpResource } from '../src/lib/headless/mcp-resources'
import { surfaces } from '../src/app/headless/content'

/**
 * Every prompting text Claude meets comes from `getPromptingSystemPrompt`
 * (src/lib/prompts/prompting-source.ts): the Loop edition from the creative kit
 * first. Until 2026-10-01 iterate_prompt ran on the bundled skill file, the MCP
 * prompts and the vesper://skill/genai-prompting resource fell back to a generic
 * copy in `src/lib/skills/genai-prompting/`, and /headless offered that generic
 * skill as a download, after the generic skill had been taken out of Loop's
 * Claude organisation. This file fails if a Claude-facing path reads a skill
 * file itself again.
 */

const ROOT = path.join(__dirname, '..')

/** The Claude-facing code: the prompt tools, the MCP server, and the headless routes. */
const SCANNED_DIRS = ['src/lib/prompts', 'src/lib/headless', 'src/app/api/headless', 'src/app/api/mcp']

/** The one module allowed to read the bundled skill, as the fallback when the kit cannot be read. */
const THE_SOURCE = 'src/lib/prompts/prompting-source.ts'

/**
 * Dead code nothing loaded (the loader looked under `lib/prompts`, without `src`), deleted on
 * 2026-10-01; the import ban below keeps it from coming back.
 */
const DELETED = [
  'src/lib/prompts/loadSkill.ts',
  'src/lib/prompts/genai-prompting.skill.md',
  'src/lib/prompts/enhancement-system.md',
]

/**
 * Vesper's own chats. Each loads its own skill from the registry (assistant, brainstorming), so
 * the scan above does not cover them; their prompting skill comes from the one source. Until
 * 2026-10-01 both read the bundled file with `loadSkill('genai-prompting')`.
 */
const CHATS = ['src/app/api/assistant/chat/route.ts', 'src/app/api/projects/[id]/brainstorm/chat/route.ts']

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return walk(rel)
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : []
  })
}

/** Code without its comments, so a comment may tell the history. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

const FORBIDDEN: Array<{ what: string; pattern: RegExp }> = [
  { what: 'imports the skill registry', pattern: /from\s+['"](@\/lib\/skills(\/registry|\/index)?|\.\.?\/(\.\.\/)*skills(\/registry)?)['"]/ },
  { what: 'imports the dead prompts loader', pattern: /from\s+['"](@\/lib\/prompts\/loadSkill|\.\/loadSkill)['"]/ },
  { what: 'calls loadSkill / getSkillSystemPrompt / getSkillVersion', pattern: /\b(loadSkill|getSkillSystemPrompt|getSkillVersion)\s*\(/ },
  { what: 'names a bundled prompting skill file', pattern: /genai-prompting\.skill(\.md)?\b|skills\/genai-prompting\b|genai-prompting\/SKILL\.md/ },
  { what: 'reads the kit prompting directly, around the order', pattern: /\bloadKitPrompting\b/ },
]

test.describe('no Claude-facing path reads a prompting skill file itself', () => {
  const files = SCANNED_DIRS.flatMap(walk).filter((f) => f !== THE_SOURCE)

  test('the scan sees the files it guards', () => {
    for (const f of [
      'src/lib/prompts/enhance.ts',
      'src/lib/prompts/iterate.ts',
      'src/lib/headless/mcp-prompts.ts',
      'src/lib/headless/mcp-resources.ts',
      'src/lib/headless/mcp-dispatch.ts',
      'src/lib/headless/tools/enhance-prompt.ts',
      'src/lib/headless/tools/iterate-prompt.ts',
    ]) {
      expect(files).toContain(f)
    }
  })

  for (const { what, pattern } of FORBIDDEN) {
    test(`no file ${what}`, () => {
      const offenders = files.filter((f) => pattern.test(code(f)))
      expect(offenders, `${what}: go through getPromptingSystemPrompt in ${THE_SOURCE}`).toEqual([])
    })
  }

  test('each path goes through the one source', () => {
    expect(code('src/lib/prompts/enhance.ts')).toMatch(/getPromptingSystemPrompt\(/)
    expect(code('src/lib/prompts/iterate.ts')).toMatch(/getPromptingSystemPrompt\([^)]*allowDbOverride:\s*false/)
    expect(code('src/lib/prompts/iterate.ts')).toMatch(/skillVersionFromSource\(source\)/)
    expect(code('src/lib/headless/mcp-prompts.ts')).toMatch(/getPromptingSkillForClaude\(/)
    expect(code('src/lib/headless/mcp-resources.ts')).toMatch(/getGenAiSkillResourceText\(/)
  })

  test('the bundled skill is kept as the fallback; the generic copies are gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/lib/skills/genai-prompting.skill.md'))).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'src/lib/skills/genai-prompting'))).toBe(false)
    expect(fs.existsSync(path.join(ROOT, 'public/skills/genai-prompting.skill'))).toBe(false)
  })

  test('the dead prompts loader and the two files only it could have read are gone', () => {
    for (const f of DELETED) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(false)
  })
})

test.describe("Vesper's own chats read the prompting skill through the one source", () => {
  for (const chat of CHATS) {
    test(chat, () => {
      const src = code(chat)
      expect(src).toMatch(/promptingSkillForChat\(await getPromptingSkillForClaude\(\)\)/)
      expect(src).not.toMatch(/loadSkill\(\s*['"]genai-prompting['"]\s*\)/)
      expect(src).not.toMatch(/getSkillSystemPrompt\(\s*['"]genai-prompting['"]/)
      expect(src).not.toMatch(/genai-prompting\.skill(\.md)?\b|skills\/genai-prompting\b/)
      expect(src).not.toMatch(/\bloadKitPrompting\b/)
    })
  }

  test('the chat section is the kit, or the bundled copy, and never the rewrite fallback', async () => {
    setKitPromptingLoader(async () => ({ text: 'KIT-SENTINEL', version: 'creative 9.9.9 (genai-prompting 9.9.9)' }))
    try {
      const fromKit = promptingSkillForChat(await getPromptingSkillForClaude())
      expect(fromKit?.content).toBe('KIT-SENTINEL')
      expect(combineSkills([{ id: 'assistant', metadata: { name: 'assistant' }, content: 'ASSISTANT', path: '', lastModified: new Date(0) }, fromKit!])).toContain(
        '## genai-prompting\n\nKIT-SENTINEL'
      )
    } finally {
      setKitPromptingLoader(async () => null)
    }
    const bundled = promptingSkillForChat(await getPromptingSkillForClaude({ bundled: () => ({ text: 'BUNDLED', lastModified: new Date(0) }) }))
    expect(bundled?.content).toBe('BUNDLED')
    expect(promptingSkillForChat(await getPromptingSkillForClaude({ bundled: () => null }))).toBeNull()
  })
})

/**
 * The same, by behaviour: with a sentinel standing in for the kit, every path
 * carries the sentinel. The model call is stubbed, so nothing leaves the test.
 */
test.describe('with the kit in place, every path carries it', () => {
  const SENTINEL = 'KIT-SENTINEL: the Loop edition of the prompting skill'
  const VERSION = 'creative 9.9.9 (genai-prompting 9.9.9)'
  const realCreate = Anthropic.Messages.prototype.create
  let systems: string[] = []
  let reply = ''
  let savedKey: string | undefined

  test.beforeEach(() => {
    systems = []
    savedKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key-not-sent'
    setKitPromptingLoader(async () => ({ text: SENTINEL, version: VERSION }))
    Anthropic.Messages.prototype.create = async function (body: { system?: string }) {
      systems.push(String(body.system ?? ''))
      return { content: [{ type: 'text', text: reply }] }
    } as unknown as typeof realCreate
  })

  test.afterEach(() => {
    Anthropic.Messages.prototype.create = realCreate
    setKitPromptingLoader(async () => null)
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })

  test('enhance_prompt sends the kit as its system prompt and reports it', async () => {
    reply = 'a sharper prompt'
    const result = await enhancePrompt({ prompt: 'a lemon on a table', modelId: 'gemini-nano-banana-pro' })
    expect(systems).toEqual([SENTINEL])
    expect(result.skill?.source).toBe('kit')
    expect(result.skill?.lastModified).toBe(VERSION)
  })

  test('iterate_prompt sends the kit, with the slate schema on top, and reports it', async () => {
    reply = JSON.stringify({
      theme: 't',
      anchors: {},
      axesVaried: ['Concept', 'Persona'],
      weakChangesAvoided: [],
      variants: [{ label: 'A', axis: {}, prompt: 'p', preserve: [], change: [], whyDifferentEnough: 'w' }],
    })
    const result = await iteratePrompt({ prompt: 'a lemon on a table', modelId: 'gemini-nano-banana-pro', variantCount: 2 })
    expect(systems).toHaveLength(1)
    expect(systems[0].startsWith(SENTINEL)).toBe(true)
    expect(result.skill?.source).toBe('kit')
    expect(result.skill?.lastModified).toBe(VERSION)
    expect(result.promptingSource.source).toBe('kit')
  })

  test('every MCP prompt and the resource carry the kit and its version', async () => {
    for (const { name } of MCP_PROMPTS) {
      const text = (await getMcpPromptMessages(name, { prompt: 'x', modelId: 'gemini-nano-banana-pro' }))!
        .messages.map((m) => m.content.text)
        .join('\n')
      expect(text, name).toContain(SENTINEL)
      expect(text, name).toContain(VERSION)
    }
    expect(await getGenAiSkillResourceText()).toContain(SENTINEL)
    const { contents } = await readMcpResource('vesper://skill/genai-prompting', { allowedModels: ['*'] })
    expect(contents[0].text).toContain(SENTINEL)
    expect(contents[0].text).toContain(VERSION)
  })
})

test.describe('/headless points to the plugin, not a download', () => {
  test('no surface offers a .skill file', () => {
    for (const s of surfaces) {
      expect(s.detail.action?.href ?? '').not.toMatch(/\.skill$/)
      expect(JSON.stringify(s)).not.toContain('Download genai-prompting')
    }
  })

  test('the skill surface names the Studio Design plugin, its skill and the marketplace', () => {
    const skill = surfaces.find((s) => s.id === 'skill')!
    const text = JSON.stringify(skill)
    expect(text).toContain('/studio-design:genai-prompting')
    expect(text).toContain('Loop Studio Design')
    expect(text).toContain('loop-ai-studio')
  })
})
