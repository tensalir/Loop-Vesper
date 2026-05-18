import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/api/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/updates/:id/seen
 *
 * Mark a product update as seen for the current user. Idempotent — the
 * `(user_id, update_id)` unique constraint means callers can retry safely
 * (e.g. the popup retries on flaky network without double-marking).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { user, error, statusCode } = await getAuthUser()
  if (!user) {
    return NextResponse.json(
      { error: error || 'Unauthorized' },
      { status: statusCode ?? 401 }
    )
  }

  const updateId = params.id
  if (!updateId || !UUID_RE.test(updateId)) {
    return NextResponse.json({ error: 'Invalid update id' }, { status: 400 })
  }

  const update = await prisma.productUpdate.findUnique({
    where: { id: updateId },
    select: { id: true },
  })
  if (!update) {
    return NextResponse.json({ error: 'Update not found' }, { status: 404 })
  }

  await prisma.userProductUpdateView.upsert({
    where: {
      userId_updateId: { userId: user.id, updateId },
    },
    update: {},
    create: {
      userId: user.id,
      updateId,
    },
  })

  return NextResponse.json({ ok: true })
}
