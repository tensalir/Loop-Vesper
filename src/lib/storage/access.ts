/**
 * Signed access to Vesper's stored files, for whoever reads them.
 *
 * The buckets holding renders, videos and product renders were public, so anyone with a URL
 * could open an unreleased colourway. They are being made private. Every stored URL keeps the
 * form it was saved in (`./refs.ts` reads it back to bucket and path); what changes is that a
 * reader gets a signature with an expiry fit for what it does:
 *
 *   - a signed-in person's page view: 1 hour, re-signed on every load by `/api/storage/...`;
 *   - Vesper reading its own file on the server: 5 minutes, fetched at once;
 *   - a model provider fetching an input (Replicate, Kling, fal, OpenAI, Gemini): 1 hour,
 *     signed when the job is dispatched, not when it was queued;
 *   - Claude: 7 days, so the markdown image claude.ai draws, and the link the person opens from
 *     the chat, still work for the week a piece of work usually runs.
 *
 * A signature works on a public bucket too, so all of this runs the same before and after the
 * buckets are flipped; the deploy goes first and the flip after. When signing fails the
 * stored URL is returned as it is: that still works while the bucket is public, and fails no
 * worse than before once it is private.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { canonicalStorageUrl, findStorageUrls, parseStorageRef, publicStorageUrl, type ParseOptions, type StorageRef } from './refs'

export const VIEW_TTL_SECONDS = 60 * 60
export const SERVER_READ_TTL_SECONDS = 5 * 60
export const MODEL_INPUT_TTL_SECONDS = 60 * 60
export const CLAUDE_TTL_SECONDS = 7 * 24 * 60 * 60

export interface SignOptions {
  /** Answer as an attachment under this name. */
  download?: string
}

/** What signs; Supabase in production, a fake in the tests. */
export interface StorageSigner {
  /** One signed URL per path, in order; null for a path that could not be signed (a missing file). */
  sign(bucket: string, paths: string[], expiresInSeconds: number, options?: SignOptions): Promise<Array<string | null>>
}

let adminClient: SupabaseClient | null = null
function supabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
    adminClient = createClient(url, key, { auth: { persistSession: false } })
  }
  return adminClient
}

export const supabaseSigner: StorageSigner = {
  async sign(bucket, paths, expiresInSeconds, options) {
    if (paths.length === 0) return []
    const from = supabaseAdmin().storage.from(bucket)
    if (paths.length === 1) {
      const { data, error } = await from.createSignedUrl(paths[0], expiresInSeconds, options?.download ? { download: options.download } : undefined)
      return [error || !data?.signedUrl ? null : data.signedUrl]
    }
    const { data, error } = await from.createSignedUrls(paths, expiresInSeconds, options?.download ? { download: options.download } : undefined)
    if (error || !data) return paths.map(() => null)
    return paths.map((_, i) => data[i]?.signedUrl || null)
  },
}

let signerOverride: StorageSigner | null = null

/** Tests only: sign with a fake instead of Supabase; null restores Supabase. */
export function setStorageSignerForTests(signer: StorageSigner | null): void {
  signerOverride = signer
}

function activeSigner(signer?: StorageSigner): StorageSigner {
  return signer ?? signerOverride ?? supabaseSigner
}

export interface AccessOptions extends SignOptions {
  signer?: StorageSigner
  parse?: ParseOptions
}

/** A signed URL for one file; throws when it cannot be signed. */
export async function signStorageRef(ref: StorageRef, expiresInSeconds: number, opts: AccessOptions = {}): Promise<string> {
  const [signed] = await activeSigner(opts.signer).sign(ref.bucket, [ref.path], expiresInSeconds, opts.download ? { download: opts.download } : undefined)
  if (!signed) throw new Error(`Could not sign ${ref.bucket}/${ref.path}`)
  return signed
}

function warnUnsigned(ref: StorageRef, err: unknown) {
  console.warn('[storage] could not sign; using the stored URL', { bucket: ref.bucket, path: ref.path, error: (err as Error)?.message ?? null })
}

/**
 * A stored value made readable for `expiresInSeconds`: a file in one of the private buckets is
 * signed, anything else comes back unchanged. On a signing failure the canonical public URL is
 * returned (see the module note).
 */
