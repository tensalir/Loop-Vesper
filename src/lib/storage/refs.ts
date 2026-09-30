/**
 * Where a stored file lives, whatever form its URL was saved in.
 *
 * Every render, video and product render was saved as a public Supabase URL
 * (`…/storage/v1/object/public/<bucket>/<path>`): in `outputs.fileUrl`, in
 * generation parameters, in CMF and product-render rows, in MCP job payloads.
 * The three buckets below are being made private, and after that a public URL
 * answers 400. Rather than rewrite every row, a stored URL is read back to its
 * bucket and path when it is used, and signed for whoever is reading it:
 * `./access.ts` on the server, the `/api/storage/...` route for the browser.
 *
 * Nothing here imports server code, so the browser uses `toViewUrl` too.
 */

/** The buckets whose files are reached only through a signature once they are private. */
export const PRIVATE_MEDIA_BUCKETS = ['generated-images', 'generated-videos', 'product-renders'] as const
export type PrivateMediaBucket = (typeof PRIVATE_MEDIA_BUCKETS)[number]

export interface StorageRef {
  bucket: PrivateMediaBucket
  /** The object path inside the bucket, decoded (spaces are spaces). */
  path: string
}

/** The browser's way in: signed-in people only, re-signed on every load. */
export const STORAGE_ROUTE_PREFIX = '/api/storage/'

export interface ParseOptions {
  /** The Supabase project URL; defaults to NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string | null
  /** Also read `<bucket>/<path>` with no host, the form a few older rows hold. */
  allowBare?: boolean
}

// `object` is the file itself; `render/image` is Supabase's resized copy of it.
const STORAGE_OBJECT_PATH = /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/

function configuredSupabaseUrl(opts?: ParseOptions): string {
  // Written out in full so Next inlines it into the browser bundle.
  const raw = opts?.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return raw.trim().replace(/\/+$/, '')
}

function isStorageHost(host: string, opts?: ParseOptions): boolean {
  const h = host.toLowerCase()
  const configured = configuredSupabaseUrl(opts)
  if (configured) {
    try {
      return h === new URL(configured).hostname.toLowerCase()
    } catch {
      return false
    }
  }
  return h.endsWith('.supabase.co')
}

export function isPrivateMediaBucket(value: unknown): value is PrivateMediaBucket {
  return typeof value === 'string' && (PRIVATE_MEDIA_BUCKETS as readonly string[]).includes(value)
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** A bucket and path from their parts, or null when either is not one Vesper serves. */
export function storageRefFromParts(bucket: unknown, pathSegments: readonly string[] | string): StorageRef | null {
  if (!isPrivateMediaBucket(bucket)) return null
  const segments = (typeof pathSegments === 'string' ? pathSegments.split('/') : [...pathSegments]).filter((s) => s.length > 0)
  if (segments.length === 0) return null
  if (segments.some((s) => s === '.' || s === '..')) return null
  return { bucket, path: segments.join('/') }
}

/**
 * The bucket and path a stored value points at, or null when it is not a file in one of the
 * three buckets (a data URL, a provider URL, another project's file, a Frontify asset).
 * Reads the public, signed and authenticated URL forms, Vesper's own `/api/storage/` route,
 * and, with `allowBare`, `<bucket>/<path>`.
 */
export function parseStorageRef(value: unknown, opts?: ParseOptions): StorageRef | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || raw.length > 4096) return null
  const head = raw.slice(0, 16).toLowerCase()
  if (head.startsWith('data:') || head.startsWith('blob:')) return null

  if (raw.startsWith(STORAGE_ROUTE_PREFIX)) {
    const rest = raw.slice(STORAGE_ROUTE_PREFIX.length).split(/[?#]/)[0]
    const [bucket, ...segments] = rest.split('/')
    return storageRefFromParts(decodeSegment(bucket), segments.map(decodeSegment))
  }

  if (head.startsWith('https://') || head.startsWith('http://')) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (!isStorageHost(url.hostname, opts)) return null
    const match = STORAGE_OBJECT_PATH.exec(url.pathname)
    if (!match) return null
    return storageRefFromParts(decodeSegment(match[1]), match[2].split('/').map(decodeSegment))
  }

  if (opts?.allowBare && !raw.includes('://')) {
    const [bucket, ...segments] = raw.split(/[?#]/)[0].split('/')
    return storageRefFromParts(bucket, segments.map(decodeSegment))
  }
  return null
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** The same-origin address the browser loads a stored file from. */
export function storageRouteUrl(ref: StorageRef, opts?: { download?: string; width?: number; quality?: number }): string {
  const params = new URLSearchParams()
  if (opts?.download) params.set('download', opts.download)
  if (opts?.width) params.set('w', String(Math.round(opts.width)))
  if (opts?.quality) params.set('q', String(Math.round(opts.quality)))
  const query = params.toString()
  return `${STORAGE_ROUTE_PREFIX}${ref.bucket}/${encodePath(ref.path)}${query ? `?${query}` : ''}`
}

/**
 * What an `<img>`, a `<video>`, a link or a fetch in the browser should load. A file in one of
 * the three buckets goes through `/api/storage/...`, which checks the sign-in and redirects to a
 * fresh signature; anything else (a data or blob URL, a provider URL) is returned as it is.
 * The stored value is never changed, so what the page sends back to the server stays canonical.
 */
export function toViewUrl(value: string): string
export function toViewUrl(value: string | null | undefined): string | null | undefined
export function toViewUrl(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  const ref = parseStorageRef(value)
  return ref ? storageRouteUrl(ref) : value
}

/** `toViewUrl`, answered as a download (`Content-Disposition: attachment`) under `filename`. */
export function toDownloadUrl(value: string, filename: string): string {
  const ref = parseStorageRef(value)
  return ref ? storageRouteUrl(ref, { download: filename }) : value
}

/**
 * The public-URL form, the one every row already holds. Used where a URL is written back, so a
 * signed URL Claude was handed (and hands back as a reference) is not stored with its expiry.
 */
export function canonicalStorageUrl(value: string, opts?: ParseOptions): string {
  const ref = parseStorageRef(value, opts)
  return (ref && publicStorageUrl(ref, opts)) || value
}

/** The public URL of a file, as `getPublicUrl` builds it; null when no Supabase URL is configured. */
export function publicStorageUrl(ref: StorageRef, opts?: ParseOptions): string | null {
  const base = configuredSupabaseUrl(opts)
  return base ? `${base}/storage/v1/object/public/${ref.bucket}/${encodePath(ref.path)}` : null
}

// A storage URL inside running text (a markdown image line, "Full resolution: <url>").
const STORAGE_URL_IN_TEXT =
  /https?:\/\/[^\s"'<>()[\]]+?\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/[^\s"'<>()[\]]+/g

/** Every storage URL in a piece of text, with where it sits, trailing punctuation left out. */
export function findStorageUrls(text: string, opts?: ParseOptions): Array<{ url: string; index: number; ref: StorageRef }> {
  if (!text.includes('/storage/v1/')) return []
  const found: Array<{ url: string; index: number; ref: StorageRef }> = []
  const pattern = new RegExp(STORAGE_URL_IN_TEXT.source, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const url = match[0].replace(/[.,;:!?]+$/, '')
    const ref = parseStorageRef(url, opts)
    if (ref) found.push({ url, index: match.index, ref })
  }
  return found
}
