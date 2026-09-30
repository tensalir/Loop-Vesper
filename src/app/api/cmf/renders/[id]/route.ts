import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthenticatedProfile, requireRenderAccess } from '@/lib/cmf/service'
import { cmfError, translateAccessError } from '@/lib/cmf/api'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/renders/{id}: GET reads a SKU row made the old way, read only. PATCH (its hand-edited
 * componentSpecs, clown and model) and DELETE is retired for CMF on 2026-09-30: every CMF step now
 * goes through the CMF service at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts says
 * where each step went). A retired method answers 410 with one line naming the new step.
 */
export const dynamic = 'force-dynamic'

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
    return cmfError('Render not found', { status: 404 })
  }
  return NextResponse.json({ render })
}

export function PATCH() {
  return retired('specs')
}

export function DELETE() {
  return retired('history')
}
