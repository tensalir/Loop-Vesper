import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  logCmfActivity,
  requireAuthenticatedProfile,
  requireCmfWrite,
  requirePacketAccess,
} from '@/lib/cmf/service'
import { cmfError, translateAccessError } from '@/lib/cmf/api'

export const dynamic = 'force-dynamic'

const InviteMemberSchema = z.object({
  // The caller can identify a teammate by either their internal user UUID
  // (preferred — comes from a future "people search" API) or by their
  // username. Email-based invites would need a profile lookup that respects
  // RLS on the auth schema, which we don't ship in Layer 1.
  userId: z.string().uuid().optional(),
  username: z.string().trim().min(1).max(100).optional(),
  role: z.enum(['viewer', 'editor', 'approver']).default('editor'),
})

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

/**
 * POST /api/cmf/packets/{id}/members
 *
 * Invite a teammate. Owner-only — sharing power isn't delegated to editors
 * in Layer 1 to keep the trust boundary small. Returns the new member row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Membership is metadata only under the global-library model — we
  // keep the endpoint so the owner can record collaborators for the
  // activity drawer, but it's gated on CMF write access (admins or
  // cmfAccess users) plus the owner / admin chokepoint below.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    select: { ownerId: true },
  })
  if (!packet) {
    return cmfError('Packet not found', { status: 404 })
  }
  if (packet.ownerId !== auth.profile.userId && !auth.profile.isAdmin) {
    return cmfError(
      'Only the packet owner or an admin can record members',
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return cmfError('Invalid JSON body')
  }

  const parsed = InviteMemberSchema.safeParse(body)
  if (!parsed.success) {
    return cmfError('Invalid request body', {
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }
  if (!parsed.data.userId && !parsed.data.username) {
    return cmfError('Either userId or username is required')
  }

  // Resolve the invitee profile.
  const invitee = parsed.data.userId
    ? await prisma.profile.findUnique({
        where: { id: parsed.data.userId },
        select: { id: true, displayName: true, username: true, avatarUrl: true, deletedAt: true, pausedAt: true },
      })
    : await prisma.profile.findUnique({
        where: { username: parsed.data.username! },
        select: { id: true, displayName: true, username: true, avatarUrl: true, deletedAt: true, pausedAt: true },
      })

  if (!invitee || invitee.deletedAt) {
    return cmfError('User not found. Ask them to sign up first.', { status: 404 })
  }

  if (invitee.id === auth.profile.userId) {
    return cmfError('You already own this packet — no need to invite yourself.')
  }

  const member = await prisma.cmfPacketMember.upsert({
    where: { packetId_userId: { packetId: params.id, userId: invitee.id } },
    create: {
      packetId: params.id,
      userId: invitee.id,
      role: parsed.data.role,
      invitedBy: auth.profile.userId,
    },
    update: {
      role: parsed.data.role,
    },
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  await logCmfActivity({
    packetId: params.id,
    userId: auth.profile.userId,
    action: 'invited_member',
    targetId: invitee.id,
    metadata: { role: parsed.data.role, username: invitee.username ?? null },
  })

  return NextResponse.json({ member })
}
