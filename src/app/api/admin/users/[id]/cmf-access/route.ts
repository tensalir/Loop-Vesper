import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

/**
 * PATCH /api/admin/users/:id/cmf-access
 *
 * Toggle a user's WRITE access to the CMF Studio (importing workbooks,
 * editing SKUs, generating renders/PDFs, approving attempts).
 *
 * Body: `{ "enabled": true | false }`
 *
 * Admin-only. Admins always have implicit CMF write access via their
 * role, so this flag is meaningful only for `role: 'user'` profiles —
 * the small set of teammates who actively own the CMF workflow. The
 * library itself (packets + renders + clown references) is readable
 * by every authenticated profile so everyone sees the same ground
 * truth; only writes are gated.
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
      data: { cmfAccess: body.enabled },
      select: {
        id: true,
        cmfAccess: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to update CMF access'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
