import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api/auth'
import { parseSnippets, type ProductUpdate } from '@/lib/updates/types'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/**
 * GET /api/updates
 *
 * Returns the published update timeline (newest first), joined with the
 * current user's seen state so the Updates page can mark already-read
 * entries. Supports keyset pagination via the `cursor` query param.
 */
export const GET = withAuth(async (user, request: NextRequest) => {
  const url = new URL(request.url)
  const limitParam = Number(url.searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT
  const cursor = url.searchParams.get('cursor')

  const rows = await prisma.productUpdate.findMany({
    where: {
      isPublished: true,
      ...(cursor
        ? { publishedAt: { lt: new Date(cursor) } }
        : {}),
    },
    orderBy: { publishedAt: 'desc' },
    take: limit + 1,
    include: {
      views: {
        where: { userId: user.id },
        select: { id: true },
      },
    },
  })

  const hasMore = rows.length > limit
  const sliced = hasMore ? rows.slice(0, limit) : rows
  const items: ProductUpdate[] = sliced.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    snippets: parseSnippets(row.snippets),
    publishedAt: row.publishedAt.toISOString(),
    seen: row.views.length > 0,
    significanceScore: row.significanceScore ? Number(row.significanceScore) : null,
    source: (row.source as ProductUpdate['source']) ?? 'manual',
    backfilled: row.backfilled,
  }))

  const nextCursor = hasMore ? sliced[sliced.length - 1].publishedAt.toISOString() : null

  return NextResponse.json({ items, nextCursor })
})
