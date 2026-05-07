import { NextRequest, NextResponse } from 'next/server'
import { runCmfRender, CmfRenderError } from '@/lib/cmf/render'
import {
  CmfForbiddenError,
  CmfNotFoundError,
  logCmfActivity,
  requireAuthenticatedProfile,
  requireRenderAccess,
} from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

const cmfRenderLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 })

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const limited = cmfRenderLimiter.check(auth.profile.userId)
  if (limited) return limited

  let access
  try {
    access = await requireRenderAccess({
      renderId: params.id,
      userId: auth.profile.userId,
      minRole: 'editor',
    })
  } catch (err) {
    if (err instanceof CmfNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof CmfForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 })
    }
    throw err
  }

  try {
    const render = await runCmfRender({
      renderId: params.id,
      triggeredByUserId: auth.profile.userId,
    })

    await logCmfActivity({
      packetId: access.packetId,
      userId: auth.profile.userId,
      action: 'rendered_sku',
      targetId: params.id,
      metadata: { label: render.label, status: render.status },
    })

    return NextResponse.json({ render })
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
