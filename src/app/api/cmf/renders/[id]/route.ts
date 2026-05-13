import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  logCmfActivity,
  requireAuthenticatedProfile,
  requireCmfWrite,
  requireRenderAccess,
} from '@/lib/cmf/service'
import { cmfError, translateAccessError } from '@/lib/cmf/api'
import { ComponentSpecSchema, PaletteSwatchSchema } from '@/lib/cmf/schema'

export const dynamic = 'force-dynamic'

const UpdateRenderSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  productCode: z.string().trim().max(80).optional().nullable(),
  ean: z.string().trim().max(40).optional().nullable(),
  colorwayName: z.string().trim().max(120).optional().nullable(),
  clownAssetId: z.string().uuid().nullable().optional(),
  modelId: z.string().trim().max(128).optional(),
  componentSpecs: z.array(ComponentSpecSchema).optional(),
  paletteSwatches: z.array(PaletteSwatchSchema).optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    await requireRenderAccess({
      renderId: params.id,
      userId: auth.profile.userId,
    })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  const render = await prisma.cmfRender.findUnique({ where: { id: params.id } })
  if (!render) {
    return cmfError('Render not found', { status: 404 })
  }
  return NextResponse.json({ render })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // SKU edits require CMF write access. Resolve the parent packet so we
  // can attribute the activity log entry.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const renderForAccess = await prisma.cmfRender.findUnique({
    where: { id: params.id },
    select: { packetId: true },
  })
  if (!renderForAccess) {
    return cmfError('Render not found', { status: 404 })
  }
  const access = { packetId: renderForAccess.packetId }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return cmfError('Invalid JSON body')
  }

  const parsed = UpdateRenderSchema.safeParse(body)
  if (!parsed.success) {
    return cmfError('Invalid request body', {
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }

  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value === undefined) continue
    data[key] = value
  }

  const updated = await prisma.cmfRender.update({
    where: { id: params.id },
    data,
  })

  // Best-effort activity. Captures which fields changed so the timeline
  // doesn't read like a wall of identical "edited SKU" lines.
  await logCmfActivity({
    packetId: access.packetId,
    userId: auth.profile.userId,
    action: 'edited_sku',
    targetId: params.id,
    metadata: { fields: Object.keys(data) },
  })

  return NextResponse.json({ render: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Removing a SKU row requires CMF write access. Same destructive
  // posture as packet delete but unscoped to owner because SKU rows
  // accumulate over multiple imports and aren't tied to a single owner.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  // Read packetId + label BEFORE delete so the activity row has the
  // context it needs (label is the human-readable identifier the
  // timeline shows; packetId is required for logCmfActivity).
  const existing = await prisma.cmfRender.findUnique({
    where: { id: params.id },
    select: { id: true, packetId: true, label: true, productCode: true },
  })
  if (!existing) {
    return cmfError('Render not found', { status: 404 })
  }

  await prisma.cmfRender.delete({ where: { id: params.id } })

  // Activity log emitted AFTER the delete so a failed delete doesn't
  // produce a misleading "deleted SKU X" event. The render row is
  // gone but the packet (and its activity rows) survive.
  await logCmfActivity({
    packetId: existing.packetId,
    userId: auth.profile.userId,
    action: 'deleted_render',
    targetId: existing.id,
    metadata: { label: existing.label, productCode: existing.productCode },
  })

  return NextResponse.json({ ok: true })
}
