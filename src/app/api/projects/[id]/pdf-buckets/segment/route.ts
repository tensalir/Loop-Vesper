import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CLAUDE_MODEL = process.env.ANTHROPIC_ANALYSIS_MODEL || 'claude-sonnet-4-5-20250929'

/**
 * POST /api/projects/[id]/pdf-buckets/segment
 *
 * Accept a rendered PDF page image and use Claude vision to identify
 * distinct visual regions (photographs, illustrations, diagrams, logos)
 * worth extracting as reference images.
 *
 * Returns an array of crop regions with coordinates and labels.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Segmentation not configured' }, { status: 503 })
    }

    const formData = await request.formData()
    const imageFile = formData.get('image') as File | null
    if (!imageFile) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    const arrayBuffer = await imageFile.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const mediaType = imageFile.type.startsWith('image/')
      ? imageFile.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
      : 'image/png'

    const anthropic = new Anthropic({ apiKey })

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `This is a rendered page from a PDF briefing document. Identify all distinct visual elements that could be used as reference images for creative projects (photographs, illustrations, mood images, product shots, diagrams, UI screenshots, color swatches). Ignore text-only areas, headers, footers, and page numbers.

For each visual element, return its bounding box as pixel coordinates relative to the image dimensions.

Return ONLY valid JSON:
{
  "regions": [
    {
      "x": <left pixel>,
      "y": <top pixel>,
      "width": <width in pixels>,
      "height": <height in pixels>,
      "label": "<1-3 word description>",
      "confidence": <0.0-1.0>
    }
  ]
}

If no visual elements are found, return: { "regions": [] }`,
            },
          ],
        },
      ],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ regions: [] })
    }

    let parsed: any
    try {
      const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[1] : textBlock.text.trim())
    } catch {
      return NextResponse.json({ regions: [] })
    }

    const regions = Array.isArray(parsed?.regions)
      ? parsed.regions
          .filter(
            (r: any) =>
              typeof r.x === 'number' &&
              typeof r.y === 'number' &&
              typeof r.width === 'number' &&
              typeof r.height === 'number' &&
              r.width >= 32 &&
              r.height >= 32
          )
          .map((r: any) => ({
            x: Math.max(0, Math.round(r.x)),
            y: Math.max(0, Math.round(r.y)),
            width: Math.round(r.width),
            height: Math.round(r.height),
            label: typeof r.label === 'string' ? r.label.slice(0, 48) : 'image',
            confidence: typeof r.confidence === 'number' ? r.confidence : 0.5,
          }))
      : []

    return NextResponse.json({ regions })
  } catch (error: any) {
    console.error('PDF segmentation error:', error)
    return NextResponse.json({ error: 'Segmentation failed' }, { status: 500 })
  }
}
