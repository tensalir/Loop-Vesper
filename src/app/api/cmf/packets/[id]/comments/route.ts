import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthenticatedProfile, requirePacketAccess } from '@/lib/cmf/service'
import { translateAccessError } from '@/lib/cmf/api'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/packets/{id}/comments: GET reads a packet's comments, read only. POST is retired for CMF
 * on 2026-09-30: every CMF step now goes through the CMF service at /api/cmf/v2, as Claude's tools
 * do (src/lib/cmf/retired.ts says where each step went). A retired method answers 410 with one line
 * naming the new step.
 */
export const dynamic = 'force-dynamic'

/**
 * GET /api/cmf/packets/{id}/comments?renderId=
 *
 * Returns all comments scoped to a packet (or to a single SKU row when
 * `renderId` is set). Sorted oldest-first so threads render top-to-bottom.
 * Any role with access can read.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    await requirePacketAccess({
      packetId: params.id,
      userId: auth.profile.userId,
    })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  const renderId = request.nextUrl.searchParams.get('renderId')
  const includeResolved = request.nextUrl.searchParams.get('includeResolved') !== 'false'

  const comments = await prisma.cmfComment.findMany({
    where: {
      packetId: params.id,
      ...(renderId ? { renderId } : {}),
      ...(includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
      resolvedByUser: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  return NextResponse.json({ comments })
}

export function POST() {
  return retired('history')
}
