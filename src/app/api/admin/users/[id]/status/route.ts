import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.response) return result.response

    const { id } = await params

    if (result.user.id === id) {
      return NextResponse.json(
        { error: 'You cannot change your own account status' },
        { status: 400 }
      )
    }
    const body = await request.json()
    const { action } = body as { action: 'pause' | 'unpause' }

    if (action !== 'pause' && action !== 'unpause') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "pause" or "unpause".' },
        { status: 400 }
      )
    }

    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { id: true, role: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (profile.role === 'admin') {
      return NextResponse.json(
        { error: 'Cannot pause an admin account' },
        { status: 400 }
      )
    }

    const updated = await prisma.profile.update({
      where: { id },
      data: {
        pausedAt: action === 'pause' ? new Date() : null,
      },
      select: {
        id: true,
        pausedAt: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update user status'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
