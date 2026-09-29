import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { getCreativeKit } from '@/lib/creative/kit-runtime'
import { kitPins, pinHealth } from '@/lib/creative/pins'
import { prismaPinStore } from '@/lib/creative/pins-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/creative — the creative kit Vesper is running on, and the
 * state of every pinned reference it names.
 * POST /api/admin/creative { "action": "refresh" } — read the kit again now.
 */

async function status(force: boolean) {
  const loaded = await getCreativeKit({ force })
  const specs = kitPins(loaded.kit)
  const health = pinHealth(specs, await prismaPinStore.list())
  const counts: Record<string, number> = {}
  for (const h of health) counts[h.status] = (counts[h.status] ?? 0) + 1
  return {
    kit: {
      version: loaded.kit.version,
      tag: loaded.kit.tag,
      ref: loaded.ref,
      commit: loaded.commit,
      blobSha: loaded.blobSha,
      fetchedAt: loaded.fetchedAt.toISOString(),
      stale: loaded.stale,
      staleReason: loaded.staleReason,
      products: Object.fromEntries(
        Object.entries(loaded.kit.products).map(([slug, p]) => [slug, { status: p.status, rubric: p.rubric.version }])
      ),
    },
    pins: { counts, usable: health.filter((h) => h.usable).length, total: health.length, items: health },
  }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  try {
    return NextResponse.json(await status(false))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.response) return auth.response
  const body = (await request.json().catch(() => ({}))) as { action?: string }
  if (body.action !== 'refresh') {
    return NextResponse.json({ error: 'The only action is "refresh".' }, { status: 400 })
  }
  try {
    return NextResponse.json(await status(true))
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 503 })
  }
}
