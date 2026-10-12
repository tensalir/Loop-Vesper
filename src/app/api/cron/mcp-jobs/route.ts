import { NextRequest, NextResponse } from 'next/server'
import { recordHeadlessUsage } from '@/lib/headless/auth'
import { prismaJobStore } from '@/lib/headless/mcp-jobs'
import { QUEUED_PICKUP_MS, STALE_MESSAGE, STALE_PROCESSING_MS } from '@/lib/headless/jobs'
import type { UsageEntry } from '@/lib/headless/tools/types'
import { executeQueuedJob } from '@/lib/headless/tools/job-runner'
import { advanceVideoJob } from '@/lib/headless/generate-video'

/**
 * GET /api/cron/mcp-jobs — every minute (vercel.json).
 *
 * - A job still `processing` six minutes after it started has lost its
 *   worker (the function hit its limit or crashed): mark it failed so the
 *   caller is told to run it again instead of polling forever.
 * - A job `queued` for over a minute is run here, once. Only rows written
 *   before jobs ran themselves are queued; polling still runs them too, so
 *   nothing depends on this cron being on.
 * - A video handed to its provider (`result.pending`) is checked here and
 *   finished once it is done, so it lands in the web app even when nobody
 *   polls for it. Such a job is stale only after 30 minutes, not six.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_QUEUED_PER_RUN = 3
const MAX_PENDING_PER_RUN = 10
const RUN_BUDGET_MS = 200_000

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const failed = await prismaJobStore.failStale(new Date(started - STALE_PROCESSING_MS), STALE_MESSAGE)

  const recordUsage = (j: { credentialId: string; ownerId: string }, entry: UsageEntry) =>
    recordHeadlessUsage({
      credentialId: j.credentialId,
      ownerId: j.ownerId,
      surface: 'mcp',
      route: '/api/cron/mcp-jobs',
      toolName: entry.toolName,
      modelId: entry.modelId,
      status: 'success',
      httpStatus: 200,
      durationMs: entry.durationMs,
      costUsd: entry.costUsd,
      metadata: entry.metadata ?? null,
    })

  const queued = await prismaJobStore.listQueued(new Date(started - QUEUED_PICKUP_MS), MAX_QUEUED_PER_RUN)
  const ran: Array<{ id: string; status: string }> = []
  for (const job of queued) {
    if (Date.now() - started > RUN_BUDGET_MS) break
    const after = await executeQueuedJob(job, { store: prismaJobStore, recordUsage })
    ran.push({ id: after.id, status: after.status })
  }

  const pending = await prismaJobStore.listPending(MAX_PENDING_PER_RUN)
  const advanced: Array<{ id: string; status: string }> = []
  for (const job of pending) {
    if (Date.now() - started > RUN_BUDGET_MS) break
    try {
      const after = await advanceVideoJob(job, { store: prismaJobStore, recordUsage })
      advanced.push({ id: after.id, status: after.status })
    } catch (err) {
      console.warn('[cron/mcp-jobs] could not advance', job.id, (err as Error)?.message)
    }
  }

  return NextResponse.json({ failedStale: failed, ran, advanced })
}
