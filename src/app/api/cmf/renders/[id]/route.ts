import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireAuthenticatedProfile } from '@/lib/cmf/service'
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

  const render = await prisma.cmfRender.findFirst({
    where: { id: params.id, ownerId: auth.profile.userId },
  })
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

  const exists = await prisma.cmfRender.findFirst({
    where: { id: params.id, ownerId: auth.profile.userId },
    select: { id: true },
  })
  if (!exists) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 })
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
    if (key === 'componentSpecs' || key === 'paletteSwatches') {
      data[key] = value
    } else {
      data[key] = value
    }
  }

  const updated = await prisma.cmfRender.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json({ render: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const exists = await prisma.cmfRender.findFirst({
    where: { id: params.id, ownerId: auth.profile.userId },
    select: { id: true },
  })
  if (!exists) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 })
  }

  await prisma.cmfRender.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
