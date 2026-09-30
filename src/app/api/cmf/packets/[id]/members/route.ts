import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthenticatedProfile, requirePacketAccess } from '@/lib/cmf/service'
import { cmfError, translateAccessError } from '@/lib/cmf/api'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/packets/{id}/members: GET reads a packet's members, read only. POST is retired for CMF
 * on 2026-09-30: every CMF step now goes through the CMF service at /api/cmf/v2, as Claude's tools
 * do (src/lib/cmf/retired.ts says where each step went). A retired method answers 410 with one line
 * naming the new step.
 */
export const dynamic = 'force-dynamic'

/**
 * GET /api/cmf/packets/{id}/members
 *
 * List the packet's members alongside the owner. Anyone with access (any
 * role) can see who else is on the packet — that transparency is the whole
 * point of collaboration.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  let access
  try {
    access = await requirePacketAccess({
      packetId: params.id,
      userId: auth.profile.userId,
    })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      ownerId: true,
      owner: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
      members: {
        orderBy: { invitedAt: 'asc' },
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  })

  if (!packet) {
    return cmfError('Packet not found', { status: 404 })
  }

  return NextResponse.json({
    role: access.role,
    owner: packet.owner,
    members: packet.members.map((m) => ({
      id: m.id,
      role: m.role,
      invitedAt: m.invitedAt,
      acceptedAt: m.acceptedAt,
      user: m.user,
    })),
  })
}

export function POST() {
  return retired('history')
}
