/**
 * Build the CMF packet PDF.
 *
 * Reads the packet + renders + render attempts, resolves the document
 * through `resolveCmfDocument` (same data model the HTML preview uses),
 * and refuses to export when SKUs are missing approved attempts — unless
 * the request body explicitly opts in with `allowDraft: true`, in which
 * case the filename gains a `_DRAFT` suffix and a watermark would be
 * applied at the PDF level.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { buildCmfPacketPdf } from '@/lib/cmf/pdf'
import { buildPacketFileSlug } from '@/lib/cmf/prompt'
import {
  isDocumentReadyForExport,
  resolveCmfDocument,
  summarisePacketReadiness,
} from '@/lib/cmf/document'
import {
  CMF_STORAGE_BUCKET,
  packetPdfStoragePath,
  safeFileSlug,
} from '@/lib/cmf/storage'
import {
  CmfForbiddenError,
  CmfNotFoundError,
  logCmfActivity,
  requireAuthenticatedProfile,
  requirePacketAccess,
} from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

const cmfPdfLimiter = createRateLimiter({ maxRequests: 10, windowMs: 60_000 })

const BodySchema = z.object({
  allowDraft: z.boolean().optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const limited = cmfPdfLimiter.check(auth.profile.userId)
  if (limited) return limited

  try {
    await requirePacketAccess({
      packetId: params.id,
      userId: auth.profile.userId,
      minRole: 'editor',
    })
  } catch (err) {
    if (err instanceof CmfNotFoundError)
      return NextResponse.json({ error: err.message }, { status: 404 })
    if (err instanceof CmfForbiddenError)
      return NextResponse.json({ error: err.message }, { status: 403 })
    throw err
  }

  let allowDraft = false
  try {
    const raw = await request.json().catch(() => ({}))
    const parsed = BodySchema.safeParse(raw ?? {})
    if (parsed.success) allowDraft = !!parsed.data.allowDraft
  } catch {
    allowDraft = false
  }

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
    include: {
      renders: {
        orderBy: { sortOrder: 'asc' },
        include: {
          renderAttempts: { orderBy: { attemptNumber: 'desc' } },
        },
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

  const document = resolveCmfDocument({
    id: packet.id,
    name: packet.name,
    cmfCode: packet.cmfCode,
    notes: packet.notes,
    generatedAt: packet.generatedAt,
    documentDraft: packet.documentDraft,
    renders: packet.renders,
  })

  const readiness = summarisePacketReadiness({
    id: packet.id,
    name: packet.name,
    cmfCode: packet.cmfCode,
    notes: packet.notes,
    generatedAt: packet.generatedAt,
    documentDraft: packet.documentDraft,
    renders: packet.renders,
  })

  if (!isDocumentReadyForExport(document) && !allowDraft) {
    return NextResponse.json(
      {
        error:
          'PDF export is gated on every SKU having an approved render. Approve a render per SKU or pass allowDraft: true to ship a DRAFT.',
        readiness,
      },
      { status: 422 }
    )
  }

  await prisma.cmfPacket.update({
    where: { id: packet.id },
    data: { status: 'rendering', pdfError: null },
  })

  try {
    // Map the resolved document back to the shape buildCmfPacketPdf expects.
    // The PDF builder reads renders[].renderUrl / componentSpecs / etc., which
    // align with what we've already mirrored onto the cmf_renders row.
    const renderProjections = document.pages.map((page) => {
      const render = packet.renders.find((r) => r.id === page.renderId)!
      return {
        id: render.id,
        label: render.label,
        colorwayName: page.colorwayLabel,
        productSlug: render.productSlug,
        productCode: render.productCode,
        ean: render.ean,
        componentSpecs: render.componentSpecs,
        paletteSwatches: render.paletteSwatches,
        renderUrl: page.imageUrl,
        enhancedPrompt: render.enhancedPrompt,
        status: render.status,
      }
    })

    const pdfBytes = await buildCmfPacketPdf({
      packetName: document.packetName,
      cmfCode: document.cmfCode,
      notes: document.notes,
      renders: renderProjections,
      drawnBy: auth.profile.email ?? null,
      isDraft: document.isDraft,
    })

    const firstPage = document.pages[0]
    const fileSlug = safeFileSlug(
      buildPacketFileSlug({
        cmfCode: document.cmfCode,
        productSlug: firstPage.productSlug,
        colorwayName:
          document.pages.length === 1 ? firstPage.colorwayLabel : 'Pack',
      })
    )
    const filename = document.isDraft ? `${fileSlug}_DRAFT` : fileSlug
    const path = packetPdfStoragePath(packet.ownerId, packet.id, filename)
    const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`
    const publicUrl = await uploadBase64ToStorage(dataUrl, CMF_STORAGE_BUCKET, path)

    const allReady = packet.renders.every((r) => r.status === 'ready')

    const updated = await prisma.cmfPacket.update({
      where: { id: packet.id },
      data: {
        status: allReady && !document.isDraft ? 'ready' : 'draft',
        pdfUrl: publicUrl,
        pdfPath: path,
        pdfError: null,
        generatedAt: new Date(),
      },
      include: {
        renders: {
          orderBy: { sortOrder: 'asc' },
          include: { renderAttempts: { orderBy: { attemptNumber: 'desc' } } },
        },
      },
    })

    await logCmfActivity({
      packetId: packet.id,
      userId: auth.profile.userId,
      action: 'pdf_generated',
      metadata: { url: publicUrl, isDraft: document.isDraft, readiness },
    })

    return NextResponse.json({ packet: updated, document, readiness })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PDF generation failed'
    console.error('[cmf/packets/pdf] generation failed', err)
    await prisma.cmfPacket.update({
      where: { id: packet.id },
      data: { status: 'failed', pdfError: message },
    })
    await logCmfActivity({
      packetId: packet.id,
      userId: auth.profile.userId,
      action: 'pdf_failed',
      metadata: { message },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
