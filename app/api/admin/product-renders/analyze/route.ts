import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

interface ImageToAnalyze {
  id: string // temporary client-side ID
  base64: string // data URL
  filename?: string
}

interface AnalyzedImage {
  id: string
  suggestedColorway: string
  suggestedAngle: string
  colorDescription: string
  confidence: number
}

interface AnalysisResult {
  images: AnalyzedImage[]
  suggestedColorways: string[]
}

/**
 * POST /api/admin/product-renders/analyze
 * 
 * Use Claude Vision to analyze uploaded product render images
 * and suggest colorway groupings based on visual analysis
 * 
 * Body:
 *   - images: Array of { id, base64, filename? }
 *   - productName: Optional product name for context
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const profile = await prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    })

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { images, productName } = body as { images: ImageToAnalyze[], productName?: string }

    if (!images || images.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 })
    }

    if (images.length > 50) {
      return NextResponse.json({ error: 'Maximum 50 images per batch' }, { status: 400 })
    }

    console.log(`[analyze] Analyzing ${images.length} images for colorway detection`)

    // Build the message content with all images
    const content: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: 'text',
        text: `You are analyzing product render images to detect and group them by colorway (color variant).

${productName ? `Product: ${productName}` : 'Product: Unknown'}

For each image, identify:
1. The colorway/color scheme (e.g., "Papaya Orange", "Monaco Blue", "Stealth Black", "Gulf Heritage")
2. The viewing angle (e.g., "front", "side", "rear", "3/4 front", "3/4 rear", "top", "detail")
3. A brief color description

Group similar colors together - images with the same or very similar color schemes should have the same colorway name.

Respond with a JSON object in this exact format:
{
  "images": [
    {
      "id": "image_id_here",
      "suggestedColorway": "Colorway Name",
      "suggestedAngle": "front|side|rear|3/4 front|3/4 rear|top|detail|other",
      "colorDescription": "Brief description of main colors",
      "confidence": 0.0-1.0
    }
  ],
  "suggestedColorways": ["List", "Of", "Unique", "Colorways"]
}

IMPORTANT: 
- Use descriptive, professional colorway names (not just "red" or "blue")
- Group visually similar colors under the same colorway name
- The "id" must match exactly the id provided for each image
- Confidence should be high (0.8+) for clear colors, lower for ambiguous cases`
      }
    ]

    // Add each image to the content
    for (const image of images) {
      // Extract base64 data from data URL
      const base64Match = image.base64.match(/^data:image\/([^;]+);base64,(.+)$/)
      if (!base64Match) {
        console.warn(`[analyze] Invalid image format for ${image.id}`)
        continue
      }

      const [, mediaType, base64Data] = base64Match
      
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: `image/${mediaType}` as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: base64Data,
        },
      })

      content.push({
        type: 'text',
        text: `Image ID: ${image.id}${image.filename ? ` (filename: ${image.filename})` : ''}`
      })
    }

    // Call Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content,
        }
      ],
    })

    // Extract JSON from response
    const responseText = response.content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')

    // Parse JSON from response (handle markdown code blocks)
    let analysisResult: AnalysisResult
    try {
      // Try to extract JSON from potential markdown code block
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/) || 
                        responseText.match(/\{[\s\S]*\}/)
      
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0]
      analysisResult = JSON.parse(jsonStr.trim())
    } catch (parseError) {
      console.error('[analyze] Failed to parse Claude response:', responseText)
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      )
    }

    // Validate and clean up results
    const validatedImages = analysisResult.images.map(img => ({
      id: img.id,
      suggestedColorway: img.suggestedColorway || 'Default',
      suggestedAngle: img.suggestedAngle || 'front',
      colorDescription: img.colorDescription || '',
      confidence: Math.min(1, Math.max(0, img.confidence || 0.5)),
    }))

    // Get unique colorways
    const uniqueColorways = Array.from(
      new Set(validatedImages.map(img => img.suggestedColorway))
    ).sort()

    console.log(`[analyze] Detected ${uniqueColorways.length} colorways: ${uniqueColorways.join(', ')}`)

    return NextResponse.json({
      images: validatedImages,
      suggestedColorways: uniqueColorways,
      totalImages: images.length,
      analyzedImages: validatedImages.length,
    })
  } catch (error: any) {
    console.error('[analyze] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to analyze images' },
      { status: 500 }
    )
  }
}

