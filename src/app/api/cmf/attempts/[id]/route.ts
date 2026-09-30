import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuthenticatedProfile, requireRenderAccess } from '@/lib/cmf/service'
import { cmfError, translateAccessError } from '@/lib/cmf/api'
import { retired } from '@/lib/cmf/retired'

/**
 * /api/cmf/attempts/{id}: GET reads an attempt made the old way, read only. PATCH (approve,
 * archive, restore) is retired for CMF on 2026-09-30: every CMF step now goes through the CMF
 * service at /api/cmf/v2, as Claude's tools do (src/lib/cmf/retired.ts says where each step went).
 * A retired method answers 410 with one line naming the new step.
 */
export const dynamic = 'force-dynamic'

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
  if (!attempt) return cmfError('Attempt not found', { status: 404 })

  try {
    await requireRenderAccess({ renderId: attempt.renderId, userId: auth.profile.userId })
  } catch (err) {
    const translated = translateAccessError(err)
    if (translated) return translated
    throw err
  }

  return NextResponse.json({ attempt })
}

export function PATCH() {
  return retired('approve')
}
