/**
 * Ad decomposer: turns a historical social ad image into a LayoutDNA vector.
 * Uses vision model for structure extraction and maps to schema.
 */

import type {
  LayoutDNA,
  LayoutDNAStructural,
  LayoutDNACategorical,
  LayoutDNAGeometric,
  LayoutDNATypographic,
  TextAnchorZone,
  TextBlockRole,
  LayoutFamily,
  NormalizedBBox,
} from '../schema/layoutDNA'
import { createBlankLayoutDNA } from '../schema/layoutDNA'

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'gemini-2.0-flash'

export interface DecomposeInput {
  imageUrl: string
  sourceAssetId: string
  sourceType: 'frontify' | 'figma'
  /** Optional metadata from Frontify (tags, title) for categorical fill. */
  metadata?: {
    tags?: string[]
    title?: string
    channel?: string
    aspectRatio?: string
    language?: string
    campaignObjective?: string
  }
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const base64 = buffer.toString('base64')
  let mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
  if (mimeType === 'application/octet-stream') {
    const ext = url.split('.').pop()?.toLowerCase()
    if (ext === 'png') mimeType = 'image/png'
    else if (ext === 'webp') mimeType = 'image/webp'
  }
  return { base64, mimeType }
}

/** Raw structure returned by the vision model (we parse JSON from response). */
interface VisionLayoutStructure {
  textBlocks?: Array<{
    role: string
    bbox: { x: number; y: number; width: number; height: number }
    charCount?: number
    scaleTier?: number
  }>
  focalPoint?: { x: number; y: number }
  layoutFamily?: string
  textDensity?: number
  ctaProminence?: number
  whitespaceRatio?: number
  hierarchyDepth?: number
  visualDominanceRatio?: number
  headlineScale?: number
  bodyScale?: number
  negativeSpaceDistribution?: { top: number; bottom: number; left: number; right: number }
}

const ROLE_MAP: Record<string, TextBlockRole> = {
  headline: 'headline',
  subhead: 'subhead',
  body: 'body',
  cta: 'cta',
  legal: 'legal',
  'product-name': 'product-name',
  other: 'other',
}

const LAYOUT_FAMILY_MAP: Record<string, LayoutFamily> = {
  'top-heavy': 'top-heavy',
  'centered': 'centered',
  'l-shaped': 'l-shaped',
  'full-bleed': 'full-bleed',
  'split': 'split',
  'minimal': 'minimal',
  'grid': 'grid',
  other: 'other',
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Decompose a single social ad image into LayoutDNA.
 */
export async function decomposeAdToLayoutDNA(input: DecomposeInput): Promise<LayoutDNA> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')

  const { base64, mimeType } = await fetchImageAsBase64(input.imageUrl)

  const prompt = `This image is a finished social media ad (with text and visuals already composed). Analyze its LAYOUT structure only.

Return a single JSON object, no markdown, with this exact structure:
{
  "textBlocks": [
    { "role": "headline"|"subhead"|"body"|"cta"|"legal"|"product-name"|"other", "bbox": { "x": number, "y": number, "width": number, "height": number }, "charCount": number, "scaleTier": number }
  ],
  "focalPoint": { "x": number, "y": number },
  "layoutFamily": "top-heavy"|"centered"|"l-shaped"|"full-bleed"|"split"|"minimal"|"grid"|"other",
  "textDensity": number,
  "ctaProminence": number,
  "whitespaceRatio": number,
  "hierarchyDepth": number,
  "visualDominanceRatio": number,
  "headlineScale": number,
  "bodyScale": number,
  "negativeSpaceDistribution": { "top": number, "bottom": number, "left": number, "right": number }
}

Rules:
- All bbox and coordinates are normalized 0-1 (0,0 = top-left).
- textBlocks: every visible text block with its role and bounding box. Estimate charCount and scaleTier (1=largest).
- textDensity, ctaProminence, whitespaceRatio, visualDominanceRatio: 0-1.
- hierarchyDepth: number of distinct text sizes (e.g. 1-4).
- negativeSpaceDistribution: proportion of empty space in each quadrant (four numbers summing to 1).`

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }] },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
        },
      }),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini ad decomposition error: ${err}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('No response from Gemini ad decomposition')

  let raw: VisionLayoutStructure
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON from ad decomposition')
  }

  const meta = input.metadata ?? {}
  const dna = createBlankLayoutDNA(input.sourceAssetId, input.sourceType)

  const textBlocks = raw.textBlocks ?? []
  const textAnchorZones: TextAnchorZone[] = textBlocks.map((b) => ({
    role: ROLE_MAP[b.role] ?? 'other',
    bbox: {
      x: clamp01(b.bbox.x),
      y: clamp01(b.bbox.y),
      width: clamp01(b.bbox.width),
      height: clamp01(b.bbox.height),
    },
    charCount: b.charCount,
    scaleTier: b.scaleTier,
  }))

  const structural: LayoutDNAStructural = {
    textDensity: clamp01(raw.textDensity ?? 0.2),
    ctaProminence: clamp01(raw.ctaProminence ?? 0.5),
    whitespaceRatio: clamp01(raw.whitespaceRatio ?? 0.5),
    hierarchyDepth: Math.max(0, Math.min(5, Math.round(raw.hierarchyDepth ?? 1))),
    visualDominanceRatio: clamp01(raw.visualDominanceRatio ?? 0.5),
    textBlockCount: textAnchorZones.length,
    negativeSpaceDistribution: raw.negativeSpaceDistribution
      ? {
          top: clamp01(raw.negativeSpaceDistribution.top),
          bottom: clamp01(raw.negativeSpaceDistribution.bottom),
          left: clamp01(raw.negativeSpaceDistribution.left),
          right: clamp01(raw.negativeSpaceDistribution.right),
        }
      : undefined,
  }

  const focal = raw.focalPoint ?? { x: 0.5, y: 0.5 }
  const categorical: LayoutDNACategorical = {
    channel: meta.channel ?? 'unknown',
    aspectRatio: meta.aspectRatio ?? '1:1',
    campaignObjective: meta.campaignObjective,
    language: meta.language,
    layoutFamily: LAYOUT_FAMILY_MAP[raw.layoutFamily ?? ''] ?? 'other',
  }

  const geometric: LayoutDNAGeometric = {
    textAnchorZones,
    focalRegionOffset: {
      x: focal.x - 0.5,
      y: focal.y - 0.5,
    },
  }

  const typographic: LayoutDNATypographic = {
    headlineScale: Math.max(0.5, Math.min(2, raw.headlineScale ?? 1)),
    bodyScale: Math.max(0.5, Math.min(1.5, raw.bodyScale ?? 0.75)),
  }

  dna.structural = structural
  dna.categorical = categorical
  dna.geometric = geometric
  dna.typographic = typographic
  dna.metadata = {
    title: meta.title,
    tags: meta.tags,
  }

  return dna
}
