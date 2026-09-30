import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthenticatedProfile } from '@/lib/cmf/service'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/clowns: GET lists the clown library the old way made, read only. POST (replacing a clown
 * and its legend) is retired for CMF on 2026-09-30: every CMF step now goes through the CMF service
 * at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts says where each step went). A
 * retired method answers 410 with one line naming the new step.
 */
export const dynamic = 'force-dynamic'

/**
 * GET /api/cmf/clowns?productSlug=
 *
 * Returns the shared clown library for the workspace, optionally filtered
 * to a single product. Auth-gated to keep the asset URLs out of unindexed
 * crawlers but otherwise unscoped.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const url = new URL(request.url)
  const productSlug = url.searchParams.get('productSlug') || undefined

  const assets = await prisma.cmfClownAsset.findMany({
    where: productSlug ? { productSlug: productSlug.toLowerCase() } : undefined,
    orderBy: [{ productSlug: 'asc' }, { variantSlug: 'asc' }, { label: 'asc' }],
  })

  return NextResponse.json({ assets })
}

export function POST() {
  return retired('clowns')
}
