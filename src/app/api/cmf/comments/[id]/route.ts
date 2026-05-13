import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  logCmfActivity,
  requireCmfWrite,
} from '@/lib/cmf/service'
import { cmfError } from '@/lib/cmf/api'

export const dynamic = 'force-dynamic'

const UpdateCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  resolved: z.boolean().optional(),
})

/**
 * PATCH /api/cmf/comments/{id}
 *
 * Edit body (only the author) or toggle resolution (anyone with CMF
 * write access). Resolving is treated as a separate verb — once
 * resolved, the comment stays in the thread but visually muted.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // All comment mutations require CMF write access. Authorship is an
  // additional check on body edits below.
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const comment = await prisma.cmfComment.findUnique({
    where: { id: params.id },
    select: { id: true, packetId: true, userId: true, resolvedAt: true, renderId: true },
  })
  if (!comment) {
    return cmfError('Comment not found', { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return cmfError('Invalid JSON body')
  }

  const parsed = UpdateCommentSchema.safeParse(body)
  if (!parsed.success) {
    return cmfError('Invalid request body', {
      details: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
  }

  // Editing the body still requires authorship — write access doesn't
  // mean the right to rewrite someone else's words.
  if (typeof parsed.data.body === 'string' && comment.userId !== auth.profile.userId) {
    return cmfError('Only the author can edit a comment body', { status: 403 })
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
  } else if (typeof parsed.data.body === 'string') {
    // Body-edit case — surface so the timeline records "Damien edited a
    // comment 2m ago" instead of silently mutating history.
    await logCmfActivity({
      packetId: comment.packetId,
      userId: auth.profile.userId,
      action: 'comment_edited',
      targetId: comment.id,
      metadata: { renderId: comment.renderId },
    })
  }

  return NextResponse.json({ comment: updated })
}

/**
 * DELETE /api/cmf/comments/{id}
 *
 * Author, packet owner, or admin can delete. Soft-delete-by-resolution
 * is preferred but we still allow hard delete for typos / mis-postings.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const comment = await prisma.cmfComment.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, packetId: true, renderId: true },
  })
  if (!comment) {
    return cmfError('Comment not found', { status: 404 })
  }

  const packet = await prisma.cmfPacket.findUnique({
    where: { id: comment.packetId },
    select: { ownerId: true },
  })
  const isAuthor = comment.userId === auth.profile.userId
  const isOwner = packet?.ownerId === auth.profile.userId
  if (!isAuthor && !isOwner && !auth.profile.isAdmin) {
    return cmfError(
      'Only the author, packet owner, or an admin can delete a comment',
      { status: 403 }
    )
  }

  await prisma.cmfComment.delete({ where: { id: params.id } })

  // Log the deletion so the timeline doesn't lose the breadcrumb.
  // Comment row is gone but the packet (and its activity rows) survive.
  await logCmfActivity({
    packetId: comment.packetId,
    userId: auth.profile.userId,
    action: 'deleted_comment',
    targetId: comment.id,
    metadata: { renderId: comment.renderId },
  })

  return NextResponse.json({ ok: true })
}
