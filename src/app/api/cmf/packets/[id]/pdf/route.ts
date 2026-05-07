import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { buildCmfPacketPdf } from '@/lib/cmf/pdf'
import { buildPacketFileSlug } from '@/lib/cmf/prompt'
import {
  CMF_STORAGE_BUCKET,
  packetPdfStoragePath,
  safeFileSlug,
} from '@/lib/cmf/storage'
import { requireAuthenticatedProfile } from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

// PDF generation is cheap but downloads every render image; cap at 10/min/user
// so a runaway loop can't overwhelm Supabase storage egress.
const cmfPdfLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 })

/**
 * POST /api/cmf/packets/{id}/pdf
 *
 * Builds the CMF packet PDF (per-SKU pages + shared breakdown if multi-SKU)
 * and uploads it to the user's CMF storage path. Returns the updated packet
 * with `pdfUrl` populated.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const limited = cmfPdfLimiter.check(auth.profile.userId)
  if (limited) return limited

  const packet = await prisma.cmfPacket.findFirst({
    where: { id: params.id, ownerId: auth.profile.userId },
    include: {
      renders: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  if (!packet) {
    return NextResponse.json({ error: 'Packet not found' }, { status: 404 })
  }

  if (packet.renders.length === 0) {
    return NextResponse.json(
      { error: 'Packet has no SKU rows to export' },
      { status: 422 }
    )
  }

  await prisma.cmfPacket.update({
    where: { id: packet.id },
    data: { status: 'rendering', pdfError: null },
  })

  try {
    const pdfBytes = await buildCmfPacketPdf({
      packetName: packet.name,
      cmfCode: packet.cmfCode,
      notes: packet.notes,
      renders: packet.renders,
    })

    const firstRender = packet.renders[0]
    const fileSlug = safeFileSlug(
      buildPacketFileSlug({
        cmfCode: packet.cmfCode,
        productSlug: firstRender.productSlug,
        colorwayName:
          packet.renders.length === 1
            ? firstRender.colorwayName ?? firstRender.label
            : 'Pack',
      })
    )
    const path = packetPdfStoragePath(auth.profile.userId, packet.id, fileSlug)
    const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`
    const publicUrl = await uploadBase64ToStorage(dataUrl, CMF_STORAGE_BUCKET, path)

    const allReady = packet.renders.every((r) => r.status === 'ready')

    const updated = await prisma.cmfPacket.update({
      where: { id: packet.id },
      data: {
        status: allReady ? 'ready' : 'draft',
        pdfUrl: publicUrl,
        pdfPath: path,
        pdfError: null,
        generatedAt: new Date(),
      },
      include: {
        renders: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({ packet: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF generation failed'
    console.error('[cmf/packets/pdf] generation failed', err)
    await prisma.cmfPacket.update({
      where: { id: packet.id },
      data: { status: 'failed', pdfError: message },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
