/**
 * Sigil generate: produce a LayoutSpec for a base image + creative intent.
 * Uses visual analysis, optional layout-space navigation, and Claude to output validated LayoutSpec.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import Anthropic from '@anthropic-ai/sdk'
import {
  analyzeBaseImage,
  navigateLayoutSpace,
  LayoutSpaceIndex,
  getSocialCreativeSpec,
  type CreativeIntent,
  type LayoutSpec,
  type LayoutDNA,
} from '@/lib/sigil'
import { validateLayoutSpec } from '@/lib/sigil/interpret'
import { prisma } from '@/lib/prisma'

const CLAUDE_MODEL = process.env.ANTHROPIC_ANALYSIS_MODEL || 'claude-sonnet-4-5-20250929'

export interface SigilGenerateBody {
  /** Vesper output id (to resolve base image URL). */
  outputId?: string
  /** Or direct image URL. */
  imageUrl?: string
  /** Creative intent (CTA, format, channel, etc.). */
  intent: CreativeIntent
  /** Optional: pre-computed LayoutDNA index entries (from ingestion) to guide layout. */
  candidateDnas?: LayoutDNA[]
}

export async function POST(request: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies })
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: SigilGenerateBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { outputId, imageUrl, intent, candidateDnas } = body
  if (!intent?.cta || !intent?.formatId) {
    return NextResponse.json(
      { error: 'Missing required intent fields: cta, formatId' },
      { status: 400 }
    )
  }

  let baseImageUrl: string
  if (imageUrl) {
    baseImageUrl = imageUrl
  } else if (outputId) {
    const output = await prisma.output.findUnique({
      where: { id: outputId },
      select: { fileUrl: true, fileType: true },
    })
    if (!output || output.fileType !== 'image') {
      return NextResponse.json(
        { error: 'Output not found or not an image' },
        { status: 404 }
      )
    }
    baseImageUrl = output.fileUrl.startsWith('http') ? output.fileUrl : `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')}/storage/v1/object/public/${output.fileUrl}`
  } else {
    return NextResponse.json(
      { error: 'Provide either outputId or imageUrl' },
      { status: 400 }
    )
  }

  const creativeSpec = getSocialCreativeSpec(intent.formatId)
  if (!creativeSpec) {
    return NextResponse.json(
      { error: `Unsupported formatId: ${intent.formatId}` },
      { status: 400 }
    )
  }

  const { widthPx, heightPx, safeZone } = creativeSpec.platformFormat

  try {
    const visualAnalysis = await analyzeBaseImage(baseImageUrl)

    const index = new LayoutSpaceIndex()
    if (candidateDnas?.length) index.addMany(candidateDnas)
    const candidates = index.size() > 0 ? navigateLayoutSpace(index, intent, { k: 3 }) : []

    const candidateSummary =
      candidates.length > 0
        ? candidates
            .map(
              (e) =>
                `- textDensity=${e.dna.structural.textDensity.toFixed(2)} ctaProminence=${e.dna.structural.ctaProminence.toFixed(2)} hierarchyDepth=${e.dna.structural.hierarchyDepth} layoutFamily=${e.dna.categorical.layoutFamily}`
            )
            .join('\n')
        : 'No reference layouts provided; use platform safe zones and brand rules only.'

    const systemPrompt = `You are the Sigil social layouting agent. You output a single JSON object that is a valid LayoutSpec: version, formatId, widthPx, heightPx, textBlocks[], safeZone (optional), rationale, confidence (0-1), createdAt.

Rules:
- All bbox values (x, y, width, height) are normalized 0-1. Safe zone for ${intent.formatId}: top ${safeZone.topPx}px bottom ${safeZone.bottomPx}px left ${safeZone.leftPx}px right ${safeZone.rightPx}px. So keep text blocks inside: y >= ${(safeZone.topPx / heightPx).toFixed(3)}, y+height <= ${(1 - safeZone.bottomPx / heightPx).toFixed(3)}, x >= ${(safeZone.leftPx / widthPx).toFixed(3)}, x+width <= ${(1 - safeZone.rightPx / widthPx).toFixed(3)}.
- Fonts: Avantt for headline, Space Grotesk for body/CTA. Colors: use hex e.g. #1A1A1A or #FFFFFF; ensure contrast.
- CTA minimum ~0.08 height in normalized terms for tap target; legal text scale at least 0.65.
- Prefer placing text in negative space regions; avoid covering the focal point (primary at ${JSON.stringify(visualAnalysis.focalPointMap.primary)}).
- Return ONLY the JSON object, no markdown.`

    const userPrompt = `Creative intent:
- CTA: ${intent.cta}
- Headline: ${intent.headline ?? '(none)'}
- Body: ${intent.body ?? '(none)'}
- Legal: ${intent.legalText ?? '(none)'}
- Channel: ${intent.channel} Format: ${intent.formatId} Language: ${intent.language}
- Tone: ${intent.tone ?? 'neutral'}

Reference layout cues (match style, not copy):
${candidateSummary}

Negative space regions (prefer for text): ${JSON.stringify(visualAnalysis.negativeSpaceRegions.slice(0, 3))}

Generate the LayoutSpec JSON now.`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    const rawText = textBlock?.type === 'text' ? textBlock.text : ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    const spec: LayoutSpec = JSON.parse(jsonMatch ? jsonMatch[0] : rawText)

    spec.widthPx = widthPx
    spec.heightPx = heightPx
    spec.formatId = intent.formatId
    spec.safeZone = {
      topPx: safeZone.topPx,
      bottomPx: safeZone.bottomPx,
      leftPx: safeZone.leftPx,
      rightPx: safeZone.rightPx,
    }
    spec.createdAt = new Date().toISOString()

    let validation = validateLayoutSpec(spec, intent.formatId)
    let repairs = 0
    while (!validation.valid && repairs < 2) {
      const repairPrompt = `This LayoutSpec has violations. Fix them and return the corrected JSON only.

Violations:
${validation.violations.join('\n')}

Current spec:
${JSON.stringify(spec, null, 2)}`
      const repairRes = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        temperature: 0,
        messages: [{ role: 'user', content: repairPrompt }],
      })
      const repairBlock = repairRes.content.find((b) => b.type === 'text')
      const repairText = repairBlock && repairBlock.type === 'text' ? repairBlock.text : ''
      const repairMatch = repairText.match(/\{[\s\S]*\}/)
      if (repairMatch) {
        Object.assign(spec, JSON.parse(repairMatch[0]))
        spec.widthPx = widthPx
        spec.heightPx = heightPx
        spec.formatId = intent.formatId
      }
      validation = validateLayoutSpec(spec, intent.formatId)
      repairs++
    }

    return NextResponse.json({
      spec,
      valid: validation.valid,
      violations: validation.violations,
      visualAnalysis: {
        focalPoint: visualAnalysis.focalPointMap.primary,
        negativeSpaceRegions: visualAnalysis.negativeSpaceRegions.length,
      },
    })
  } catch (e) {
    console.error('[Sigil] generate error:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Sigil generation failed' },
      { status: 500 }
    )
  }
}
