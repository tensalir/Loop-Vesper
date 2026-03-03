import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await requireAdmin()
    if (result.response) return result.response

    const { id } = await params

    if (result.user.id === id) {
      return NextResponse.json(
        { error: 'You cannot delete your own account' },
        { status: 400 }
      )
    }
    const body = await request.json()
    const { transferToUserId } = body as { transferToUserId?: string }

    const profile = await prisma.profile.findUnique({
      where: { id },
      select: { id: true, role: true, deletedAt: true },
    })

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (profile.role === 'admin') {
      return NextResponse.json(
        { error: 'Cannot delete an admin account' },
        { status: 400 }
      )
    }

    if (profile.deletedAt) {
      return NextResponse.json(
        { error: 'User is already deleted' },
        { status: 400 }
      )
    }

    if (transferToUserId) {
      const targetProfile = await prisma.profile.findUnique({
        where: { id: transferToUserId },
        select: { id: true, deletedAt: true },
      })

      if (!targetProfile || targetProfile.deletedAt) {
        return NextResponse.json(
          { error: 'Transfer target user not found or is deleted' },
          { status: 400 }
        )
      }

      await prisma.$transaction([
        prisma.project.updateMany({
          where: { ownerId: id },
          data: { ownerId: transferToUserId },
        }),
        prisma.generation.updateMany({
          where: { userId: id },
          data: { userId: transferToUserId },
        }),
        prisma.workflow.updateMany({
          where: { userId: id },
          data: { userId: transferToUserId },
        }),
        prisma.note.updateMany({
          where: { userId: id },
          data: { userId: transferToUserId },
        }),
        prisma.profile.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      ])
    } else {
      await prisma.profile.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
    }

    return NextResponse.json({ success: true, id, transferredTo: transferToUserId ?? null })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete user'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
