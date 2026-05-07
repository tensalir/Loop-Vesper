import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  CmfForbiddenError,
  CmfNotFoundError,
  requireAuthenticatedProfile,
  requirePacketAccess,
} from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * GET /api/cmf/packets/{id}/activity
 *
 * Returns the activity feed for a packet, newest first. Any role with access
 * can read — collaboration depends on everyone seeing the same timeline.
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
    if (err instanceof CmfNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof CmfForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    throw err
  }

  const limitParam = request.nextUrl.searchParams.get('limit')
  const parsedLimit = Number.parseInt(limitParam ?? '', 10)
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const items = await prisma.cmfActivity.findMany({
    where: { packetId: params.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  return NextResponse.json({ items })
}
