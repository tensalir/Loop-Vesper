/**
 * Headers for fetching a provider's output before it is copied into our own storage.
 *
 * Veo hands back a Gemini Files URI (`…/v1beta/files/<id>:download?alt=media`) rather than the
 * bytes, and that URI is not public: fetched without the API key Google answers 403. Inside
 * `uploadUrlToStorage` that surfaced as
 *
 *     Failed to upload URL to storage: Failed to fetch from URL: Forbidden
 *
 * which reads as a storage permission problem though storage was never reached. The web
 * generation processor had always added the key; the MCP video and asset paths and the CMF
 * render had not, so every Veo video asked for through Claude failed at this step.
 *
 * It belongs on the one function that fetches a provider's URL rather than in each caller. A
 * caller's own header still wins, so the processor's explicit key keeps working.
 */

export const GEMINI_FILES_HOST = 'generativelanguage.googleapis.com'

function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  if (!headers) return false
  const wanted = name.toLowerCase()
  return Object.keys(headers).some((k) => k.toLowerCase() === wanted)
}

/** `headers`, plus the Gemini API key when the URL is a Gemini Files URI and none was given. */
export function providerFetchHeaders(
  url: string,
  headers?: Record<string, string>,
  apiKey: string | undefined = process.env.GEMINI_API_KEY
): Record<string, string> {
  const needsGeminiKey = Boolean(apiKey) && url.includes(GEMINI_FILES_HOST) && !hasHeader(headers, 'x-goog-api-key')
  return { ...(needsGeminiKey ? { 'x-goog-api-key': apiKey as string } : {}), ...(headers || {}) }
}
