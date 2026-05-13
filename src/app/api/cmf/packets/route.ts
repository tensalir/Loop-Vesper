import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createPacketFromRows,
  listAccessiblePackets,
  requireAuthenticatedProfile,
  requireCmfWrite,
} from '@/lib/cmf/service'
import { cmfError } from '@/lib/cmf/api'
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

  const packets = await listAccessiblePackets(auth.profile.userId)
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
      role: p.role,
      isOwner: p.role === 'owner',
    })),
  })
}

export async function POST(request: NextRequest) {
  // Mutating endpoint: require explicit CMF write permission (admin or
  // `cmfAccess` flag). Reads stay open via requireAuthenticatedProfile.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return cmfError('Invalid JSON body')
  }

  const parsed = CreatePacketSchema.safeParse(body)
  if (!parsed.success) {
    return cmfError('Invalid request body', {
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }

  const { packets } = await createPacketFromRows({
    ownerId: auth.profile.userId,
    importId: parsed.data.importId ?? null,
    packetName: parsed.data.packetName,
    cmfCode: parsed.data.cmfCode,
    notes: parsed.data.notes,
    rows: parsed.data.rows,
  })

  // No additional `logCmfActivity` here: `createPacketFromRows` already
  // writes a `created_packet` row per packet inside its transaction.

  return NextResponse.json({
    packets: packets.map(({ packet, renders, mergeSummary }) => ({
      id: packet.id,
      name: packet.name,
      cmfCode: packet.cmfCode,
      status: packet.status,
      productSlug: renders[0]?.productSlug ?? mergeSummary.productSlug,
      renderCount: renders.length,
      mergeSummary,
    })),
    // Convenience for single-product callers — the primary (or only) packet.
    packet: packets[0]
      ? {
          id: packets[0].packet.id,
          name: packets[0].packet.name,
          cmfCode: packets[0].packet.cmfCode,
          status: packets[0].packet.status,
          renders: packets[0].renders.map((r) => ({
            id: r.id,
            label: r.label,
            status: r.status,
            productSlug: r.productSlug,
          })),
        }
      : null,
  })
}
