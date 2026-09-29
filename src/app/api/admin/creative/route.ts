import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { getCreativeKit, getProductKit } from '@/lib/creative/kit-runtime'
import type { LoadedKit } from '@/lib/creative/kit'
import type { AnyKit, ProductKit } from '@/lib/creative/kit-schema'
import { kitSetPins, servedView } from '@/lib/creative/kit-set'
import { pinHealth } from '@/lib/creative/pins'
import { prismaPinStore } from '@/lib/creative/pins-runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/creative — the kits Vesper is running on (the creative kit,
 * and the product kit CMF comes from), and the state of every pinned reference
 * they name.
 * POST /api/admin/creative { "action": "refresh" } — read both kits again now.
 */

function kitStatus(loaded: LoadedKit<AnyKit>) {
  return {
    version: loaded.kit.version,
    tag: loaded.kit.tag,
    ref: loaded.ref,
    commit: loaded.commit,
    blobSha: loaded.blobSha,
    fetchedAt: loaded.fetchedAt.toISOString(),
    stale: loaded.stale,
    staleReason: loaded.staleReason,
    products: Object.fromEntries(Object.entries(loaded.kit.products).map(([slug, p]) => [slug, { status: p.status, rubric: p.rubric.version }])),
  }
}

async function status(force: boolean) {
  const studio = servedView(await getCreativeKit({ force }))
  let product: LoadedKit<ProductKit> | null = null
  let productError: string | null = null
  try {
    product = servedView(await getProductKit({ force }))
  } catch (err) {
    productError = (err as Error).message
  }
  const specs = kitSetPins({ studio, product })
  const health = pinHealth(specs, await prismaPinStore.list())
  const counts: Record<string, number> = {}
  for (const h of health) counts[h.status] = (counts[h.status] ?? 0) + 1
  return {
    kit: kitStatus(studio),
    product_kit: product ? kitStatus(product) : null,
    ...(productError ? { product_kit_error: productError } : {}),
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
