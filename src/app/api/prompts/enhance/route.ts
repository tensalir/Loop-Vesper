import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'
import { getSkillSystemPrompt } from '@/lib/skills/registry'
import { getModelConfig } from '@/lib/models/registry'

// Default to Sonnet 4.5 - configurable via ANTHROPIC_PROMPT_ENHANCE_MODEL env var
const DEFAULT_PROMPT_ENHANCE_MODEL = 'claude-sonnet-4-5-20250929'

export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { prompt, modelId, referenceImage } = await request.json()

    if (!prompt || !modelId) {
      return NextResponse.json(
        { error: 'Prompt and modelId are required' },
        { status: 400 }
      )
    }

    const userPrompt = (typeof prompt === 'string' ? prompt : String(prompt)).trim()
    const isPromptRequest =
      /\b(?:give me|write|generate|create|make)\b[\s\S]{0,80}\bprompt\b/i.test(userPrompt) ||
      /\bnano\s*banana\s+prompt\b/i.test(userPrompt)
    
    // Detect style reference requests - when user says "style reference", "style ref", "as a style", "for style", etc.
    const wantsStyleReference =
      /\bstyle\s*ref(?:erence)?\b/i.test(userPrompt) ||
      /\buse\s+(?:this|the|it)\s+(?:image|pic|photo|as)?\s*(?:as\s+)?(?:a\s+)?style\b/i.test(userPrompt) ||
      /\bfor\s+(?:the\s+)?style\b/i.test(userPrompt) ||
      /\b(?:this|the)\s+style\b/i.test(userPrompt) ||
      /\bstyle\s+(?:from|of)\s+(?:this|the)\b/i.test(userPrompt)
    
    // CRITICAL: Style reference = STYLE-ONLY by default
    // Only use full reference (with composition) if user EXPLICITLY asks for it
    const wantsFullReference =
      /\b(?:recreate|copy|replicate|match|maintain|keep)\s+(?:the\s+)?(?:composition|layout|scene|setup|arrangement)\b/i.test(userPrompt) ||
      /\bsame\s+(?:composition|layout|scene|setup)\b/i.test(userPrompt) ||
      /\bsimilar\s+scene\b/i.test(userPrompt)
    
    // Style-only is the DEFAULT for any style reference request (unless full reference explicitly requested)
    const wantsStyleOnly = wantsStyleReference && !wantsFullReference

    // Determine whether the selected model is a VIDEO model (motion prompt) or IMAGE model.
    // This is the key nuance for the Animate Still panel: even though an image is attached,
    // the prompt to enhance is ALWAYS a motion prompt when the target model is video.
    const selectedModelConfig = getModelConfig(modelId)
    const isVideoModel =
      selectedModelConfig?.type === 'video' ||
      /veo|video|replicate-video|fal-video|gemini-video/i.test(modelId)

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

    // Get system prompt: use database override first, then Claude Skill, then fallback
    let systemPrompt: string
    
    if (enhancementPrompt) {
      // Database override takes precedence
      systemPrompt = enhancementPrompt.systemPrompt
    } else {
      // Try to load from Claude Skill file
      const skillPrompt = getSkillSystemPrompt('genai-prompting')
      if (skillPrompt) {
        systemPrompt = skillPrompt
      } else {
        // Final fallback (should not normally be reached)
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
    }

    // Initialize Claude client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    })

    // Build the enhancement request with model-specific guidance
    let requestContent: string
    
    if (referenceImage) {
      if (isVideoModel) {
        requestContent = `User is animating a still image into a video. User's motion prompt: "${userPrompt}"
Reference image will be provided (treat it as frame 1).

Enhance this as an image-to-video / motion prompt (aligned with our motion prompt guidelines and Veo-style best practices):
- Do NOT write a Nano Banana image prompt and do NOT start with "Using the attached image as a style reference...".
- Treat the reference image as the initial frame; do NOT re-describe the full scene in detail.
- Describe ONLY what changes over time: subject motion, environmental motion, camera behavior, pacing/timing.
- Preserve the reference image's style, composition, lighting, and subject identity unless the user explicitly requests changes.
- Keep it as ONE coherent shot idea suitable for ~4–8 seconds (avoid rigid multi-shot lists).
- Include audio ambience / SFX / dialogue ONLY if the user explicitly asks for audio; otherwise omit audio.

Return ONLY the enhanced motion prompt text.`
      } else if (modelId === 'gemini-nano-banana-pro') {
        // Determine the appropriate prefix based on reference type
        let requiredPrefix: string
        if (wantsStyleOnly) {
          requiredPrefix = 'Using the attached image ONLY as a style reference—extract its '
        } else if (wantsStyleReference) {
          requiredPrefix = 'Using the attached image as a style reference for its '
        } else {
          requiredPrefix = 'Using the attached image, '
        }

        if (isPromptRequest) {
          if (wantsStyleOnly) {
            // STYLE-ONLY: Extract only visual aesthetic, NOT composition
            requestContent = `User is asking you to WRITE a Nano Banana prompt using the provided image ONLY for its visual STYLE.

User's request: "${userPrompt}"
Reference image will be provided.

CRITICAL STYLE-ONLY REQUIREMENTS:
- Return ONLY ONE prompt. No titles, no lists, no quotes, no code fences.
- The prompt MUST start with: "${requiredPrefix}"

EXTRACT from reference image (visual treatment only):
- Color grading / color palette / tonal range (be specific: "moody blue-grey", "warm amber highlights")
- Lighting quality (soft/hard, direction, temperature, diffusion)
- Atmosphere / mood / emotional tone
- Texture / grain / processing style
- Contrast levels, shadow and highlight treatment
- Depth rendering / atmospheric perspective feel

BLOCK these compositional elements (BE EXPLICIT):
- Look at the image and identify the MAIN SUBJECTS (people, mountains, tents, animals, vehicles, etc.)
- You MUST tell the model: "Do NOT reproduce [list the subjects you see]"
- Also block: scene layout, spatial arrangement, poses, object placement

REQUIRED PROMPT STRUCTURE:
1. Start with: "${requiredPrefix}"
2. Describe the specific visual qualities you extract from the reference
3. Add an EXPLICIT blocking statement: "IMPORTANT: Do NOT reproduce the [subjects/objects you see]. Do NOT copy the scene composition or spatial layout."
4. Then describe the user's NEW subject/scene: "Apply this visual style to: [user's completely different subject]"
5. End with: "Create a fresh composition appropriate for this new subject."

Terminology:
- "Nano Banana" is Gemini's model nickname. Do NOT introduce literal bananas unless the user explicitly requested bananas.

Return ONLY the prompt text.`
          } else {
            // Standard style reference (may include compositional elements)
            requestContent = `User is asking you to WRITE a final Nano Banana prompt that uses the provided reference image.
User's request: "${userPrompt}"
Reference image will be provided.

CRITICAL REQUIREMENTS:
- Return ONLY ONE prompt. No titles, no lists, no quotes, no code fences.
- The prompt MUST start with: "${requiredPrefix}"
- Immediately after that prefix, include the specific visual qualities you observe in the reference image (color palette, lighting, mood, composition, texture).
- Then describe the new scene/composition/angles the user wants (keep it coherent and specific).

Terminology:
- "Nano Banana" is Gemini's model nickname. Do NOT introduce literal bananas unless the user explicitly requested bananas in the image.

Return ONLY the prompt text.`
          }
        } else {
          requestContent = `User wants to edit an image. Their instruction: "${userPrompt}"
Reference image will be provided.

IMPORTANT: For Nano Banana Pro image editing:
- Return ONLY the enhanced edit instruction (no explanations, no labels, no quotes, no code fences)
- Start with: "${requiredPrefix}"
- Describe exactly what to change AND what to preserve
- Use precise, action-oriented language and specific placement
- Keep the original style/lighting unless the user asks to change it
- "Nano Banana" is a model nickname. Do NOT introduce literal bananas unless explicitly requested

Enhance this instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
        }
      } else if (modelId === 'fal-seedream-v4' || modelId === 'replicate-seedream-4') {
        requestContent = `User wants to edit an image. Their instruction: "${userPrompt}"
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
        requestContent = `User wants to edit an image. Their instruction: "${userPrompt}"
Reference image will be provided.

Enhance this edit instruction to be clearer and more effective. Return ONLY the enhanced edit instruction.`
      }
    } else {
      // No reference image provided — treat as pure text prompt.
      if (isVideoModel) {
        // Veo 3.x-style guidance (lightweight, common-sense, non-restrictive)
        // Based on Google's docs about image-to-video and reference images
        // https://ai.google.dev/gemini-api/docs/video?authuser=1&example=dialogue
        requestContent = `User's video prompt: "${userPrompt}"
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
        requestContent = `User's prompt: "${userPrompt}"
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
      model: process.env.ANTHROPIC_PROMPT_ENHANCE_MODEL || DEFAULT_PROMPT_ENHANCE_MODEL,
      max_tokens: 2000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: messageContent, // Always send as array - Anthropic API requires this
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

    // Strip markdown code blocks if Claude wrapped the response in them
    // Handles both ``` and ```language formats
    enhancedPrompt = enhancedPrompt
      .replace(/^```[\w]*\n?/gm, '')  // Remove opening ``` or ```language
      .replace(/\n?```$/gm, '')        // Remove closing ```
      .trim()

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

