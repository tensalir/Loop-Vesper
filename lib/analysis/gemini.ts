/**
 * Gemini captioner for semantic analysis of images and videos.
 * Uses Gemini multimodal to generate concise descriptions.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

// Models for captioning
const IMAGE_CAPTION_MODEL = 'gemini-2.0-flash' // Fast, good at image understanding
const VIDEO_CAPTION_MODEL = 'gemini-2.0-flash' // Also supports video

export interface CaptionResult {
  caption: string
  model: string
}

/**
 * Fetch file bytes from a URL and convert to base64
 */
async function fetchFileAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  const base64 = buffer.toString('base64')

  // Detect mime type from response or URL
  let mimeType = response.headers.get('content-type') || 'application/octet-stream'
  
  // Clean up mime type (remove charset etc)
  mimeType = mimeType.split(';')[0].trim()

  // Fallback detection from URL extension
  if (mimeType === 'application/octet-stream') {
    const ext = url.split('.').pop()?.toLowerCase()
    if (ext === 'mp4' || ext === 'webm') mimeType = 'video/mp4'
    else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg'
    else if (ext === 'png') mimeType = 'image/png'
    else if (ext === 'gif') mimeType = 'image/gif'
    else if (ext === 'webp') mimeType = 'image/webp'
  }

  return { base64, mimeType }
}

/**
 * Caption an image using Gemini multimodal
 */
export async function captionImage(imageUrl: string): Promise<CaptionResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  // Fetch image bytes
  const { base64, mimeType } = await fetchFileAsBase64(imageUrl)

  // Call Gemini API
  const endpoint = `${GEMINI_BASE_URL}/models/${IMAGE_CAPTION_MODEL}:generateContent?key=${GEMINI_API_KEY}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
            {
              text: `Describe this image in detail. Include:
- The main subject(s) and what they are doing
- Visual style (photorealistic, illustration, 3D render, etc.)
- Composition and framing
- Lighting and mood
- Colors and color palette
- Any notable artistic or technical qualities

Be concise but thorough. Respond with just the description, no preamble.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const caption = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!caption) {
    throw new Error('No caption generated from Gemini')
  }

  return {
    caption: caption.trim(),
    model: IMAGE_CAPTION_MODEL,
  }
}

/**
 * Caption a video using Gemini multimodal
 * Note: Gemini 2.0 supports direct video input
 */
export async function captionVideo(videoUrl: string): Promise<CaptionResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY not configured')
  }

  // Fetch video bytes
  const { base64, mimeType } = await fetchFileAsBase64(videoUrl)

  // Video file size check (Gemini has limits)
  const fileSizeMB = (base64.length * 3) / 4 / (1024 * 1024)
  if (fileSizeMB > 20) {
    throw new Error(`Video file too large for inline upload (${fileSizeMB.toFixed(1)}MB). Max ~20MB.`)
  }

  // Call Gemini API
  const endpoint = `${GEMINI_BASE_URL}/models/${VIDEO_CAPTION_MODEL}:generateContent?key=${GEMINI_API_KEY}`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
            {
              text: `Describe this video in detail. Include:
- What happens in the video (action, narrative, motion)
- The main subject(s) and setting
- Visual style (cinematic, documentary, animation, etc.)
- Camera movement and composition
- Lighting and mood
- Pacing and rhythm
- Colors and visual atmosphere
- Any notable artistic or technical qualities

Be concise but thorough. Respond with just the description, no preamble.`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 600,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini API error (${response.status}): ${errorText}`)
  }

  const data = await response.json()
  const caption = data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!caption) {
    throw new Error('No caption generated from Gemini')
  }

  return {
    caption: caption.trim(),
    model: VIDEO_CAPTION_MODEL,
  }
}

/**
 * Caption an output based on its file type
 */
export async function captionOutput(
  fileUrl: string,
  fileType: 'image' | 'video'
): Promise<CaptionResult> {
  if (fileType === 'video') {
    return captionVideo(fileUrl)
  }
  return captionImage(fileUrl)
}

