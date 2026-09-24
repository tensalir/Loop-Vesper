import { test, expect } from '@playwright/test'
import {
  asJobPayload,
  isStale,
  runWithBudget,
  stripAsync,
  syncBudgetMs,
  DEFAULT_SYNC_BUDGET_MS,
  STALE_PROCESSING_MS,
  type JobPayload,
} from '../src/lib/headless/jobs'
import { runLongCall } from '../src/lib/headless/tools/long-call'
import { executeQueuedJob } from '../src/lib/headless/tools/job-runner'
import { McpProgressReporter } from '../src/lib/headless/mcp-progress'
import type { ToolContext, UsageEntry } from '../src/lib/headless/tools/types'
import { MemoryJobStore, collectingWaitUntil } from './helpers/memory-job-store'

/**
 * The async loop this replaces: `generate_asset` with `async: true` stored
 * its arguments with the flag on, and every poll ran the tool entry again,
 * which queued another job. These tests pin the new contract: a job is run
 * once, by its work function, from a request that cannot queue itself.
 */

const payload = (n = 1): JobPayload => ({
  summary: `done ${n}`,
  structuredContent: { outputs: [{ url: 'https://example.supabase.co/x.png' }], durationMs: 5 },
  outputIds: ['out-1'],
  costUsd: 0.134,
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test.describe('stripAsync / syncBudgetMs', () => {
  test('removes only the async switch', () => {
    expect(stripAsync({ prompt: 'x', async: true, modelId: 'm' })).toEqual({ prompt: 'x', modelId: 'm' })
  })

  test('budget: default 50 s, env override, 0 when async', () => {
    expect(syncBudgetMs({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SYNC_BUDGET_MS)
    expect(syncBudgetMs({ MCP_SYNC_BUDGET_MS: '1200' } as unknown as NodeJS.ProcessEnv)).toBe(1200)
    expect(syncBudgetMs({ MCP_SYNC_BUDGET_MS: 'nonsense' } as unknown as NodeJS.ProcessEnv)).toBe(DEFAULT_SYNC_BUDGET_MS)
    expect(syncBudgetMs({ MCP_SYNC_BUDGET_MS: '1200' } as unknown as NodeJS.ProcessEnv, true)).toBe(0)
  })
})

test.describe('runWithBudget', () => {
  test('the stored request has no async flag and the job starts as processing', async () => {
    const store = new MemoryJobStore()
    const wu = collectingWaitUntil()
    const out = await runWithBudget({
      store,
      waitUntil: wu.waitUntil,
      credentialId: 'cred-1',
      ownerId: 'owner-1',
      toolName: 'generate_asset',
      modelId: 'm',
      request: { prompt: 'x', async: true },
      budgetMs: 1000,
      work: async () => 'ok',
      toPayload: () => payload(),
    })
    expect(out.kind).toBe('inline')
    const row = store.rows.get(out.jobId)!
    expect(row.request).toEqual({ prompt: 'x' })
    expect(row.status).toBe('completed')
  })

  test('fast work comes back inline, run exactly once', async () => {
    const store = new MemoryJobStore()
    let calls = 0
    const out = await runWithBudget({
      store,
      waitUntil: collectingWaitUntil().waitUntil,
      credentialId: 'c',
      ownerId: 'o',
      toolName: 't',
      modelId: 'm',
      request: {},
      budgetMs: 500,
      work: async (jobId) => {
        calls++
        return jobId
      },
      toPayload: () => payload(),
    })
    expect(out.kind).toBe('inline')
    if (out.kind === 'inline') expect(out.result).toBe(out.jobId)
    expect(calls).toBe(1)
  })

  test('slow work hands back the job id, then completes in the store', async () => {
    const store = new MemoryJobStore()
    const wu = collectingWaitUntil()
    const background: string[] = []
    const out = await runWithBudget({
      store,
      waitUntil: wu.waitUntil,
      credentialId: 'c',
      ownerId: 'o',
      toolName: 't',
      modelId: 'm',
      request: {},
      budgetMs: 20,
      work: async () => {
        await sleep(80)
        return 'late'
      },
      toPayload: () => payload(2),
      onBackgroundDone: (r) => {
        background.push(r)
      },
    })
    expect(out.kind).toBe('handoff')
    expect(store.rows.get(out.jobId)!.status).toBe('processing')
    await wu.settle()
    await sleep(5)
    expect(store.rows.get(out.jobId)!.status).toBe('completed')
    expect(asJobPayload(store.rows.get(out.jobId)!.result)?.summary).toBe('done 2')
    // The spend of a handed-off job is logged when it finishes.
    expect(background).toEqual(['late'])
  })

  test('async (budget 0) returns the job at once', async () => {
    const store = new MemoryJobStore()
    const wu = collectingWaitUntil()
    const out = await runWithBudget({
      store,
      waitUntil: wu.waitUntil,
      credentialId: 'c',
      ownerId: 'o',
      toolName: 't',
      modelId: 'm',
      request: { async: true },
      budgetMs: 0,
      work: async () => {
        await sleep(10)
        return 1
      },
      toPayload: () => payload(),
    })
    expect(out.kind).toBe('handoff')
    await wu.settle()
    expect(store.rows.get(out.jobId)!.status).toBe('completed')
  })

  test('a failure within the budget is thrown and the job is failed', async () => {
    const store = new MemoryJobStore()
    await expect(
      runWithBudget({
        store,
        waitUntil: collectingWaitUntil().waitUntil,
        credentialId: 'c',
        ownerId: 'o',
        toolName: 't',
        modelId: 'm',
        request: {},
        budgetMs: 500,
        work: async () => {
          throw new Error('provider said no')
        },
        toPayload: () => payload(),
      })
    ).rejects.toThrow('provider said no')
    const row = Array.from(store.rows.values())[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe('provider said no')
  })
})

test.describe('stored results', () => {
  test('a payload holds no image bytes', () => {
    const text = JSON.stringify(payload())
    expect(text).not.toContain('data:image')
    expect(text).not.toContain('base64')
  })

  test('asJobPayload reads payloads and refuses the old full-result rows', () => {
    expect(asJobPayload(payload())?.outputIds).toEqual(['out-1'])
    expect(asJobPayload({ content: [{ type: 'image', data: 'AAAA' }], structuredContent: {} })).toBeNull()
    expect(asJobPayload(null)).toBeNull()
  })

  test('a processing job past six minutes is stale; others are not', () => {
    const now = Date.now()
    const old = new Date(now - STALE_PROCESSING_MS - 1000)
    expect(isStale({ status: 'processing', startedAt: old, updatedAt: old }, now)).toBe(true)
    expect(isStale({ status: 'processing', startedAt: new Date(now), updatedAt: old }, now)).toBe(false)
    expect(isStale({ status: 'completed', startedAt: old, updatedAt: old }, now)).toBe(false)
    expect(isStale({ status: 'processing', startedAt: null, updatedAt: old }, now)).toBe(true)
  })

  test('the sweeper contract: failStale fails only old processing rows', async () => {
    const store = new MemoryJobStore()
    const old = new Date(Date.now() - STALE_PROCESSING_MS - 1000)
    store.seed({ id: 'a', status: 'processing', toolName: 't', request: {}, startedAt: old })
    store.seed({ id: 'b', status: 'processing', toolName: 't', request: {}, startedAt: new Date() })
    const n = await store.failStale(new Date(Date.now() - STALE_PROCESSING_MS), 'lost')
    expect(n).toBe(1)
    expect(store.rows.get('a')!.status).toBe('failed')
    expect(store.rows.get('b')!.status).toBe('processing')
  })
})

test.describe('executeQueuedJob (rows left by the old code)', () => {
  test('runs the work function once on the request without async, never the tool entry', async () => {
    const store = new MemoryJobStore()
    const job = store.seed({
      id: 'q1',
      status: 'queued',
      toolName: 'generate_asset',
      request: { prompt: 'x', modelId: 'gemini-nano-banana-pro', async: true },
    })
    const seen: Array<Record<string, unknown>> = []
    const usage: UsageEntry[] = []
    const after = await executeQueuedJob(job, {
      store,
      recordUsage: async (_j, e) => {
        usage.push(e)
      },
      loadCredential: async () => ({ allowedModels: ['*'], revokedAt: null }),
      executors: {
        generate_asset: async (request) => {
          seen.push(request)
          return payload()
        },
      },
    })
    expect(seen).toEqual([{ prompt: 'x', modelId: 'gemini-nano-banana-pro' }])
    expect(after.status).toBe('completed')
    expect(after.attempts).toBe(1)
    expect(usage[0].costUsd).toBe(0.134)

    // A second run finds nothing to claim.
    const again = await executeQueuedJob(after, {
      store,
      recordUsage: async () => undefined,
      executors: { generate_asset: async () => { throw new Error('must not run') } },
    })
    expect(again.status).toBe('completed')
  })

  test('a revoked credential fails the job instead of running it', async () => {
    const store = new MemoryJobStore()
    const job = store.seed({ id: 'q2', status: 'queued', toolName: 'generate_asset', request: {} })
    const after = await executeQueuedJob(job, {
      store,
      recordUsage: async () => undefined,
      loadCredential: async () => ({ allowedModels: ['*'], revokedAt: new Date() }),
      executors: { generate_asset: async () => payload() },
    })
    expect(after.status).toBe('failed')
    expect(after.error).toContain('revoked')
  })
})

function ctxFor(tools: string[], store: MemoryJobStore, waitUntil: (p: Promise<unknown>) => void): ToolContext {
  return {
    principal: {
      credentialId: 'c',
      ownerId: 'o',
      allowedTools: tools as ToolContext['principal']['allowedTools'],
      allowedModels: ['*'],
    },
    progress: new McpProgressReporter(),
    jobs: { store, waitUntil },
    recordBackgroundUsage: async () => undefined,
    env: { MCP_SYNC_BUDGET_MS: '20' } as unknown as NodeJS.ProcessEnv,
  }
}

test.describe('runLongCall', () => {
  test('a caller that cannot poll waits to the end and gets no job', async () => {
    const store = new MemoryJobStore()
    const res = await runLongCall({
      ctx: ctxFor(['generate_asset'], store, () => undefined),
      toolName: 'generate_asset',
      modelId: 'm',
      request: { async: true },
      runAsync: true,
      what: 'the image',
      execute: async (jobId) => {
        await sleep(50)
        return jobId
      },
      toPayload: () => payload(),
      toWire: async (r) => ({ content: [{ type: 'text', text: `inline ${r}` }], structuredContent: {} }),
    })
    expect(store.rows.size).toBe(0)
    expect(res.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ')).toContain('inline null')
    expect(res.costUsd).toBe(0.134)
  })

  test('a caller that can poll gets a job id past the budget, and no cost is logged yet', async () => {
    const store = new MemoryJobStore()
    const wu = collectingWaitUntil()
    const res = await runLongCall({
      ctx: ctxFor(['generate_asset', 'get_generation_status'], store, wu.waitUntil),
      toolName: 'generate_asset',
      modelId: 'm',
      request: {},
      runAsync: false,
      what: 'the image',
      execute: async () => {
        await sleep(80)
        return 'x'
      },
      toPayload: () => payload(),
      toWire: async () => ({ content: [], structuredContent: {} }),
    })
    const structured = res.structuredContent as { jobId: string; status: string }
    expect(structured.status).toBe('processing')
    expect(res.costUsd).toBeNull()
    await wu.settle()
    expect(store.rows.get(structured.jobId)!.status).toBe('completed')
  })
})
