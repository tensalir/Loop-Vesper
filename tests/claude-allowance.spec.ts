import { test, expect } from '@playwright/test'
import {
  allowanceNeed,
  checkClaudeAllowance,
  claudeDailyLimit,
  CLAUDE_ALLOWANCE,
  COUNTED_IMAGES,
  imageDoorOf,
  WINDOW_MS,
  type AllowanceUsage,
  type CountedWork,
} from '../src/lib/headless/claude-allowance'
import { planRender, runRender, setCmfServiceDeps } from '../src/lib/creative/cmf/service'
import { IMPORT, KEY_ID } from './helpers/cmf-upload'
import { actor, DAMIEN, serviceWorld } from './helpers/cmf-service-world'
import { dispatch } from '../src/lib/headless/mcp-dispatch'
import { HEADLESS_TOOLS, type HeadlessTool } from '../src/lib/headless/tool-registry'
import { TOOL_HANDLERS } from '../src/lib/headless/tools'
import type { ToolPrincipal } from '../src/lib/headless/tools/types'

/**
 * The daily allowance for what Claude spends: images and grading reads per person over a
 * rolling 24 hours, checked before anything is paid for, admins exempt, 0 a kill switch.
 */

const NOW = new Date('2026-10-01T12:00:00Z')
const envOf = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv
const HOUR = 3600_000
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR)
const ENV = {} as NodeJS.ProcessEnv

/** Usage from a fixed list, the way the Prisma reader returns it (any order, any age). */
function usageOf(work: CountedWork[], seen: { kinds: string[] } = { kinds: [] }): AllowanceUsage {
  return async ({ kind }) => {
    seen.kinds.push(kind)
    return work
  }
}

const never: AllowanceUsage = async () => {
  throw new Error('usage should not be read')
}

/** n single images, one per hour, the oldest `oldest` hours ago. */
function images(n: number, oldest = 23): CountedWork[] {
  return Array.from({ length: n }, (_, i) => ({ at: ago(oldest - (i * oldest) / Math.max(1, n)), units: 1 }))
}

test.describe('checkClaudeAllowance', () => {
  test('admits a call under the limit, and one that fits exactly', async () => {
    const seen = { kinds: [] as string[] }
    const under = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 1 }, env: ENV, now: NOW, usage: usageOf(images(10), seen) })
    expect(under).toEqual({ ok: true })
    const exact = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 4 }, env: ENV, now: NOW, usage: usageOf(images(36)) })
    expect(exact).toEqual({ ok: true })
    expect(seen.kinds).toEqual(['image'])
  })

  test('refuses at the limit, saying how many were used, the limit and when the next one frees up', async () => {
    const work = images(40, 20) // the oldest 20 h ago, so the next frees in about 4 h
    const res = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 1 }, env: ENV, now: NOW, usage: usageOf(work) })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res).toMatchObject({ kind: 'image', used: 40, limit: 40, requested: 1 })
    expect(res.freesAt).toEqual(new Date(ago(20).getTime() + WINDOW_MS))
    expect(res.message).toContain('40 of your 40 images')
    expect(res.message).toContain('16:00 UTC')
    expect(res.message).toContain('in about 4 hours')
    expect(res.message).toContain('Nothing was made or paid for.')
  })

  test('a call that would pass the limit is told how many it may still ask for', async () => {
    const res = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 4 }, env: ENV, now: NOW, usage: usageOf(images(38)) })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.message).toContain('38 of your 40 images')
    expect(res.message).toContain('Ask for 2 or fewer')
    // Two images must leave the window before four fit: the second oldest's turn.
    const sorted = images(38).sort((a, b) => a.at.getTime() - b.at.getTime())
    expect(res.freesAt).toEqual(new Date(sorted[1].at.getTime() + WINDOW_MS))
  })

  test('work older than 24 hours no longer counts', async () => {
    const stale = Array.from({ length: 50 }, () => ({ at: ago(25), units: 1 }))
    const res = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 4 }, env: ENV, now: NOW, usage: usageOf(stale) })
    expect(res).toEqual({ ok: true })
  })

  test('admins are not limited, and their usage is never read', async () => {
    const res = await checkClaudeAllowance({ ownerId: 'admin', isAdmin: true, need: { kind: 'image', units: 4 }, env: ENV, now: NOW, usage: never })
    expect(res).toEqual({ ok: true })
  })

  test('0 refuses everything, admins included, without reading usage', async () => {
    for (const [kind, key] of [['image', 'CLAUDE_DAILY_IMAGE_LIMIT'], ['grade', 'CLAUDE_DAILY_GRADE_LIMIT']] as const) {
      for (const isAdmin of [false, true]) {
        const res = await checkClaudeAllowance({
          ownerId: 'p',
          isAdmin,
          need: { kind, units: 1 },
          env: envOf({ [key]: '0' }),
          now: NOW,
          usage: never,
        })
        expect(res.ok, `${kind} admin=${isAdmin}`).toBe(false)
        if (!res.ok) {
          expect(res.limit).toBe(0)
          expect(res.message).toContain('switched off')
        }
      }
    }
  })

  test('a call asking for more than the whole limit is told to ask for fewer', async () => {
    const res = await checkClaudeAllowance({
      ownerId: 'p',
      isAdmin: false,
      need: { kind: 'image', units: 4 },
      env: envOf({ CLAUDE_DAILY_IMAGE_LIMIT: '2' }),
      now: NOW,
      usage: usageOf([]),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.freesAt).toBeNull()
      expect(res.message).toContain('Ask for 2 or fewer')
    }
  })

  test('grading reads count against their own limit', async () => {
    const reads = Array.from({ length: 40 }, (_, i) => ({ at: ago(1 + i * 0.5), units: 3 }))
    const res = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'grade', units: 3 }, env: ENV, now: NOW, usage: usageOf(reads) })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res).toMatchObject({ kind: 'grade', used: 120, limit: 120 })
      expect(res.message).toContain('120 of your 120 grading reads')
      expect(res.message).toContain('Nothing was read or paid for.')
    }
    const underImages = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 1 }, env: ENV, now: NOW, usage: usageOf([]) })
    expect(underImages).toEqual({ ok: true })
  })

  test('a video counts as one image and says so', async () => {
    const res = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: allowanceNeed('generate_video', {})!, env: ENV, now: NOW, usage: usageOf(images(40)) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toContain('a video counts as one image')
  })
})

