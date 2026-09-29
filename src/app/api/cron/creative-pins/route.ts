import { NextRequest, NextResponse } from 'next/server'
import { getCreativeKit, getProductKit } from '@/lib/creative/kit-runtime'
import { kitSetPins, loadKitSet } from '@/lib/creative/kit-set'
import { syncPins } from '@/lib/creative/pins'
import { productionPinDeps } from '@/lib/creative/pins-runtime'
import { githubAppConfigFromEnv } from '@/lib/github/app'

/**
 * GET /api/cron/creative-pins — daily (vercel.json).
 *
 * Reads both kits again (the creative kit, and the product kit whose CMF
 * clowns are pinned too), pins what is new, and renews each Gemini upload that
 * lapses within a day, so a grade or a draw never uploads a pin itself. Does
 * nothing, and says so, while Vesper's GitHub App is not configured.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BUDGET_MS = 240_000

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!githubAppConfigFromEnv()) {
    return NextResponse.json({ skipped: 'the GitHub App is not configured, so there is no kit to pin' })
  }
  try {
    const set = await loadKitSet({ studio: () => getCreativeKit({ force: true }), product: () => getProductKit({ force: true }) })
    const results = await syncPins(kitSetPins(set), productionPinDeps(), { budgetMs: BUDGET_MS })
    const counts: Record<string, number> = {}
    for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
    return NextResponse.json({
      kit: set.studio?.kit.version ?? null,
      stale: set.studio?.stale ?? null,
      product_kit: set.product?.kit.version ?? null,
      product_stale: set.product?.stale ?? null,
      ...(set.studioError ? { kit_error: set.studioError.message } : {}),
      ...(set.productError ? { product_kit_error: set.productError.message } : {}),
      counts,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
