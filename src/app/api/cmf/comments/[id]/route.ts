import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  CmfForbiddenError,
  CmfNotFoundError,
  logCmfActivity,
  requireAuthenticatedProfile,
  requirePacketAccess,
} from '@/lib/cmf/service'

export const dynamic = 'force-dynamic'

const UpdateCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  resolved: z.boolean().optional(),
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
 * PATCH /api/cmf/comments/{id}
 *
 * Edit body (only the author) or toggle resolution (any editor+). Resolving
 * a comment is treated as a separate verb — once resolved, it stays in the
 * thread but visually muted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const comment = await prisma.cmfComment.findUnique({
    where: { id: params.id },
    select: { id: true, packetId: true, userId: true, resolvedAt: true, renderId: true },
  })
  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UpdateCommentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 }
    )
  }

  // Editing the body requires authorship; resolving requires editor+.
  if (typeof parsed.data.body === 'string') {
    if (comment.userId !== auth.profile.userId) {
      return NextResponse.json(
        { error: 'Only the author can edit a comment body' },
        { status: 403 }
      )
    }
  }
  if (typeof parsed.data.resolved === 'boolean') {
    try {
      await requirePacketAccess({
        packetId: comment.packetId,
        userId: auth.profile.userId,
        minRole: 'editor',
      })
    } catch (err) {
      const translated = translateAccessError(err)
      if (translated) return translated
      throw err
    }
  } else {
    // Pure body edit still requires packet access.
    try {
      await requirePacketAccess({
        packetId: comment.packetId,
        userId: auth.profile.userId,
      })
    } catch (err) {
      const translated = translateAccessError(err)
      if (translated) return translated
      throw err
    }
  }

  const now = new Date()
  const data: Record<string, unknown> = {}
  if (typeof parsed.data.body === 'string') {
    data.body = parsed.data.body
  }
  if (parsed.data.resolved === true && !comment.resolvedAt) {
    data.resolvedAt = now
    data.resolvedBy = auth.profile.userId
  } else if (parsed.data.resolved === false && comment.resolvedAt) {
    data.resolvedAt = null
    data.resolvedBy = null
  }

  const updated = await prisma.cmfComment.update({
    where: { id: params.id },
    data,
    include: {
      user: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
      resolvedByUser: {
        select: { id: true, displayName: true, username: true, avatarUrl: true },
      },
    },
  })

  if (parsed.data.resolved === true && !comment.resolvedAt) {
    await logCmfActivity({
      packetId: comment.packetId,
      userId: auth.profile.userId,
      action: 'comment_resolved',
      targetId: comment.id,
      metadata: { renderId: comment.renderId },
    })
  }

  return NextResponse.json({ comment: updated })
}

/**
 * DELETE /api/cmf/comments/{id}
 *
 * Author or owner can delete. Soft-delete-by-resolution is preferred but
 * we still allow hard delete for typos / mis-postings.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const comment = await prisma.cmfComment.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, packetId: true },
  })
  if (!comment) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: comment.packetId },
    select: { ownerId: true },
  })
  const isAuthor = comment.userId === auth.profile.userId
  const isOwner = packet?.ownerId === auth.profile.userId
  if (!isAuthor && !isOwner) {
    return NextResponse.json(
      { error: 'Only the author or packet owner can delete a comment' },
      { status: 403 }
    )
  }

  await prisma.cmfComment.delete({ where: { id: params.id } })

  return NextResponse.json({ ok: true })
}