test.describe('the limits and what a call asks for', () => {
  test('defaults 40 and 120; a whole number of 0 or more is taken, anything else falls back', () => {
    expect(claudeDailyLimit('image', ENV)).toBe(40)
    expect(claudeDailyLimit('grade', ENV)).toBe(120)
    expect(claudeDailyLimit('image', envOf({ CLAUDE_DAILY_IMAGE_LIMIT: '10' }))).toBe(10)
    expect(claudeDailyLimit('image', envOf({ CLAUDE_DAILY_IMAGE_LIMIT: '0' }))).toBe(0)
    expect(claudeDailyLimit('image', envOf({ CLAUDE_DAILY_IMAGE_LIMIT: 'lots' }))).toBe(40)
    expect(claudeDailyLimit('grade', envOf({ CLAUDE_DAILY_GRADE_LIMIT: '-1' }))).toBe(120)
    expect(claudeDailyLimit('grade', envOf({ CLAUDE_DAILY_GRADE_LIMIT: ' ' }))).toBe(120)
  })

  test('each paid tool reads its count from its own arguments, clamped to what it accepts', () => {
    expect(allowanceNeed('generate_asset', {})).toEqual({ kind: 'image', units: 1 })
    expect(allowanceNeed('generate_asset', { numOutputs: 3 })).toEqual({ kind: 'image', units: 3 })
    expect(allowanceNeed('generate_asset', { numOutputs: 99 })).toEqual({ kind: 'image', units: 4 })
    expect(allowanceNeed('generate_product_image', { n: 2 })).toEqual({ kind: 'image', units: 2 })
    expect(allowanceNeed('cmf_render', { n: 4 })).toEqual({ kind: 'image', units: 4 })
    expect(allowanceNeed('packaging_finish', { n: 0 })).toEqual({ kind: 'image', units: 1 })
    expect(allowanceNeed('generate_video', { numOutputs: 4 })).toEqual({ kind: 'image', units: 1, video: true })
    expect(allowanceNeed('grade_image', {})).toEqual({ kind: 'grade', units: 3 })
    expect(allowanceNeed('grade_image', { runs: 1 })).toEqual({ kind: 'grade', units: 1 })
    expect(allowanceNeed('grade_image', { runs: 50 })).toEqual({ kind: 'grade', units: 5 })
    for (const free of ['packaging_mockup', 'record_grade', 'cmf_prompt', 'cmf_check_pdf', 'list_models', 'submit_feedback']) {
      expect(allowanceNeed(free, {}), free).toBeNull()
    }
  })

  test('the allowance covers exactly the tools that estimate a cost', () => {
    const paid = HEADLESS_TOOLS.filter((t) => TOOL_HANDLERS[t].estimateCostUsd)
    const covered = Object.keys(CLAUDE_ALLOWANCE) as HeadlessTool[]
    expect([...covered].sort()).toEqual([...paid].sort())
  })
})

