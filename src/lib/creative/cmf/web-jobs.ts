/**
 * The web CMF Studio's long calls: a render is planned and refused in the request, then drawn after
 * the response, and the page polls its job (`cmf_web_jobs`).
 *
 * Why it is here (2026-09-30): a CMF render draws for up to about 280 s, longer than a page should
 * wait on one request. Claude's long calls already work this way (`src/lib/headless/jobs.ts`): the
 * job is written as `processing` before the work starts, the work is handed to `waitUntil` so it
 * finishes after the response, and a `processing` job older than STALE_PROCESSING_MS has lost its
 * worker. The web follows that pattern with a table of its own, because a `headless_mcp_jobs` row
 * needs the MCP credential the web does not have. The store and `waitUntil` are injected, so the
 * door is tested without a database or a Vercel runtime.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { isStale, STALE_MESSAGE, STALE_PROCESSING_MS, type WaitUntil } from '@/lib/headless/jobs'

export type CmfWebJobStatus = 'processing' | 'completed' | 'failed'

export interface CmfWebJob {
  id: string
  ownerId: string
  toolName: string
  status: CmfWebJobStatus
  request: Record<string, unknown>
  result: Record<string, unknown> | null
  error: string | null
  outputIds: string[]
  startedAt: Date
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

export interface CmfWebJobStore {
  /** Written as `processing`: the work starts at once. */
  create(input: { ownerId: string; toolName: string; request: Record<string, unknown> }): Promise<{ id: string }>
  complete(id: string, result: Record<string, unknown>, outputIds: string[]): Promise<void>
  fail(id: string, message: string): Promise<void>
  /** A job of this owner's, or null. */
  get(id: string, ownerId: string): Promise<CmfWebJob | null>
  /** This owner's jobs of a tool still running (not stale) since a time: what the allowance counts in flight. */
  running(input: { ownerId: string; toolName: string; since: Date; now: Date }): Promise<CmfWebJob[]>
}

function mapJob(row: {
  id: string
  ownerId: string
  toolName: string
  status: string
  request: unknown
  result: unknown
  error: string | null
  outputIds: string[]
  startedAt: Date
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}): CmfWebJob {
  return {
    ...row,
    status: row.status as CmfWebJobStatus,
    request: (row.request as Record<string, unknown>) ?? {},
    result: (row.result as Record<string, unknown> | null) ?? null,
  }
}

export const prismaCmfWebJobStore: CmfWebJobStore = {
  async create(input) {
    const row = await prisma.cmfWebJob.create({
      data: { id: randomUUID(), ownerId: input.ownerId, toolName: input.toolName, status: 'processing', request: input.request as object },
      select: { id: true },
    })
    return { id: row.id }
  },
  async complete(id, result, outputIds) {
    await prisma.cmfWebJob.update({ where: { id }, data: { status: 'completed', result: result as object, outputIds, error: null, completedAt: new Date() } })
  },
  async fail(id, message) {
    await prisma.cmfWebJob.update({ where: { id }, data: { status: 'failed', error: message, completedAt: new Date() } })
  },
  async get(id, ownerId) {
    const row = await prisma.cmfWebJob.findFirst({ where: { id, ownerId } })
    return row ? mapJob(row) : null
  },
  async running({ ownerId, toolName, since, now }) {
    const rows = await prisma.cmfWebJob.findMany({
      where: { ownerId, toolName, status: 'processing', createdAt: { gte: since }, startedAt: { gte: new Date(now.getTime() - STALE_PROCESSING_MS) } },
    })
    return rows.map(mapJob)
  },
}

/**
 * Starts the work as a job and returns its id at once; the work finishes under `waitUntil` and
 * writes its result (or its error) to the job.
 */
export async function startWebJob<T>(input: {
  store: CmfWebJobStore
  waitUntil: WaitUntil
  ownerId: string
  toolName: string
  request: Record<string, unknown>
  work: (jobId: string) => Promise<T>
  toResult: (result: T) => { result: Record<string, unknown>; outputIds: string[] }
}): Promise<{ jobId: string }> {
  const job = await input.store.create({ ownerId: input.ownerId, toolName: input.toolName, request: input.request })
  const settled = input
    .work(job.id)
    .then(async (value) => {
      const { result, outputIds } = input.toResult(value)
      await input.store.complete(job.id, result, outputIds)
    })
    .catch(async (err: unknown) => {
      await input.store.fail(job.id, (err as Error)?.message || 'The render failed.').catch(() => undefined)
    })
  input.waitUntil(settled)
  return { jobId: job.id }
}

/** A job as the page reads it: a `processing` job whose worker is lost is said to be failed. */
export function jobView(job: CmfWebJob, now = Date.now()): { job_id: string; status: CmfWebJobStatus; result: Record<string, unknown> | null; error: string | null; started_at: string; completed_at: string | null } {
  const lost = isStale({ status: job.status, startedAt: job.startedAt, updatedAt: job.updatedAt }, now)
  return {
    job_id: job.id,
    status: lost ? 'failed' : job.status,
    result: job.result,
    error: lost ? STALE_MESSAGE : job.error,
    started_at: job.startedAt.toISOString(),
    completed_at: job.completedAt ? job.completedAt.toISOString() : null,
  }
}
