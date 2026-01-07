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
 * GET /api/projects/[id]/brainstorm/chats/[chatId]/messages
 * Fetch all messages for a chat thread (for initialMessages in useChat)
 */
export async function GET(
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

    // Fetch messages ordered by creation time
    const messages = await prisma.projectChatMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    })

    // Transform to AI SDK UIMessage format (parts-based)
    const uiMessages = messages.map((msg) => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      parts: [
        {
          type: 'text' as const,
          text: msg.content,
        },
      ],
    }))

    return NextResponse.json(uiMessages)
  } catch (error: any) {
    console.error('Error fetching brainstorm messages:', error)
    return NextResponse.json(
      { error: 'Failed to fetch messages' },
      { status: 500 }
    )
  }
}