test.describe('the check in the dispatcher', () => {
  const person: ToolPrincipal = {
    credentialId: 'cred-1',
    ownerId: 'person-1',
    ownerRole: 'user',
    allowedTools: [...HEADLESS_TOOLS],
    allowedModels: ['*'],
  }

  function call(name: string, args: Record<string, unknown>) {
    return { jsonrpc: '2.0' as const, id: 7, method: 'tools/call', params: { name, arguments: args } }
  }

  test('a refusal is an isError tool result, the tool never runs, and the refusal is logged', async () => {
    let ran = false
    const logged: Array<{ status: string; errorCategory?: string | null }> = []
    const handlers = {
      ...TOOL_HANDLERS,
      generate_asset: {
        run: async () => {
          ran = true
          return { content: [] }
        },
      },
    }
    const res = (await dispatch(call('generate_asset', { prompt: 'x', modelId: 'gemini-nano-banana-pro', numOutputs: 2 }), person, {
      handlers,
      recordUsage: async (entry) => {
        logged.push(entry)
      },
      checkAllowance: async (input) => {
        expect(input).toMatchObject({ ownerId: 'person-1', isAdmin: false, need: { kind: 'image', units: 2 } })
        return { ok: false, kind: 'image', used: 40, limit: 40, requested: 2, freesAt: null, message: 'over the allowance' }
      },
    })) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(ran).toBe(false)
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toBe('over the allowance')
    expect(logged).toEqual([expect.objectContaining({ status: 'forbidden', errorCategory: 'claude_allowance' })])
  })

  test('under the allowance the tool runs; an admin is passed as exempt', async () => {
    let ran = false
    const seen: boolean[] = []
    const handlers = {
      ...TOOL_HANDLERS,
      grade_image: {
        run: async () => {
          ran = true
          return { content: [{ type: 'text' as const, text: 'graded' }] }
        },
      },
    }
    const res = (await dispatch(call('grade_image', { product: 'eclipse', output_id: '00000000-0000-4000-8000-000000000000' }), { ...person, ownerRole: 'admin' }, {
      handlers,
      recordUsage: async () => undefined,
      checkAllowance: async (input) => {
        seen.push(input.isAdmin)
        return { ok: true }
      },
    })) as { result: { content: Array<{ text: string }> } }
    expect(ran).toBe(true)
    expect(seen).toEqual([true])
    expect(res.result.content[0].text).toBe('graded')
  })

  test('a free tool is never checked', async () => {
    const handlers = { ...TOOL_HANDLERS, list_models: { run: async () => ({ content: [{ type: 'text' as const, text: 'models' }] }) } }
    await dispatch(call('list_models', {}), person, {
      handlers,
      recordUsage: async () => undefined,
      checkAllowance: async () => {
        throw new Error('should not be checked')
      },
    })
  })

  test('a check that cannot read usage is a plain tool result, not a thrown error, and nothing runs', async () => {
    let ran = false
    const handlers = {
      ...TOOL_HANDLERS,
      cmf_render: {
        run: async () => {
          ran = true
          return { content: [] }
        },
      },
    }
    const res = (await dispatch(call('cmf_render', { tab: 't', column: 'B', clown: 'k' }), person, {
      handlers,
      recordUsage: async () => undefined,
      checkAllowance: async () => {
        throw new Error('database unavailable')
      },
    })) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(ran).toBe(false)
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toContain('could not check your daily allowance')
  })
})

/**
 * One allowance per person across both doors (owner, 2026-09-30): a CMF render costs the same
 * whether Claude or the CMF Studio asks, so the web's renders count with Claude's, and each door
 * sees the other's.
 */
