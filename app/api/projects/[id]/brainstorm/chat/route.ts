import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { streamText, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { prisma } from '@/lib/prisma'
import { loadSkill, combineSkills } from '@/lib/skills/registry'

// Default model if env var not set
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

// Regex to extract embedded image data URLs from messages
const IMAGE_DATA_REGEX = /<<IMAGE_DATA:(data:image\/[^>]+)>>/g

// Type for multi-modal message content
type MessageContent = string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string }>
type ModelMessage = { role: 'user' | 'assistant'; content: MessageContent }

/**
 * Check if user has access to the project (owner or invited member)
 */
async function checkProjectAccess(projectId: string, userId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [
        { ownerId: userId },
        {
          members: {
            some: {
              userId: userId,
            },
          },
        },
      ],
    },
    select: { id: true, name: true },
  })
  return project
}

/**
 * Check if user owns the chat
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
 * POST /api/projects/[id]/brainstorm/chat
 * 
 * Streaming chat endpoint using Vercel AI SDK.
 * Expects: { messages: Message[], chatId: string }
 * 
 * Persists user message before streaming, assistant message after.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new Response('Unauthorized', { status: 401 })
    }

    const projectId = params.id

    // Check project access and get project info (including briefing)
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: user.id },
          {
            members: {
              some: {
                userId: user.id,
              },
            },
          },
        ],
      },
      select: { id: true, name: true, briefing: true },
    })
    if (!project) {
      return new Response('Project not found', { status: 404 })
    }

    const body = await request.json()
    const { messages, chatId } = body as { messages: UIMessage[]; chatId: string }

    if (!chatId || typeof chatId !== 'string') {
      return new Response('chatId is required', { status: 400 })
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response('messages array is required', { status: 400 })
    }

    const getMessageText = (message: UIMessage): string => {
      return message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    }

    // Verify chat ownership
    const isOwner = await checkChatOwnership(chatId, user.id, projectId)
    if (!isOwner) {
      return new Response('Chat not found', { status: 404 })
    }

    // Get the latest user message to persist
    const latestUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    if (!latestUserMessage) {
      return new Response('No user message found', { status: 400 })
    }
    // Remove image data markers for cleaner persistence (keep URLs for display)
    const latestUserText = getMessageText(latestUserMessage).replace(IMAGE_DATA_REGEX, '').trim()

    // Persist the user message
    await prisma.projectChatMessage.create({
      data: {
        chatId,
        role: 'user',
        content: latestUserText,
      },
    })

    // Update chat's updatedAt
    await prisma.projectChat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    })

    // Load skills for the system prompt
    const brainstormingSkill = loadSkill('brainstorming')
    const genaiSkill = loadSkill('genai-prompting')
    
    const skills = [brainstormingSkill, genaiSkill].filter(Boolean) as NonNullable<typeof brainstormingSkill>[]
    let systemPrompt = skills.length > 0 
      ? combineSkills(skills)
      : 'You are a helpful creative brainstorming assistant for AI image and video generation.'

    // Add project context
    systemPrompt += `\n\n---\n**Current Project:** ${project.name}\n---`
    
    // Add project briefing if it exists
    if (project.briefing && project.briefing.trim()) {
      systemPrompt += `\n\n---\n**Project Briefing/Context:**\n${project.briefing}\n---`
    }

    // Get the model from env or use default
    const modelId = process.env.ANTHROPIC_BRAINSTORM_MODEL || DEFAULT_MODEL

    // Convert UI messages to model messages, extracting embedded images for Claude vision
    const modelMessages: ModelMessage[] = messages.map((msg) => {
      const textContent = getMessageText(msg)
      
      // Extract any embedded image data URLs
      const imageMatches = Array.from(textContent.matchAll(IMAGE_DATA_REGEX))
      
      // Remove image data markers from text for cleaner display
      const cleanText = textContent.replace(IMAGE_DATA_REGEX, '').trim()
      
      if (msg.role === 'user' && imageMatches.length > 0) {
        // Build multi-modal content with images + text
        const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = []
        
        // Add images first so Claude sees them before the text
        for (const match of imageMatches) {
          const dataUrl = match[1]
          content.push({
            type: 'image',
            image: dataUrl,
          })
        }
        
        // Add the text content
        if (cleanText) {
          content.push({
            type: 'text',
            text: cleanText,
          })
        }
        
        return {
          role: 'user' as const,
          content,
        }
      }
      
      // For assistant messages or user messages without images, just use text
      return {
        role: msg.role as 'user' | 'assistant',
        content: cleanText || textContent,
      }
    })

    // Stream the response using AI SDK
    // Cast messages to the expected type to handle multi-modal content
    const result = streamText({
      model: anthropic(modelId),
      system: systemPrompt,
      messages: modelMessages as any,
      onFinish: async ({ text }) => {
        // Persist the assistant message after streaming completes
        try {
          await prisma.projectChatMessage.create({
            data: {
              chatId,
              role: 'assistant',
              content: text,
            },
          })
          
          // Update chat title if this is the first exchange
          // (title is still "New Chat")
          const chat = await prisma.projectChat.findUnique({
            where: { id: chatId },
            select: { title: true, _count: { select: { messages: true } } },
          })
          
          if (chat && chat.title === 'New Chat' && chat._count.messages <= 2) {
            // Generate a short title from the first user message
            const firstUserMsg = latestUserText.slice(0, 50)
            const newTitle = firstUserMsg.length < latestUserText.length 
              ? `${firstUserMsg}...` 
              : firstUserMsg
            
            await prisma.projectChat.update({
              where: { id: chatId },
              data: { title: newTitle },
            })
          }
        } catch (err) {
          console.error('Error persisting assistant message:', err)
        }
      },
    })

    // Return the streaming response
    return result.toTextStreamResponse()
  } catch (error: any) {
    console.error('Brainstorm chat error:', error)
    return new Response(error.message || 'Internal server error', { status: 500 })
  }
}

