import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  CmfNotFoundError,
  CmfForbiddenError,
  findAccessiblePacket,
  logCmfActivity,
  requireAuthenticatedProfile,
  requireCmfWrite,
  requirePacketAccess,
} from '@/lib/cmf/service'
import { CmfDocumentDraftSchema } from '@/lib/cmf/document'

export const dynamic = 'force-dynamic'

const UpdatePacketSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
  documentDraft: CmfDocumentDraftSchema.optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    // Any role can read; viewers see exactly the same data shape.
    await requirePacketAccess({
      packetId: params.id,
      userId: auth.profile.userId,
    })
    const packet = await findAccessiblePacket(params.id, auth.profile.userId)
    if (!packet) throw new CmfNotFoundError()
    return NextResponse.json({ packet })
  } catch (err) {
    if (err instanceof CmfNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof CmfForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    throw err
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Editing packet metadata requires CMF write access. The library is
  // globally readable but mutations are scoped to admin / cmfAccess.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  // Verify the packet exists so we return 404 (not 500) on bad IDs.
  const exists = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    select: { id: true },
  })
  if (!exists) {
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

  const dataForUpdate: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.documentDraft !== undefined) {
    dataForUpdate.documentDraft = parsed.data.documentDraft as object
  }

  const updated = await prisma.cmfPacket.update({
    where: { id: params.id },
    data: dataForUpdate,
  })

  if (parsed.data.documentDraft !== undefined) {
    await logCmfActivity({
      packetId: params.id,
      userId: auth.profile.userId,
      action: 'document_draft_saved',
      metadata: { fields: Object.keys(parsed.data.documentDraft ?? {}) },
    })
  }

  return NextResponse.json({ packet: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Deleting a packet remains a high-trust operation: under the
  // global-library model anyone with CMF write access can delete, but
  // we still scope it down to admins or the original owner so a single
  // teammate doesn't accidentally vapourise a launch packet someone
  // else is using. (Smaller team, but destructive irreversibility.)
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    select: { id: true, ownerId: true },
  })
  if (!packet) {
    return NextResponse.json({ error: 'Packet not found' }, { status: 404 })
  }

  if (!auth.profile.isAdmin && packet.ownerId !== auth.profile.userId) {
    return NextResponse.json(
      { error: 'Only the packet owner or an admin may delete a packet.' },
      { status: 403 }
    )
  }

  await prisma.cmfPacket.delete({ where: { id: params.id } })

  return NextResponse.json({ ok: true })
}
