/**
 * Attempt lifecycle endpoints.
 *
 *   GET    /api/cmf/attempts/[id]            — read a single attempt
 *   PATCH  /api/cmf/attempts/[id]            — { action: 'approve' | 'archive' | 'restore' }
 *
 * Approval is the canonical-image switch; archive/restore is soft-delete.
 * Generation lives on /api/cmf/renders/[id]/generate so each route owns one
 * lifecycle phase. Access checks run through the parent render.
 */

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
import {
  approveCmfAttempt,
  archiveCmfAttempt,
  CmfAttemptError,
  restoreCmfAttempt,
} from '@/lib/cmf/render'

export const dynamic = 'force-dynamic'

const ActionSchema = z.object({
  action: z.enum(['approve', 'archive', 'restore']),
})

function translate(err: unknown) {
  if (err instanceof CmfNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
  if (err instanceof CmfForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 })
  if (err instanceof CmfAttemptError) {
    const status = err.category === 'forbidden' ? 403 : 400
    return NextResponse.json({ error: err.message, category: err.category }, { status })
  }
  return null
}

async function loadAttemptWithRender(attemptId: string) {
  return prisma.cmfRenderAttempt.findUnique({
    where: { id: attemptId },
    include: { render: true },
  })
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const attempt = await loadAttemptWithRender(params.id)
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  try {
    await requireRenderAccess({ renderId: attempt.renderId, userId: auth.profile.userId })
  } catch (err) {
    const translated = translate(err)
    if (translated) return translated
    throw err
  }

  return NextResponse.json({ attempt })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const attempt = await loadAttemptWithRender(params.id)
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })

  // approver-or-higher is required for approval; editor is enough for archive/restore
  // since those are reversible operations on review history.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = ActionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.issues },
      { status: 400 }
    )
  }

  const minRole = parsed.data.action === 'approve' ? 'approver' : 'editor'
  let access
  try {
    access = await requireRenderAccess({
      renderId: attempt.renderId,
      userId: auth.profile.userId,
      minRole,
    })
  } catch (err) {
    const translated = translate(err)
    if (translated) return translated
    throw err
  }

  try {
    if (parsed.data.action === 'approve') {
      const result = await approveCmfAttempt({
        attemptId: params.id,
        userId: auth.profile.userId,
      })
      await logCmfActivity({
        packetId: access.packetId,
        userId: auth.profile.userId,
        action: 'attempt_approved',
        targetId: params.id,
        metadata: {
          renderId: attempt.renderId,
          attemptNumber: result.attempt.attemptNumber,
        },
      })
      return NextResponse.json({ attempt: result.attempt, render: result.render })
    }

    if (parsed.data.action === 'archive') {
      const result = await archiveCmfAttempt({ attemptId: params.id })
      await logCmfActivity({
        packetId: access.packetId,
        userId: auth.profile.userId,
        action: 'attempt_archived',
        targetId: params.id,
        metadata: {
          renderId: attempt.renderId,
          attemptNumber: result.attempt.attemptNumber,
        },
      })
      return NextResponse.json({ attempt: result.attempt })
    }

    const result = await restoreCmfAttempt({ attemptId: params.id })
    await logCmfActivity({
      packetId: access.packetId,
      userId: auth.profile.userId,
      action: 'attempt_restored',
      targetId: params.id,
      metadata: {
        renderId: attempt.renderId,
        attemptNumber: result.attempt.attemptNumber,
      },
    })
    return NextResponse.json({ attempt: result.attempt })
  } catch (err) {
    const translated = translate(err)
    if (translated) return translated
    throw err
  }
}
