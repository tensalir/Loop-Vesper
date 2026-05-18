import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withAuth } from '@/lib/api/auth'
import { parseSnippets, type ProductUpdate } from '@/lib/updates/types'

/**
 * GET /api/updates/latest-unseen
 *
 * Returns the most recent published update the current user has not yet
 * marked as seen, or `{ update: null }` when there's nothing to show.
 *
 * The popup gate calls this on every authenticated dashboard mount; keep
 * the query tight (single row, indexed on `published_at`) so it stays
 * cheap even when called frequently.
 */
export const GET = withAuth(async (user) => {
  const update = await prisma.productUpdate.findFirst({
    where: {
      isPublished: true,
      views: {
        none: { userId: user.id },
      },
    },
    orderBy: { publishedAt: 'desc' },
  })

  if (!update) {
    return NextResponse.json({ update: null })
  }

  const payload: ProductUpdate = {
    id: update.id,
    slug: update.slug,
    title: update.title,
    summary: update.summary,
    snippets: parseSnippets(update.snippets),
    publishedAt: update.publishedAt.toISOString(),
    seen: false,
    significanceScore: update.significanceScore ? Number(update.significanceScore) : null,
    source: (update.source as ProductUpdate['source']) ?? 'manual',
    backfilled: update.backfilled,
  }

  return NextResponse.json({ update: payload })
})
