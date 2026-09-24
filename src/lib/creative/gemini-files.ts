/**
 * Gemini's Files API: a pinned reference uploaded once, then attached to every
 * grade and draw by its URI instead of being sent inline each time.
 *
 * The resumable protocol, two requests: `start` returns an upload URL,
 * `upload, finalize` sends the bytes and returns the file with its URI and
 * expiry (Google keeps a file 48 hours).
 */

export const GEMINI_UPLOAD_URL = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const FALLBACK_TTL_MS = 48 * 60 * 60 * 1000

export interface GeminiFile {
  uri: string
  expiresAt: Date
}

export function geminiFilesClient(apiKey: string, fetchImpl: typeof fetch = fetch) {
  return {
    async upload(bytes: Buffer, mimeType: string, displayName: string): Promise<GeminiFile> {
      const start = await fetchImpl(`${GEMINI_UPLOAD_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(bytes.length),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: displayName.slice(0, 120) } }),
      })
      const uploadUrl = start.headers.get('x-goog-upload-url')
      if (!start.ok || !uploadUrl) {
        throw new Error(`Gemini refused to start an upload (${start.status})`)
      }
      const done = await fetchImpl(uploadUrl, {
        method: 'POST',
        headers: {
          'Content-Length': String(bytes.length),
          'X-Goog-Upload-Offset': '0',
          'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: new Uint8Array(bytes),
      })
      if (!done.ok) throw new Error(`Gemini refused the upload (${done.status})`)
      const body = (await done.json()) as { file?: { uri?: string; expirationTime?: string } }
      if (!body.file?.uri) throw new Error('Gemini answered an upload without a file URI')
      const expires = body.file.expirationTime ? Date.parse(body.file.expirationTime) : Date.now() + FALLBACK_TTL_MS
      return { uri: body.file.uri, expiresAt: new Date(expires) }
    },
  }
}
