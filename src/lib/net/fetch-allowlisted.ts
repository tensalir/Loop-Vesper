/**
 * Fetch a URL a caller handed us, only from hosts we trust.
 *
 * MCP tools accept reference images as https URLs. Without a host check the
 * server would fetch whatever a caller (or a prompt-injected agent) names,
 * including addresses inside the hosting network. Every server-side fetch of
 * a caller-supplied URL goes through here:
 *
 *   - https only, no credentials in the URL;
 *   - the host must be Vesper's own Supabase project, Frontify, Frontify's
 *     CDN or Replicate's delivery host, plus anything in
 *     `VESPER_FETCH_ALLOWLIST` (comma-separated; `*.example.com` matches
 *     subdomains only);
 *   - redirects are followed by hand and every hop is checked again;
 *   - the body is capped (25 MB), the call times out (20 s), and the content
 *     type must be an image or a PDF.
 */

export const FETCH_MAX_BYTES = 25 * 1024 * 1024
export const FETCH_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 5
const DEFAULT_CONTENT_TYPES = ['image/', 'application/pdf']

const BUILT_IN_HOSTS = [
  '*.frontify.com',
  'media.ffycdn.net',
  '*.ffycdn.net',
  'replicate.delivery',
  '*.replicate.delivery',
]

export class FetchNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FetchNotAllowedError'
  }
}

function supabaseHost(env: NodeJS.ProcessEnv): string | null {
  const raw = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** The host patterns a fetch may reach, from the built-in list and the environment. */
export function allowedHostPatterns(env: NodeJS.ProcessEnv = process.env): string[] {
  const patterns = [...BUILT_IN_HOSTS]
  const own = supabaseHost(env)
  if (own) patterns.push(own)
  for (const entry of (env.VESPER_FETCH_ALLOWLIST || '').split(',')) {
    const trimmed = entry.trim().toLowerCase()
    if (trimmed) patterns.push(trimmed)
  }
  return patterns
}

/** `*.example.com` matches `a.example.com` but not `example.com`; anything else must match exactly. */
export function isHostAllowed(host: string, patterns: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase()
    if (p.startsWith('*.')) {
      const suffix = p.slice(1) // ".example.com"
      return h.endsWith(suffix) && h.length > suffix.length
    }
    return h === p
  })
}

/** Parse and check a URL; throws `FetchNotAllowedError` with a reason the caller can read. */
export function assertAllowlistedUrl(
  raw: string,
  patterns: readonly string[] = allowedHostPatterns()
): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FetchNotAllowedError('Not a valid URL.')
  }
  if (url.protocol !== 'https:') {
    throw new FetchNotAllowedError(`Only https URLs are fetched (got ${url.protocol.replace(':', '')}).`)
  }
  if (url.username || url.password) {
    throw new FetchNotAllowedError('URLs with credentials are not fetched.')
  }
  if (!isHostAllowed(url.hostname, patterns)) {
    throw new FetchNotAllowedError(
      `Host '${url.hostname}' is not on Vesper's fetch allowlist. Use a Vesper Storage, Frontify or Replicate URL, or pass the image as a data URL.`
    )
  }
  return url
}

export interface AllowlistedFetchOptions {
  maxBytes?: number
  timeoutMs?: number
  /** Content-type prefixes accepted; defaults to images and PDF. */
  contentTypes?: readonly string[]
  patterns?: readonly string[]
  /** Injected for tests. */
  fetchImpl?: typeof fetch
}

export interface AllowlistedFetchResult {
  buffer: Buffer
  contentType: string
  finalUrl: string
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    throw new FetchNotAllowedError(`The file is ${Math.round(declared / 1_048_576)} MB; the cap is ${Math.round(maxBytes / 1_048_576)} MB.`)
  }
  if (!res.body) return Buffer.alloc(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new FetchNotAllowedError(`The file is over the ${Math.round(maxBytes / 1_048_576)} MB cap.`)
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)))
}

export async function fetchAllowlisted(
  raw: string,
  options: AllowlistedFetchOptions = {}
): Promise<AllowlistedFetchResult> {
  const patterns = options.patterns ?? allowedHostPatterns()
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES
  const contentTypes = options.contentTypes ?? DEFAULT_CONTENT_TYPES
  const doFetch = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? FETCH_TIMEOUT_MS)

  try {
    let url = assertAllowlistedUrl(raw, patterns)
    for (let hop = 0; ; hop++) {
      const res = await doFetch(url.toString(), { redirect: 'manual', signal: controller.signal })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new FetchNotAllowedError(`Redirect (HTTP ${res.status}) without a location.`)
        if (hop >= MAX_REDIRECTS) throw new FetchNotAllowedError('Too many redirects.')
        url = assertAllowlistedUrl(new URL(location, url).toString(), patterns)
        continue
      }
      if (!res.ok) {
        throw new Error(`Fetching the reference failed (HTTP ${res.status}).`)
      }
      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (!contentTypes.some((prefix) => contentType.startsWith(prefix))) {
        throw new FetchNotAllowedError(
          `The URL returned '${contentType || 'no content type'}', not an image${contentTypes.includes('application/pdf') ? ' or PDF' : ''}.`
        )
      }
      const buffer = await readCapped(res, maxBytes)
      return { buffer, contentType, finalUrl: url.toString() }
    }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new FetchNotAllowedError('Fetching the reference timed out.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Normalise a reference image to a data URL. Data URLs pass through; https
 * URLs are fetched through the allowlist; a bare base64 string (some tools
 * strip the prefix) is wrapped as JPEG.
 */
export async function referenceToDataUrl(
  ref: string,
  options: AllowlistedFetchOptions = {}
): Promise<string> {
  const trimmed = ref.trim()
  if (trimmed.startsWith('data:')) return trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    const { buffer, contentType } = await fetchAllowlisted(trimmed, {
      ...options,
      contentTypes: options.contentTypes ?? ['image/'],
    })
    return `data:${contentType};base64,${buffer.toString('base64')}`
  }
  if (/^[A-Za-z0-9+/=\s]{64,}$/.test(trimmed)) {
    return `data:image/jpeg;base64,${trimmed.replace(/\s+/g, '')}`
  }
  throw new FetchNotAllowedError('A reference image must be a data URL or an https URL.')
}

/** Split a data URL into its media type and base64 payload without a regex over the payload. */
export function splitDataUrl(dataUrl: string): { mediaType: string; base64: string } {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) {
    throw new Error('Malformed data URL.')
  }
  const meta = dataUrl.slice(5, comma)
  const mediaType = meta.split(';')[0] || 'application/octet-stream'
  return { mediaType, base64: dataUrl.slice(comma + 1) }
}
