import { NextRequest, NextResponse } from 'next/server'
import { recordHeadlessUsage } from '@/lib/headless/auth'
import { prismaJobStore } from '@/lib/headless/mcp-jobs'
import { QUEUED_PICKUP_MS, STALE_MESSAGE, STALE_PROCESSING_MS } from '@/lib/headless/jobs'
import { executeQueuedJob } from '@/lib/headless/tools/job-runner'

/**
 * GET /api/cron/mcp-jobs — every minute (vercel.json).
 *
 * - A job still `processing` six minutes after it started has lost its
 *   worker (the function hit its limit or crashed): mark it failed so the
 *   caller is told to run it again instead of polling forever.
 * - A job `queued` for over a minute is run here, once. Only rows written
 *   before jobs ran themselves are queued; polling still runs them too, so
 *   nothing depends on this cron being on.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_QUEUED_PER_RUN = 3
const RUN_BUDGET_MS = 200_000

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const failed = await prismaJobStore.failStale(new Date(started - STALE_PROCESSING_MS), STALE_MESSAGE)

  const queued = await prismaJobStore.listQueued(new Date(started - QUEUED_PICKUP_MS), MAX_QUEUED_PER_RUN)
  const ran: Array<{ id: string; status: string }> = []
  for (const job of queued) {
    if (Date.now() - started > RUN_BUDGET_MS) break
    const after = await executeQueuedJob(job, {
      store: prismaJobStore,
      recordUsage: (j, entry) =>
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
        }),
    })
    ran.push({ id: after.id, status: after.status })
  }

  return NextResponse.json({ failedStale: failed, ran })
}
