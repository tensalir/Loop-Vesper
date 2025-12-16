import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { prompt, modelId, referenceImage } = await request.json()

    if (!prompt || !modelId) {
      return NextResponse.json(
        { error: 'Prompt and modelId are required' },
        { status: 400 }
      )
    }

    // Get model-specific enhancement prompt from database
    const enhancementPrompt = await (prisma as any).promptEnhancementPrompt.findFirst({
      where: {
        modelIds: {
          has: modelId, // Check if this model ID is in the array
        },
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })

    // Fallback to universal enhancement if no model-specific one exists
    let systemPrompt: string
    if (enhancementPrompt) {
      systemPrompt = enhancementPrompt.systemPrompt
    } else {
      // Fallback to universal system prompt (hardcoded to avoid file system issues)
      systemPrompt = `You are an expert AI prompt engineer. Your job is to enhance user prompts for generative AI models.

**CRITICAL INSTRUCTION**: Return ONLY the enhanced prompt text. Do NOT include explanations, versions, reasons, or any other text. Just the prompt itself.

## Your Mission
Enhance the user's prompt by adding helpful details while respecting their creative intent. Make it more effective without overwriting their vision.

## Guidelines
- Add missing details (lighting, camera, framing) if appropriate
- Clarify ambiguous elements
- Keep the original tone and style
- Don't add unnecessary complexity
- Don't force "best practices" that contradict intent

## Response Format
Return ONLY the enhanced prompt text. Nothing else.`
    }

    // Initialize Claude client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    // Build the enhancement request with model-specific guidance
    let requestContent: string
    
    if (referenceImage) {
      // Image present. If target is VIDEO model, treat as image-to-video guidance (Veo-style).
      const isVideoModel = /veo|video|replicate-video|fal-video|gemini-video/i.test(modelId)
      if (isVideoModel) {
        requestContent = `User wants to generate a video guided by a reference image. User's text prompt: "${prompt}"
Reference image will be provided.

Enhance this for an image-to-video workflow (inspired by Veo best practices):
- Keep the subject and style consistent with the reference image
- Add subtle motion cues (camera and subject) appropriate for ~8s
- Describe lighting, mood, and pacing succinctly
- Provide a single coherent shot idea (avoid rigid multi-shot lists)
- If audio ambiance is desired, mention it briefly; otherwise omit

Return ONLY the enhanced video prompt.`
      } else if (modelId === 'gemini-nano-banana-pro') {
        requestContent = `User wants to edit an image. Their instruction: "${prompt}"
Reference image will be provided.

IMPORTANT: For Nano banana pro image editing:
- Describe ONLY the specific changes to make
- Use precise, action-oriented language
- Reference the provided image as "the provided image" or "this image"
- Focus on what to add, remove, or modify
- Be concise and specific about placement and style

Enhance this edit instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
      } else if (modelId === 'fal-seedream-v4' || modelId === 'replicate-seedream-4') {
        requestContent = `User wants to edit an image. Their instruction: "${prompt}"
Reference image will be provided.

IMPORTANT: For Seedream 4 image editing:
- Describe the desired transformation artistically
- Focus on scene composition and mood
- Use conceptual language about spatial relationships
- Reference lighting and atmosphere
- Maintain coherence with the provided image

Enhance this edit instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
      } else {
        // Generic image editing
        requestContent = `User wants to edit an image. Their instruction: "${prompt}"
Reference image will be provided.

Enhance this edit instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
      }
    } else {
      // No reference image provided — treat as pure text prompt.
      // If the target is a VIDEO model (e.g., Veo/Gemini video), apply image-to-video best practices.
      const isVideoModel = /veo|video|replicate-video|fal-video|gemini-video/i.test(modelId)
      if (isVideoModel) {
        // Veo 3.x-style guidance (lightweight, common-sense, non-restrictive)
        // Based on Google's docs about image-to-video and reference images
        // https://ai.google.dev/gemini-api/docs/video?authuser=1&example=dialogue
        requestContent = `User's video prompt: "${prompt}"
Please enhance this for a video generation model while keeping the user's intent. Use practical, non-restrictive guidance inspired by Veo best practices:

Include when useful (omit if not relevant):
- A concise storyline or action progression (beginning → middle → end)
- Camera guidance (e.g., wide shot, close-up, slow pan, push-in)
- Visual tone and lighting (e.g., cinematic, soft daylight, moody, golden hour)
- Motion cues (what moves and how: drifting snow, subtle camera sway)
- Composition hints (foreground/background elements; depth; subject focus)
- Duration-aware phrasing (8s feels complete; avoid overstuffing)
- Audio ambiance only if clearly desired (keep subtle)

Avoid:
- Overly rigid shot lists or technical jargon
- Breaking the user's style/subject
- Excessive verbosity

Return ONLY the enhanced prompt text. Nothing else.`
      } else {
        // Text-to-image mode
        requestContent = `User's prompt: "${prompt}"
Please enhance this text-to-image prompt while respecting the user's creative vision.

Guidelines:
- Add helpful details (lighting, camera, framing) if appropriate
- Clarify ambiguous elements
- Keep the original tone and style
- Don't add unnecessary complexity

Return ONLY the enhanced prompt text. Nothing else.`
      }
    }

    // Prepare message content
    const messageContent: any[] = []
    
    if (referenceImage) {
      // Parse data URL to get media type and base64 data
      const [dataUrlPrefix, base64Data] = referenceImage.split(',')
      const mediaTypeMatch = dataUrlPrefix.match(/data:([^;]+)/)
      const mediaType = mediaTypeMatch ? mediaTypeMatch[1] : 'image/jpeg' // Default to JPEG if not detected
      
      // Add image for analysis
      messageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: base64Data,
        },
      })
      messageContent.push({
        type: 'text',
        text: requestContent,
      })
    } else {
      messageContent.push({
        type: 'text',
        text: requestContent,
      })
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: messageContent.length > 1 
            ? messageContent 
            : messageContent[0],
        },
      ],
    })

    // Extract the enhanced prompt from Claude's response
    let enhancedPrompt = 'Failed to enhance prompt'
    
    // Claude returns content as an array - find the text block
    const textBlocks = message.content.filter(block => block.type === 'text')
    if (textBlocks.length > 0 && textBlocks[0].type === 'text') {
      enhancedPrompt = textBlocks[0].text
    }

    return NextResponse.json({
      originalPrompt: prompt,
      enhancedPrompt,
      enhancementPromptId: enhancementPrompt?.id,
    })
  } catch (error: any) {
    console.error('Error enhancing prompt:', error)
    
    if (error.status === 401) {
      return NextResponse.json(
        { error: 'Invalid API key. Please configure ANTHROPIC_API_KEY' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to enhance prompt', details: error.message },
      { status: 500 }
    )
  }
}

