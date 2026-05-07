import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createPacketFromRows,
  listOwnedPackets,
  requireAuthenticatedProfile,
} from '@/lib/cmf/service'
import { CmfSkuRowSchema } from '@/lib/cmf/schema'

export const dynamic = 'force-dynamic'

const CreatePacketSchema = z.object({
  packetName: z.string().trim().min(1).max(160).optional(),
  cmfCode: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
  importId: z.string().uuid().optional(),
  rows: z.array(CmfSkuRowSchema).min(1).max(50),
})

export async function GET(_request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const packets = await listOwnedPackets(auth.profile.userId)
  return NextResponse.json({
    packets: packets.map((p) => ({
      id: p.id,
      name: p.name,
      cmfCode: p.cmfCode,
      status: p.status,
      pdfUrl: p.pdfUrl,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      generatedAt: p.generatedAt,
      renderCount: p.renders.length,
      renders: p.renders,
    })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreatePacketSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid request body',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    )
  }

  const { packet, renders } = await createPacketFromRows({
    ownerId: auth.profile.userId,
    importId: parsed.data.importId ?? null,
    packetName: parsed.data.packetName,
    cmfCode: parsed.data.cmfCode,
    notes: parsed.data.notes,
    rows: parsed.data.rows,
  })

  return NextResponse.json({
    packet: {
      id: packet.id,
      name: packet.name,
      cmfCode: packet.cmfCode,
      status: packet.status,
      renders: renders.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        productSlug: r.productSlug,
      })),
    },
  })
}
