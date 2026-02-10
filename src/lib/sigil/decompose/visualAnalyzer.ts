/**
 * Visual analyzer for base images (Vesper output).
 * Extracts focal point, negative space map, and product region for layout placement.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const MODEL = 'gemini-2.0-flash'

export interface FocalPointMap {
  /** Normalized 0-1 x,y of main focal point (e.g. product or hero). */
  primary: { x: number; y: number }
  /** Optional secondary focal points. */
  secondary?: Array<{ x: number; y: number }>
}

export interface NegativeSpaceRegion {
  /** Normalized bbox where text could be placed without occluding key content. */
  bbox: { x: number; y: number; width: number; height: number }
  /** Rough quality: high = clean background, low = overlaps edges of subject. */
  quality: 'high' | 'medium' | 'low'
}

export interface VisualAnalysisResult {
  focalPointMap: FocalPointMap
  /** Regions suitable for text overlay (ranked by suitability). */
  negativeSpaceRegions: NegativeSpaceRegion[]
  /** Optional: main product/subject bbox to avoid (normalized 0-1). */
  productRegionBbox?: { x: number; y: number; width: number; height: number }
  /** Dominant color zones (e.g. for contrast decisions). */
  dominantColors?: Array<{ hex: string; areaRatio: number }>
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

/**
 * Analyze a base image (e.g. Vesper-generated visual) for layout placement.
 */
export async function analyzeBaseImage(imageUrl: string): Promise<VisualAnalysisResult> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured')

  const { base64, mimeType } = await fetchImageAsBase64(imageUrl)

  const prompt = `You are analyzing a social ad base image (background/hero visual). No text has been placed yet.

Return a JSON object only, no markdown or explanation, with this exact structure:
{
  "focalPointMap": {
    "primary": { "x": number, "y": number },
    "secondary": [{ "x": number, "y": number }]
  },
  "negativeSpaceRegions": [
    { "bbox": { "x": number, "y": number, "width": number, "height": number }, "quality": "high"|"medium"|"low" }
  ],
  "productRegionBbox": { "x": number, "y": number, "width": number, "height": number } or null,
  "dominantColors": [{ "hex": "#RRGGBB", "areaRatio": number }]
}

Rules:
- All coordinates are normalized 0-1 (0,0 = top-left, 1,1 = bottom-right).
- primary: center of the main subject or most eye-catching element.
- negativeSpaceRegions: list up to 5 regions where text could be placed without covering the main subject. Order by suitability (best first). quality "high" = clear empty area.
- productRegionBbox: if there is a clear product or hero subject, its bounding box; otherwise null.
- dominantColors: up to 5 dominant colors with approximate area ratio (sum ≤ 1).`

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      }),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini visual analysis error: ${err}`)
  }

  const data = await response.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('No response from Gemini visual analysis')

  const parsed = JSON.parse(text) as VisualAnalysisResult
  if (!parsed.focalPointMap?.primary) {
    parsed.focalPointMap = { primary: { x: 0.5, y: 0.5 } }
  }
  if (!Array.isArray(parsed.negativeSpaceRegions)) {
    parsed.negativeSpaceRegions = []
  }
  return parsed
}