export async function signStoredUrl(value: string, expiresInSeconds: number, opts: AccessOptions = {}): Promise<string> {
  const ref = parseStorageRef(value, opts.parse)
  if (!ref) return value
  try {
    return await signStorageRef(ref, expiresInSeconds, opts)
  } catch (err) {
    warnUnsigned(ref, err)
    return canonicalStorageUrl(value, opts.parse)
  }
}

function refKey(ref: StorageRef): string {
  return `${ref.bucket}\u0000${ref.path}`
}

// Only JSON-shaped values are walked; a class instance (a signal, a buffer) is passed on as it is.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function collect(value: unknown, into: Map<string, StorageRef>, parse?: ParseOptions, depth = 0): void {
  if (depth > 64 || value === null || value === undefined) return
  if (typeof value === 'string') {
    const whole = parseStorageRef(value, parse)
    if (whole) {
      into.set(refKey(whole), whole)
      return
    }
    for (const hit of findStorageUrls(value, parse)) into.set(refKey(hit.ref), hit.ref)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, parse, depth + 1)
    return
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) collect(item, into, parse, depth + 1)
  }
}

function replace<T>(value: T, signed: Map<string, string>, parse?: ParseOptions, depth = 0): T {
  if (depth > 64 || value === null || value === undefined) return value
  if (typeof value === 'string') {
    const whole = parseStorageRef(value, parse)
    if (whole) return (signed.get(refKey(whole)) ?? value) as T
    const hits = findStorageUrls(value, parse)
    if (hits.length === 0) return value
    let out = ''
    let at = 0
    for (const hit of hits) {
      out += value.slice(at, hit.index) + (signed.get(refKey(hit.ref)) ?? hit.url)
      at = hit.index + hit.url.length
    }
    return (out + value.slice(at)) as T
  }
  if (Array.isArray(value)) return value.map((item) => replace(item, signed, parse, depth + 1)) as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = replace(v, signed, parse, depth + 1)
    return out as T
  }
  return value
}

/**
 * A copy of `value` (a tool result, a model request, an API body) with every stored file in it
 * signed for `expiresInSeconds`: whole-string URLs and URLs inside text (a markdown image line)
 * alike. One signing call per bucket. The input is not changed, so what is persisted stays
 * canonical.
 */
export async function signStoredUrlsDeep<T>(value: T, expiresInSeconds: number, opts: AccessOptions = {}): Promise<T> {
  const refs = new Map<string, StorageRef>()
  collect(value, refs, opts.parse)
  if (refs.size === 0) return value

  const byBucket = new Map<string, StorageRef[]>()
  for (const ref of Array.from(refs.values())) byBucket.set(ref.bucket, [...(byBucket.get(ref.bucket) ?? []), ref])

  const signed = new Map<string, string>()
  await Promise.all(
    Array.from(byBucket.entries()).map(async ([bucket, list]) => {
      let urls: Array<string | null>
      try {
        urls = await activeSigner(opts.signer).sign(bucket, list.map((r) => r.path), expiresInSeconds)
      } catch (err) {
        urls = list.map(() => null)
        console.warn('[storage] could not sign a batch; using the stored URLs', { bucket, count: list.length, error: (err as Error)?.message ?? null })
      }
      list.forEach((ref, i) => {
        const url = urls[i]
        // Unsigned: the public URL, which still answers while the bucket is public.
        const fallback = url ?? publicStorageUrl(ref, opts.parse)
        if (fallback) signed.set(refKey(ref), fallback)
      })
    })
  )
  return replace(value, signed, opts.parse)
}

export interface FetchStoredOptions extends AccessOptions {
  fetchImpl?: typeof fetch
}

/**
 * `fetch` for a URL that may be one of Vesper's stored files: the file is signed for a few
 * minutes and fetched through the signature, anything else is fetched as it is. A drop-in for
 * `fetch(storedUrl)` on the server, where a public URL stops answering once the bucket is
 * private.
 */
export async function fetchStored(url: string, init?: RequestInit, opts: FetchStoredOptions = {}): Promise<Response> {
  const target = await signStoredUrl(url, SERVER_READ_TTL_SECONDS, opts)
  return (opts.fetchImpl ?? fetch)(target, init)
}
