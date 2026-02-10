/**
 * Sync replay: run reconciliation and/or projections.
 * POST body: { action: 'reconcile' | 'project' | 'both', linkId?: string, fileKey?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { reconcileFigmaFileComments, reconcileAllFigmaFiles } from '@/lib/sync/reconcile'
import { runProjectionsForLink, runAllFigmaToMondayProjections } from '@/lib/sync/projections'

export const dynamic = 'force-dynamic'

type Action = 'reconcile' | 'project' | 'both'

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: Action; linkId?: string; fileKey?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const action: Action = body.action ?? 'both'
  const linkId = body.linkId
  const fileKey = body.fileKey

  try {
    const reconcileResults: Array<{ fileKey: string; inserted: number; skipped: number }> = []
    const projectionResults: Array<{ linkId: string; direction: string; projected: number }> = []

    if (action === 'reconcile' || action === 'both') {
      if (fileKey) {
        const r = await reconcileFigmaFileComments(fileKey)
        reconcileResults.push({
          fileKey: r.fileKey,
          inserted: r.resolveEventsInserted,
          skipped: r.resolveEventsSkipped,
        })
      } else {
        const all = await reconcileAllFigmaFiles({ limit: 50 })
        reconcileResults.push(
          ...all.map((r) => ({
            fileKey: r.fileKey,
            inserted: r.resolveEventsInserted,
            skipped: r.resolveEventsSkipped,
          }))
        )
      }
    }

    if (action === 'project' || action === 'both') {
      if (linkId) {
        const results = await runProjectionsForLink(linkId)
        projectionResults.push(
          ...results.map((r) => ({
            linkId: r.linkId,
            direction: r.direction,
            projected: r.projected,
            errors: r.errors,
          }))
        )
      } else {
        const results = await runAllFigmaToMondayProjections({ limit: 50 })
        projectionResults.push(
          ...results.map((r) => ({
            linkId: r.linkId,
            direction: r.direction,
            projected: r.projected,
            errors: r.errors,
          }))
        )
      }
    }

    return NextResponse.json({
      action,
      reconcile: reconcileResults,
      projections: projectionResults,
    })
  } catch (e) {
    console.error('[Sync Replay] Error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Replay failed' },
      { status: 500 }
    )
  }
}
