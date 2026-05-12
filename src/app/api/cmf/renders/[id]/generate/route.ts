import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runCmfRender, CmfRenderError } from '@/lib/cmf/render'
import {
  logCmfActivity,
  requireCmfWrite,
} from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

const cmfRenderLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 })

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireCmfWrite()
  if (!auth.profile) return auth.response

  const limited = cmfRenderLimiter.check(auth.profile.userId)
  if (limited) return limited

  // Resolve the parent packet for activity attribution. 404 if the
  // render doesn't exist.
  const renderRow = await prisma.cmfRender.findUnique({
    where: { id: params.id },
    select: { packetId: true },
  })
  if (!renderRow) {
    return NextResponse.json({ error: 'Render not found' }, { status: 404 })
  }
  const access = { packetId: renderRow.packetId }

  try {
    const result = await runCmfRender({
      renderId: params.id,
      triggeredByUserId: auth.profile.userId,
    })

    await logCmfActivity({
      packetId: access.packetId,
      userId: auth.profile.userId,
      action: 'rendered_sku',
      targetId: params.id,
      metadata: {
        label: result.render.label,
        status: result.render.status,
        attemptId: result.attempt.id,
        attemptNumber: result.attempt.attemptNumber,
        variantId: result.variant.id,
        variantName: result.variant.name,
        clownVariant: result.clown?.variantSlug ?? null,
        clownLabel: result.clown?.label ?? null,
        clownSource: result.clown?.source ?? null,
      },
    })

    return NextResponse.json({
      render: result.render,
      attempt: result.attempt,
      variant: result.variant,
      clown: result.clown,
    })
  } catch (err) {
    if (err instanceof CmfRenderError) {
      const status =
        err.category === 'validation'
          ? 400
          : err.category === 'reference'
          ? 422
          : 502
      await logCmfActivity({
        packetId: access.packetId,
        userId: auth.profile.userId,
        action: 'render_failed',
        targetId: params.id,
        metadata: { category: err.category, message: err.message },
      })
      return NextResponse.json(
        { error: err.message, category: err.category },
        { status }
      )
    }
    const message = err instanceof Error ? err.message : 'Render failed'
    console.error('[cmf/renders/generate] render failed', err)
    await logCmfActivity({
      packetId: access.packetId,
      userId: auth.profile.userId,
      action: 'render_failed',
      targetId: params.id,
      metadata: { message },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
