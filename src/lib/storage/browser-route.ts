/**
 * `GET /api/storage/<bucket>/<path>`: how the browser opens a stored file.
 *
 * Pages used to put the public Supabase URL straight into `<img>` and `<video>`. Once the
 * buckets are private that URL answers 400, so a page loads this route instead (`toViewUrl`).
 * It answers only a signed-in, active account, and redirects to a signature that lasts an hour;
 * the redirect itself may be kept by the browser for half that, so a gallery does not sign the
 * same file on every scroll. `?download=<name>` answers as an attachment. `?w=<width>` (what
 * `next/image` asks for) answers a resized WebP made here, because Vercel's image optimizer
 * cannot pass a sign-in and would cache the picture for anyone who knows the address.
 */

import { SERVER_READ_TTL_SECONDS, VIEW_TTL_SECONDS, signStorageRef, type StorageSigner } from './access'
import { storageRefFromParts, type StorageRef } from './refs'

/** The widths `next/image` asks for (next.config.js deviceSizes and imageSizes); nothing else is resized. */
export const RESIZE_WIDTHS = [16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840] as const
const DEFAULT_QUALITY = 75
/** How long a browser may keep the redirect: half the signature's life, so what it keeps still opens. */
export const REDIRECT_MAX_AGE_SECONDS = Math.floor(VIEW_TTL_SECONDS / 2)
const RESIZED_MAX_AGE_SECONDS = 24 * 60 * 60
const RESIZE_MAX_INPUT_BYTES = 40 * 1024 * 1024

export interface StorageRouteDeps {
  /** Null when the caller may read; otherwise the status and message to answer with. */
  authenticate(): Promise<{ status: number; error: string } | null>
  signer?: StorageSigner
  fetchImpl?: typeof fetch
  /** Resize an image to `width` as WebP; injected so tests need no image library. */
  resize?(input: Buffer, width: number, quality: number): Promise<Buffer>
}

export interface StorageRouteRequest {
  bucket: string
  path: string[] | string
  searchParams: URLSearchParams
}

function json(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/** A download name Supabase can carry in its query string as it is. */
export function safeDownloadName(raw: string | null): string | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120)
  return cleaned || null
}

async function defaultResize(input: Buffer, width: number, quality: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp(input, { limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer()
}

async function resized(ref: StorageRef, width: number, quality: number, deps: StorageRouteDeps): Promise<Response | null> {
  try {
    const source = await signStorageRef(ref, SERVER_READ_TTL_SECONDS, { signer: deps.signer })
    const res = await (deps.fetchImpl ?? fetch)(source)
    const type = (res.headers.get('content-type') || '').toLowerCase()
    if (!res.ok || !type.startsWith('image/') || type.includes('svg')) return null
    const declared = Number(res.headers.get('content-length') || 0)
    if (declared > RESIZE_MAX_INPUT_BYTES) return null
    const input = Buffer.from(await res.arrayBuffer())
    if (input.byteLength > RESIZE_MAX_INPUT_BYTES) return null
    const out = await (deps.resize ?? defaultResize)(input, width, quality)
    return new Response(new Uint8Array(out), {
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'cache-control': `private, max-age=${RESIZED_MAX_AGE_SECONDS}`,
        'content-length': String(out.byteLength),
      },
    })
  } catch (err) {
    console.warn('[storage] resize failed; redirecting to the original', { bucket: ref.bucket, error: (err as Error)?.message ?? null })
    return null
  }
}

export async function handleStorageRequest(req: StorageRouteRequest, deps: StorageRouteDeps): Promise<Response> {
  const ref = storageRefFromParts(req.bucket, req.path)
  if (!ref) return json(404, 'Not found')

  const refusal = await deps.authenticate()
  if (refusal) return json(refusal.status, refusal.error)

  const width = Number(req.searchParams.get('w') || 0)
  if (width) {
    if (!(RESIZE_WIDTHS as readonly number[]).includes(width)) return json(400, 'Unsupported width')
    const q = Number(req.searchParams.get('q') || DEFAULT_QUALITY)
    const quality = Number.isInteger(q) && q >= 1 && q <= 100 ? q : DEFAULT_QUALITY
    const small = await resized(ref, width, quality, deps)
    if (small) return small
    // Not an image sharp can read, or the resize failed: the original will do.
  }

  const download = safeDownloadName(req.searchParams.get('download'))
  let signed: string
  try {
    signed = await signStorageRef(ref, VIEW_TTL_SECONDS, { signer: deps.signer, ...(download ? { download } : {}) })
  } catch {
    return json(404, 'Not found')
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: signed,
      'cache-control': `private, max-age=${REDIRECT_MAX_AGE_SECONDS}`,
      // The signature is in the address; it is not passed on to whatever the file links to.
      'referrer-policy': 'no-referrer',
    },
  })
}
