import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  logCmfActivity,
  requireCmfWrite,
} from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

const UpdateMemberSchema = z.object({
  role: z.enum(['viewer', 'editor', 'approver']),
})

/**
 * PATCH /api/cmf/packets/{id}/members/{userId}
 *
 * Change a member's role. Owner-only (we never let one editor demote another).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    select: { ownerId: true },
  })
  if (!packet) {
    return NextResponse.json({ error: 'Packet not found' }, { status: 404 })
  }
  if (packet.ownerId !== auth.profile.userId && !auth.profile.isAdmin) {
    return NextResponse.json(
      { error: 'Only the packet owner or an admin can change member roles' },
      { status: 403 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateMemberSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 }
    )
  }

  const member = await prisma.cmfPacketMember.findUnique({
    where: { packetId_userId: { packetId: params.id, userId: params.userId } },
  })
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  const updated = await prisma.cmfPacketMember.update({
    where: { packetId_userId: { packetId: params.id, userId: params.userId } },
    data: { role: parsed.data.role },
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  await logCmfActivity({
    packetId: params.id,
    userId: auth.profile.userId,
    action: 'role_changed',
    targetId: params.userId,
    metadata: { from: member.role, to: parsed.data.role },
  })

  return NextResponse.json({ member: updated })
}

/**
 * DELETE /api/cmf/packets/{id}/members/{userId}
 *
 * Remove a member. Owner-only, OR a member removing themselves (allowed
 * so a teammate can leave a packet without bothering the owner).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    select: { ownerId: true },
  })
  if (!packet) {
    return NextResponse.json({ error: 'Packet not found' }, { status: 404 })
  }
  const isOwner = packet.ownerId === auth.profile.userId
  const isSelfRemoval = params.userId === auth.profile.userId
  if (!isOwner && !isSelfRemoval && !auth.profile.isAdmin) {
    return NextResponse.json(
      { error: 'Only the owner or an admin can remove other members' },
      { status: 403 }
    )
  }

  const member = await prisma.cmfPacketMember.findUnique({
    where: { packetId_userId: { packetId: params.id, userId: params.userId } },
  })
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  await prisma.cmfPacketMember.delete({
    where: { packetId_userId: { packetId: params.id, userId: params.userId } },
  })

  await logCmfActivity({
    packetId: params.id,
    userId: auth.profile.userId,
    action: 'removed_member',
    targetId: params.userId,
    metadata: { selfRemoval: isSelfRemoval },
  })

  return NextResponse.json({ ok: true })
}
