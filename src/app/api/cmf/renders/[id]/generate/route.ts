import { NextRequest, NextResponse } from 'next/server'
import { runCmfRender, CmfRenderError } from '@/lib/cmf/render'
import { requireAuthenticatedProfile } from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

// Rendering hits Nano Banana — keep this conservative so a runaway loop
// can't churn the user's Gemini quota.
const cmfRenderLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 })

/**
 * POST /api/cmf/renders/{id}/generate
 *
 * Synchronously runs the render through Nano Banana. Returns the updated
 * render row when finished. Designers see the generated image inside the
 * normal request lifecycle — long-running multi-SKU packs should call this
 * per-render, the UI stays responsive thanks to React Query streaming.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuthenticatedProfile()
  if (!auth.profile) return auth.response

  const limited = cmfRenderLimiter.check(auth.profile.userId)
  if (limited) return limited

  try {
    const render = await runCmfRender({
      renderId: params.id,
      ownerId: auth.profile.userId,
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
      return NextResponse.json(
        { error: err.message, category: err.category },
        { status }
      )
    }
    const message = err instanceof Error ? err.message : 'Render failed'
    console.error('[cmf/renders/generate] render failed', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
