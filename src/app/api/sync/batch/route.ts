/**
 * Sync batch route: run Monday batch ingest, Figma linked-file ingest, Frontify canonical approved ingest,
 * and optional matcher. Test runbook: POST with steps monday,figma,frontify,matcher then GET /api/admin/sync/status for metrics.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { runMondayBatchIngest } from '@/lib/sync/mondayBatchIngest'
import { runFigmaBatchIngest } from '@/lib/sync/figmaBatchIngest'
import { runFrontifyApprovalIngest } from '@/lib/sync/frontifyApprovalIngest'
import { runMatcher } from '@/lib/sync/matcher'

export const dynamic = 'force-dynamic'

type Step = 'monday' | 'figma' | 'frontify' | 'matcher'

function parseSteps(stepsParam: string | null): Step[] {
  if (!stepsParam) return ['monday', 'figma', 'frontify', 'matcher']
  const want = stepsParam.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  const allowed: Step[] = ['monday', 'figma', 'frontify', 'matcher']
  return want.filter((s) => allowed.includes(s as Step)) as Step[]
}

/**
 * POST /api/sync/batch
 * Body (optional): { steps?: string, frontifyTags?: string[], limit?: number }
 * - steps: comma-separated (monday, figma, frontify, matcher); default all.
 * - frontifyTags: for Frontify approval ingest (e.g. ["approved", "January"]); default ["approved"].
 * - limit: max items for Monday/Frontify; default 500.
 */
export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { steps?: string; frontifyTags?: string[]; limit?: number } = {}
  try {
    body = await request.json().catch(() => ({}))
  } catch {
    body = {}
  }

  const steps = parseSteps(body.steps ?? null)
  const frontifyTags = Array.isArray(body.frontifyTags) ? body.frontifyTags : ['approved']
  const limit = typeof body.limit === 'number' ? Math.min(body.limit, 2000) : 500

  const result: {
    monday?: Awaited<ReturnType<typeof runMondayBatchIngest>>
    figma?: Awaited<ReturnType<typeof runFigmaBatchIngest>>
    frontify?: Awaited<ReturnType<typeof runFrontifyApprovalIngest>>
    matcher?: Awaited<ReturnType<typeof runMatcher>>
  } = {}

  try {
    if (steps.includes('monday')) {
      result.monday = await runMondayBatchIngest({ pageSize: 100, maxItems: limit })
    }
    if (steps.includes('figma')) {
      result.figma = await runFigmaBatchIngest({ fileKeyLimit: limit })
    }
    if (steps.includes('frontify')) {
      result.frontify = await runFrontifyApprovalIngest({
        limit,
        approvedTags: frontifyTags,
        triggerSigilIngest: false,
      })
    }
    if (steps.includes('matcher')) {
      result.matcher = await runMatcher()
    }
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    console.error('[sync/batch]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Batch sync failed', result },
      { status: 500 }
    )
  }
}
