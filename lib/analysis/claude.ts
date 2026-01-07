/**
 * Claude parser for structured extraction from Gemini captions.
 * Takes a raw caption and extracts structured fields for analytics.
 */

import Anthropic from '@anthropic-ai/sdk'

const CLAUDE_MODEL = 'claude-sonnet-4-20250514'

export interface ParsedAnalysis {
  subjects: string[]      // Main subjects (e.g., "woman", "car", "landscape")
  styles: string[]        // Visual styles (e.g., "photorealistic", "cinematic", "anime")
  mood: string | null     // Overall mood (e.g., "dramatic", "peaceful", "energetic")
  keywords: string[]      // General descriptive keywords
  composition: string[]   // Composition notes (e.g., "close-up", "wide shot", "centered")
  lighting: string[]      // Lighting descriptions (e.g., "golden hour", "studio lighting", "moody")
  colors: string[]        // Dominant colors or palette (e.g., "warm tones", "blue", "high contrast")
  motion?: string[]       // For videos: motion descriptions (e.g., "slow pan", "tracking shot")
  quality: string[]       // Quality descriptors (e.g., "high detail", "soft focus", "grainy")
}

export interface ParseResult {
  parsed: ParsedAnalysis
  model: string
}

/**
 * Parse a Gemini caption into structured fields using Claude
 */
export async function parseCaption(
  caption: string,
  context?: {
    fileType?: 'image' | 'video'
    modelId?: string
    prompt?: string
    isApproved?: boolean
    isBookmarked?: boolean
  }
): Promise<ParseResult> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  // Build context string if available
  let contextInfo = ''
  if (context) {
    const parts: string[] = []
    if (context.fileType) parts.push(`Type: ${context.fileType}`)
    if (context.modelId) parts.push(`Model: ${context.modelId}`)
    if (context.prompt) parts.push(`Original prompt: "${context.prompt.slice(0, 200)}${context.prompt.length > 200 ? '...' : ''}"`)
    if (context.isApproved) parts.push('User approved this output')
    if (context.isBookmarked) parts.push('User bookmarked this output')
    if (parts.length > 0) {
      contextInfo = `\n\nContext:\n${parts.join('\n')}`
    }
  }

  const isVideo = context?.fileType === 'video'

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    temperature: 0,
    messages: [
      {
        role: 'user',
        content: `Extract structured information from this AI-generated ${isVideo ? 'video' : 'image'} description. Return ONLY valid JSON matching the schema below.

Description:
${caption}${contextInfo}

JSON Schema:
{
  "subjects": string[],      // Main subjects (people, objects, scenes) - max 5
  "styles": string[],        // Visual/artistic styles - max 3
  "mood": string | null,     // Single word or short phrase for overall mood
  "keywords": string[],      // Key descriptive terms - max 8
  "composition": string[],   // Framing and composition notes - max 3
  "lighting": string[],      // Lighting descriptions - max 3
  "colors": string[],        // Dominant colors or palette - max 5
  ${isVideo ? '"motion": string[],       // Motion and camera movement - max 3\n  ' : ''}"quality": string[]        // Technical quality descriptors - max 3
}

Rules:
- Use lowercase for all values
- Be specific but concise (1-3 words per item)
- Only include fields you can confidently extract
- Return empty arrays [] if nothing matches a category
- Return null for mood if unclear

Respond with ONLY the JSON object, no explanation.`,
      },
    ],
  })

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  // Parse JSON from response
  const jsonText = textBlock.text.trim()
  let parsed: ParsedAnalysis

  try {
    // Try to extract JSON if wrapped in code blocks
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, jsonText]
    parsed = JSON.parse(jsonMatch[1] || jsonText)
  } catch (parseError) {
    throw new Error(`Failed to parse Claude response as JSON: ${jsonText.slice(0, 200)}`)
  }

  // Validate and normalize the parsed result
  const normalized: ParsedAnalysis = {
    subjects: Array.isArray(parsed.subjects) ? parsed.subjects.slice(0, 5) : [],
    styles: Array.isArray(parsed.styles) ? parsed.styles.slice(0, 3) : [],
    mood: typeof parsed.mood === 'string' ? parsed.mood : null,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 8) : [],
    composition: Array.isArray(parsed.composition) ? parsed.composition.slice(0, 3) : [],
    lighting: Array.isArray(parsed.lighting) ? parsed.lighting.slice(0, 3) : [],
    colors: Array.isArray(parsed.colors) ? parsed.colors.slice(0, 5) : [],
    quality: Array.isArray(parsed.quality) ? parsed.quality.slice(0, 3) : [],
  }

  // Add motion for videos
  if (isVideo && Array.isArray(parsed.motion)) {
    normalized.motion = parsed.motion.slice(0, 3)
  }

  return {
    parsed: normalized,
    model: CLAUDE_MODEL,
  }
}