test.describe('one allowance across Claude and the CMF Studio', () => {
  test.afterEach(() => setCmfServiceDeps(null))

  /** A Prisma JSON-path filter, evaluated on a record in hand: what COUNTED_IMAGES asks the database. */
  function matches(where: Record<string, any>, parameters: Record<string, unknown>): boolean {
    if (Array.isArray(where.AND)) return where.AND.every((w: Record<string, any>) => matches(w, parameters))
    const f = where.parameters as { path: string[]; equals: unknown }
    return f.path.reduce<any>((v, k) => (v && typeof v === 'object' ? v[k] : undefined), parameters) === f.equals
  }

  test("the counter takes Claude's draws and the CMF Studio's renders, and nothing else the web makes", async () => {
    const w = await serviceWorld()
    setCmfServiceDeps(w.deps)
    for (const door of ['mcp', 'web'] as const) {
      const who = actor(DAMIEN, door)
      const ready = await planRender(who, { import_id: IMPORT, tab: 'Experience 2 CC', sku_column: 'E', clown: KEY_ID }, ENV)
      await runRender(who, ready, { jobId: null }, ENV)
    }
    const records = [
      ...w.team.generations.map((g) => ({ modelId: g.modelId, parameters: g.parameters })),
      // A web generation of the rest of the app, and Claude's packaging mockup (built in code).
      { modelId: 'gemini-nano-banana-pro', parameters: { aspectRatio: '1:1' } },
      { modelId: 'gemini-nano-banana-pro', parameters: { source: 'web', toolName: 'generate_asset' } },
      { modelId: 'none', parameters: { source: 'mcp', toolName: 'packaging_mockup' } },
    ]
    expect(records.map((r) => imageDoorOf(r))).toEqual(['mcp', 'web', null, null, null])
    // The database filter takes the same records under the same door.
    for (const r of records) {
      const hit = COUNTED_IMAGES.filter((c) => r.modelId !== 'none' && matches(c.where as Record<string, any>, r.parameters as Record<string, unknown>)).map((c) => c.door)
      expect(hit, JSON.stringify(r.parameters)).toEqual(imageDoorOf(r) ? [imageDoorOf(r)] : [])
    }
  })

  test("a render in the CMF Studio is refused on Claude's draws, and a Claude call on the Studio's renders", async () => {
    const mixed: CountedWork[] = [
      ...images(30).map((x) => ({ ...x, door: 'mcp' as const })),
      ...images(10, 12).map((x) => ({ ...x, door: 'web' as const })),
    ]
    for (const door of ['web', 'mcp'] as const) {
      const res = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 1 }, env: ENV, now: NOW, usage: usageOf(mixed), door })
      expect(res.ok, door).toBe(false)
      if (res.ok) continue
      expect(res).toMatchObject({ kind: 'image', used: 40, limit: 40, requested: 1 })
      expect(res.message).toContain('40 of your 40 images through Claude and the CMF Studio together')
    }
    // Claude's own count, with nothing from the Studio in it, reads as it always did.
    const claudeOnly = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 1 }, env: ENV, now: NOW, usage: usageOf(images(40)) })
    expect(claudeOnly.ok).toBe(false)
    if (!claudeOnly.ok) expect(claudeOnly.message).toContain('40 of your 40 images through Claude in the last 24 hours')
    // Under the limit together, both doors go ahead.
    const under = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 4 }, env: ENV, now: NOW, usage: usageOf(mixed.slice(4)), door: 'web' })
    expect(under).toEqual({ ok: true })
  })

  test('in the CMF Studio an admin is exempt, even at 0; everyone else is refused there at 0', async () => {
    const off = envOf({ CLAUDE_DAILY_IMAGE_LIMIT: '0' })
    expect(await checkClaudeAllowance({ ownerId: 'admin', isAdmin: true, need: { kind: 'image', units: 4 }, env: off, now: NOW, usage: never, door: 'web' })).toEqual({ ok: true })
    const maker = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'image', units: 1 }, env: off, now: NOW, usage: never, door: 'web' })
    expect(maker.ok).toBe(false)
    if (!maker.ok) expect(maker.message).toBe('Rendering in the CMF Studio is switched off on this Vesper right now. Nothing was made or paid for. Ask a Vesper admin if you need it.')
    // Through Claude the switch still stops admins: the shared organisation token is an admin's.
    const claude = await checkClaudeAllowance({ ownerId: 'admin', isAdmin: true, need: { kind: 'image', units: 1 }, env: off, now: NOW, usage: never })
    expect(claude.ok).toBe(false)
    // A web grade counts against the same reads.
    const reads = Array.from({ length: 40 }, (_, i) => ({ at: ago(1 + i * 0.5), units: 3, door: i % 2 ? ('web' as const) : ('mcp' as const) }))
    const grade = await checkClaudeAllowance({ ownerId: 'p', isAdmin: false, need: { kind: 'grade', units: 3 }, env: ENV, now: NOW, usage: usageOf(reads), door: 'web' })
    expect(grade.ok).toBe(false)
    if (!grade.ok) expect(grade.message).toContain('120 of your 120 grading reads through Claude and the CMF Studio together')
  })
})
