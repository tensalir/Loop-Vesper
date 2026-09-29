import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { productionKitSet } from '@/lib/creative/kit-runtime'
import { kitSetPins, loadKitSet } from '@/lib/creative/kit-set'
import { syncPins } from '@/lib/creative/pins'
import { productionPinDeps } from '@/lib/creative/pins-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BUDGET_MS = 240_000

/**
 * POST /api/admin/creative/pins/sync { product?, force? } — bring every pin the
 * kits name (the creative kit's, and CMF's clowns from the product kit) to where
 * it can be used: pulled, checked against its sha256,
 * stored unchanged, previewed, uploaded to Gemini. Pins that cannot be had are
 * reported with the reason; a run that reaches the time budget says which pins
 * the next run takes.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const body = (await request.json().catch(() => ({}))) as { product?: string; force?: boolean }
  try {
    const set = await loadKitSet(productionKitSet())
    const specs = kitSetPins(set).filter((p) => !body.product || p.product === body.product)
    const results = await syncPins(specs, productionPinDeps(), { budgetMs: BUDGET_MS, force: body.force === true })
    const brief = (l: typeof set.studio | typeof set.product) => (l ? { version: l.kit.version, commit: l.commit, stale: l.stale } : null)
    return NextResponse.json({
      kit: brief(set.studio),
      product_kit: brief(set.product),
      ...(set.studioError ? { kit_error: set.studioError.message } : {}),
      ...(set.productError ? { product_kit_error: set.productError.message } : {}),
      results,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
