import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  CmfNotFoundError,
  findOwnedPacket,
  requireAuthenticatedProfile,
} from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

const UpdatePacketSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    const packet = await findOwnedPacket(params.id, auth.profile.userId)
    if (!packet) throw new CmfNotFoundError()
    return NextResponse.json({ packet })
  } catch (err) {
    if (err instanceof CmfNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const packet = await prisma.cmfPacket.findFirst({
    where: { id: params.id, ownerId: auth.profile.userId },
    select: { id: true },
  })
  if (!packet) {
    return NextResponse.json({ error: 'Packet not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdatePacketSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 }
    )
  }

  const updated = await prisma.cmfPacket.update({
    where: { id: params.id },
    data: parsed.data,
  })

  return NextResponse.json({ packet: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const packet = await prisma.cmfPacket.findFirst({
    where: { id: params.id, ownerId: auth.profile.userId },
    select: { id: true },
  })
  if (!packet) {
    return NextResponse.json({ error: 'Packet not found' }, { status: 404 })
  }

  await prisma.cmfPacket.delete({ where: { id: params.id } })

  return NextResponse.json({ ok: true })
}
