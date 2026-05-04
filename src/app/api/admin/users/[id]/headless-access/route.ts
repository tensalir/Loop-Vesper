import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/admin/users/:id/headless-access
 *
 * Toggle a user's access to the private `/headless` landing page.
 *
 * Body: `{ "enabled": true | false }`
 *
 * Admin-only. Admins always have implicit access to /headless via their
 * role, so this flag is meaningful only for `role: 'user'` profiles —
 * Loop teammates and (most importantly) external partners who should
 * see the page without being promoted to admin.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.response) return result.response

    const { id } = await params

    const body = (await request.json().catch(() => ({}))) as {
      enabled?: unknown
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid body. Expected `{ "enabled": boolean }`.' },
        { status: 400 }
      )
    }

    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (profile.deletedAt) {
      return NextResponse.json(
        { error: 'Cannot grant access to a deleted user' },
        { status: 400 }
      )
    }

    const updated = await prisma.profile.update({
      where: { id },
      data: { headlessAccess: body.enabled },
      select: {
        id: true,
        headlessAccess: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to update headless access'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
