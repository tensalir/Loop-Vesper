import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  CmfForbiddenError,
  CmfNotFoundError,
  logCmfActivity,
  requireAuthenticatedProfile,
  requireCmfWrite,
  requirePacketAccess,
} from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

const CreateCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  /** When set, the comment is pinned to a single SKU row. */
  renderId: z.string().uuid().optional(),
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

/**
 * GET /api/cmf/packets/{id}/comments?renderId=
 *
 * Returns all comments scoped to a packet (or to a single SKU row when
 * `renderId` is set). Sorted oldest-first so threads render top-to-bottom.
 * Any role with access can read.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  try {
    await requirePacketAccess({
      packetId: params.id,
      userId: auth.profile.userId,
    })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  const renderId = request.nextUrl.searchParams.get('renderId')
  const includeResolved = request.nextUrl.searchParams.get('includeResolved') !== 'false'

  const comments = await prisma.cmfComment.findMany({
    where: {
      packetId: params.id,
      ...(renderId ? { renderId } : {}),
      ...(includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: { createdAt: 'asc' },
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
      resolvedByUser: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  return NextResponse.json({ comments })
}

/**
 * POST /api/cmf/packets/{id}/comments
 *
 * Add a comment. Requires CMF write access — viewers can read every
 * comment thread (the library is one ground-truth) but mutating it
 * is reserved for the team that actually owns the workflow.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  // Verify the packet exists so we 404 on bad IDs.
  const packet = await prisma.cmfPacket.findUnique({
    where: { id: params.id },
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

  const parsed = CreateCommentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 }
    )
  }

  if (parsed.data.renderId) {
    const render = await prisma.cmfRender.findUnique({
      where: { id: parsed.data.renderId },
      select: { packetId: true },
    })
    if (!render || render.packetId !== params.id) {
      return NextResponse.json(
        { error: 'Render does not belong to this packet' },
        { status: 400 }
      )
    }
  }

  const comment = await prisma.cmfComment.create({
    data: {
      packetId: params.id,
      renderId: parsed.data.renderId ?? null,
      userId: auth.profile.userId,
      body: parsed.data.body,
    },
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  await logCmfActivity({
    packetId: params.id,
    userId: auth.profile.userId,
    action: 'commented',
    targetId: comment.id,
    metadata: { renderId: comment.renderId },
  })

  return NextResponse.json({ comment })
}
