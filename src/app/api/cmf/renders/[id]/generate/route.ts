import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { runCmfRender, CmfRenderError } from '@/lib/cmf/render'
import {
  logCmfActivity,
  requireCmfWrite,
} from '@/lib/cmf/service'
import { createRateLimiter } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

const cmfRenderLimiter = createRateLimiter({ maxRequests: 30, windowMs: 60_000 })

/**
 * Optional refinement payload — when provided, the new attempt is
 * generated as a correction layered on top of the workbook spec
 * rather than a fresh roll of the dice. The bulk burst path posts
 * with no body, so the schema is fully optional and an empty body is
 * the correct "fresh attempt" signal.
 */
const RefineSchema = z
  .object({
    refinementPrompt: z.string().trim().min(1).max(2000).optional(),
    parentAttemptId: z.string().uuid().optional(),
    // Storage paths returned by POST /refinement-references. We
    // accept up to 4 paths here — the upload route enforces the
    // same cap, but defending in depth means a malicious client
    // can't trigger a 200-image download fan-out by hand-crafting
    // this payload. Empty string entries are filtered server-side
    // in `runCmfRender`.
    referenceImagePaths: z.array(z.string().min(1).max(512)).max(4).optional(),
  })
  .optional()

export async function POST(
  request: NextRequest,
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

  // Parse the optional refinement body. Bulk burst posts no body —
  // `request.json()` throws on empty input, so we swallow that and
  // default to an empty object.
  let refineBody: z.infer<typeof RefineSchema> = undefined
  try {
    const raw = await request.json().catch(() => undefined)
    if (raw !== undefined) {
      const parsed = RefineSchema.safeParse(raw)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid refinement payload', details: parsed.error.issues },
          { status: 400 }
        )
      }
      refineBody = parsed.data
    }
  } catch {
    // Body parsing failed (rare given the catch above) — treat as
    // no body, same as bulk burst.
    refineBody = undefined
  }

  // Cross-check: if a parent attempt is named, it MUST belong to the
  // same render so a refinement can't be tricked into chaining
  // across SKUs. 400 with a precise error so the UI can surface it.
  if (refineBody?.parentAttemptId) {
    const parent = await prisma.cmfRenderAttempt.findUnique({
      where: { id: refineBody.parentAttemptId },
      select: { renderId: true },
    })
    if (!parent || parent.renderId !== params.id) {
      return NextResponse.json(
        {
          error:
            'parentAttemptId does not belong to this render — refinements are scoped to a single SKU.',
        },
        { status: 400 }
      )
    }
  }

  const isRefinement = Boolean(refineBody?.refinementPrompt?.trim())

  try {
    const result = await runCmfRender({
      renderId: params.id,
      triggeredByUserId: auth.profile.userId,
      refinementPrompt: refineBody?.refinementPrompt,
      parentAttemptId: refineBody?.parentAttemptId,
      referenceImagePaths: refineBody?.referenceImagePaths,
    })

    await logCmfActivity({
      packetId: access.packetId,
      userId: auth.profile.userId,
      // Refinements get their own activity verb so the timeline can
      // distinguish "rolled the dice" from "applied a correction".
      action: isRefinement ? 'attempt_refined' : 'rendered_sku',
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
        ...(isRefinement
          ? {
              parentAttemptId: refineBody?.parentAttemptId ?? null,
              // Truncate the refinement prompt in the metadata so a
              // very long correction doesn't bloat the activity row.
              refinementPrompt:
                refineBody?.refinementPrompt?.slice(0, 200) ?? null,
              referenceImageCount: refineBody?.referenceImagePaths?.length ?? 0,
            }
          : {}),
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
