/**
 * A file on the caller's side, brought into Vesper by the caller itself.
 *
 * Claude in Cowork holds the person's files in its own workspace, and a tool call can only carry
 * text: a 2160x2160 PNG is several megabytes, far past anything a tool argument can hold, and a
 * path on the caller's side means nothing to Vesper. On 2026-10-12 a colleague's 16 frames for
 * Kling never got further than that. So Vesper hands out signed upload URLs: the caller PUTs each
 * file straight to Vesper's storage (Cowork's workspace reaches it, checked the same day) and
 * passes the stored URL wherever a tool takes an https image. The stored URL is signed again
 * whenever a provider needs it, like every other file in the bucket.
 *
 * The same route the packaging studio uses for Illustrator files (`createSignedUploadUrl`, a PUT
 * with the file as the body), into the bucket the web app keeps reference images in.
 */

import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const UPLOAD_BUCKET = 'generated-images'
/** Supabase's signed upload URLs last two hours, and cannot be given another lifetime. */
export const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60
export const MAX_UPLOADS_PER_CALL = 20

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
const EXTENSION_FOR_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export interface IssuedUpload {
  /** Where the caller PUTs the file. */
  uploadUrl: string
  /** The stored file, to pass to Vesper's tools. */
  url: string
}

export interface UploadIssuer {
  issue(bucket: string, path: string): Promise<IssuedUpload>
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

export const supabaseUploadIssuer: UploadIssuer = {
  async issue(bucket, path) {
    const storage = supabaseAdmin().storage.from(bucket)
    // upsert, so a PUT that broke halfway can simply be sent again to the same URL.
    const { data, error } = await storage.createSignedUploadUrl(path, { upsert: true })
    if (error || !data) throw new Error(`Could not issue an upload URL: ${error?.message ?? 'unknown error'}`)
    // The public form is how every stored file is recorded; it is signed again whenever it is read.
    return { uploadUrl: data.signedUrl, url: storage.getPublicUrl(path).data.publicUrl }
  },
}

/** The image type of a file, from the type given or else its name; a non-image is refused. */
export function uploadContentType(name: string, given?: string): string {
  if (given) {
    const type = given.trim().toLowerCase()
    if (EXTENSION_FOR_TYPE[type]) return type
    throw new Error(`'${name}': only PNG, JPEG and WebP images can be uploaded (got ${given}).`)
  }
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const type = IMAGE_TYPES[extension]
  if (!type) {
    throw new Error(`'${name}': only PNG, JPEG and WebP images can be uploaded; name the type with contentType if the name has none.`)
  }
  return type
}

/** Where an upload is kept: under the owner, by day, a fresh id and a readable stem of the name. */
export function uploadPath(
  ownerId: string,
  name: string,
  contentType: string,
  now = new Date(),
  id: string = randomUUID()
): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '')
  const stem =
    name
      .replace(/\.[a-z0-9]+$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file'
  return `mcp-uploads/${ownerId}/${day}/${id}-${stem}.${EXTENSION_FOR_TYPE[contentType]}`
}
