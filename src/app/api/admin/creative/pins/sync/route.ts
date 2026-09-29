import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { getCreativeKit } from '@/lib/creative/kit-runtime'
import { kitPins, syncPins } from '@/lib/creative/pins'
import { productionPinDeps } from '@/lib/creative/pins-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BUDGET_MS = 240_000

/**
 * POST /api/admin/creative/pins/sync { product?, force? } — bring every pin the
 * kit names to where it can be used: pulled, checked against its sha256,
 * stored unchanged, previewed, uploaded to Gemini. Pins that cannot be had are
 * reported with the reason; a run that reaches the time budget says which pins
 * the next run takes.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const body = (await request.json().catch(() => ({}))) as { product?: string; force?: boolean }
  try {
    const loaded = await getCreativeKit()
    const specs = kitPins(loaded.kit).filter((p) => !body.product || p.product === body.product)
    const results = await syncPins(specs, productionPinDeps(), { budgetMs: BUDGET_MS, force: body.force === true })
    return NextResponse.json({ kit: { version: loaded.kit.version, commit: loaded.commit, stale: loaded.stale }, results })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
