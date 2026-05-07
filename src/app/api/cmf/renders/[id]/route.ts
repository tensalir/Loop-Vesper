import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  CmfForbiddenError,
  CmfNotFoundError,
  logCmfActivity,
  requireAuthenticatedProfile,
  requireRenderAccess,
} from '@/lib/cmf/service'
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

function translateAccessError(err: unknown) {
  if (err instanceof CmfNotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 })
  }
  if (err instanceof CmfForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 })
  }
  return null
}

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
    return NextResponse.json({ error: 'Render not found' }, { status: 404 })
  }
  return NextResponse.json({ render })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  let access
  try {
    access = await requireRenderAccess({
      renderId: params.id,
      userId: auth.profile.userId,
      minRole: 'editor',
    })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateRenderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 }
    )
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
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    // Require approver-or-owner to delete a SKU row — same posture as
    // packet delete, since removing a SKU is destructive for everyone.
    await requireRenderAccess({
      renderId: params.id,
      userId: auth.profile.userId,
      minRole: 'approver',
    })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  await prisma.cmfRender.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
