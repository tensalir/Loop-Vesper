import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'
import { loadSkill, combineSkills } from '@/lib/skills/registry'
import { logMetric } from '@/lib/metrics'

/**
 * Simple in-memory rate limiter
 * In production, use Redis or similar
 */
const rateLimits = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 20 // requests per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute

function checkRateLimit(userId: string): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const limit = rateLimits.get(userId)
  
  if (!limit || now > limit.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 }
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 }
  }
  
  limit.count++
  return { allowed: true, remaining: RATE_LIMIT_MAX - limit.count }
}

// Cleanup old rate limit entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [userId, limit] of Array.from(rateLimits.entries())) {
    if (now > limit.resetAt) {
      rateLimits.delete(userId)
    }
  }
}, 60 * 1000)

/**
 * Message format for the assistant
 */
interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Context about the current generation state
 */
interface GenerationContext {
  currentPrompt?: string
  selectedModel?: string
  generationType?: 'image' | 'video'
  referenceImageCount?: number
}

/**
 * POST /api/assistant/chat
 * 
 * Send a message to the assistant and get a response.
 * The assistant loads the assistant skill and has context about
 * the current generation state.
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now()
  
  try {
    // Authenticate
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check rate limit
    const { allowed, remaining } = checkRateLimit(user.id)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait a moment.' },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'Retry-After': '60',
          },
        }
      )
    }

    // Parse request
    const body = await request.json()
    const { 
      messages, 
      context,
    }: { 
      messages: AssistantMessage[]
      context?: GenerationContext 
    } = body

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      )
    }

    // Load the assistant skill
    const assistantSkill = loadSkill('assistant')
    const genaiSkill = loadSkill('genai-prompting')
    
    // Combine skills if both available
    const skills = [assistantSkill, genaiSkill].filter(Boolean) as NonNullable<typeof assistantSkill>[]
    const systemPrompt = skills.length > 0 
      ? combineSkills(skills)
      : 'You are a helpful assistant for an AI image and video generation platform.'

    // Build context string if provided
    let contextString = ''
    if (context) {
      const parts: string[] = []
      if (context.currentPrompt) {
        parts.push(`Current prompt: "${context.currentPrompt}"`)
      }
      if (context.selectedModel) {
        parts.push(`Selected model: ${context.selectedModel}`)
      }
      if (context.generationType) {
        parts.push(`Generation type: ${context.generationType}`)
      }
      if (context.referenceImageCount && context.referenceImageCount > 0) {
        parts.push(`Reference images: ${context.referenceImageCount}`)
      }
      if (parts.length > 0) {
        contextString = `\n\n---\n**Current Context:**\n${parts.join('\n')}\n---\n\n`
      }
    }

    // Inject context into the system prompt
    const fullSystemPrompt = contextString 
      ? `${systemPrompt}${contextString}`
      : systemPrompt

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }))

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.7,
      system: fullSystemPrompt,
      messages: anthropicMessages,
    })

    // Extract response text
    let assistantResponse = ''
    const textBlocks = response.content.filter(block => block.type === 'text')
    if (textBlocks.length > 0 && textBlocks[0].type === 'text') {
      assistantResponse = textBlocks[0].text
    }

    logMetric({
      name: 'api_assistant_chat',
      status: 'success',
      durationMs: performance.now() - startTime,
      meta: {
        messageCount: messages.length,
        hasContext: !!context,
        responseLength: assistantResponse.length,
      },
    })

    return NextResponse.json({
      message: {
        role: 'assistant',
        content: assistantResponse,
      },
    }, {
      headers: {
        'X-RateLimit-Remaining': remaining.toString(),
      },
    })
  } catch (error: any) {
    logMetric({
      name: 'api_assistant_chat',
      status: 'error',
      durationMs: performance.now() - startTime,
      meta: { error: error.message },
    })

    console.error('Assistant chat error:', error)

    if (error.status === 401) {
      return NextResponse.json(
        { error: 'Invalid API key. Please configure ANTHROPIC_API_KEY' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to get assistant response', details: error.message },
      { status: 500 }
    )
  }
}

