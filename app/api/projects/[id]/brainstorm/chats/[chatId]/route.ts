import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Check if user owns the chat (and has project access)
 */
async function checkChatOwnership(chatId: string, userId: string, projectId: string) {
  const chat = await prisma.projectChat.findFirst({
    where: {
      id: chatId,
      projectId,
      userId,
    },
    select: { id: true },
  })
  return !!chat
}

/**
 * PATCH /api/projects/[id]/brainstorm/chats/[chatId]
 * Rename a chat thread
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; chatId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: projectId, chatId } = params

    // Check chat ownership
    const isOwner = await checkChatOwnership(chatId, user.id, projectId)
    if (!isOwner) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const body = await request.json()
    const { title } = body

    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }

    const chat = await prisma.projectChat.update({
      where: { id: chatId },
      data: { title: title.trim() },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json(chat)
  } catch (error: any) {
    console.error('Error updating brainstorm chat:', error)
    return NextResponse.json(
      { error: 'Failed to update chat' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/projects/[id]/brainstorm/chats/[chatId]
 * Delete a chat thread and all its messages (cascade)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; chatId: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: projectId, chatId } = params

    // Check chat ownership
    const isOwner = await checkChatOwnership(chatId, user.id, projectId)
    if (!isOwner) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Delete the chat (messages cascade via onDelete: Cascade)
    await prisma.projectChat.delete({
      where: { id: chatId },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting brainstorm chat:', error)
    return NextResponse.json(
      { error: 'Failed to delete chat' },
      { status: 500 }
    )
  }
}

