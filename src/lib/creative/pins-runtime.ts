/**
 * The pins in production: Frontify originals by asset id, CMF clowns from
 * Vesper's own storage, the private bucket `creative-pins`, Gemini's Files API.
 *
 * Env: FRONTIFY_DOMAIN, FRONTIFY_API_TOKEN (a read token), GEMINI_API_KEY,
 * CREATIVE_PINS_BUCKET (default creative-pins), NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (as elsewhere).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { fetchAllowlisted } from '@/lib/net/fetch-allowlisted'
import { makeImagePreview } from '@/lib/images/preview'
import { geminiFilesClient } from './gemini-files'
import { PIN_BUCKET_DEFAULT, type PinBytes, type PinRow, type PinStore, type PinSyncDeps } from './pins'

/** Pinned originals reach 70 MB (a packaging render); they are streamed and stored, never decoded here. */
export const PIN_MAX_BYTES = 200 * 1024 * 1024
const PIN_FETCH_TIMEOUT_MS = 120_000

export function pinBucket(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CREATIVE_PINS_BUCKET || PIN_BUCKET_DEFAULT).trim()
}

function toRow(r: {
  product: string
  pinId: string
  source: string
  title: string | null
  sha256: string
  bytes: bigint | null
  width: number | null
  height: number | null
  mime: string | null
  storagePath: string | null
  previewPath: string | null
  derivedPath: string | null
  derivedSha256: string | null
  derivedRecipe: Prisma.JsonValue | null
  geminiFileUri: string | null
  geminiFileExpiresAt: Date | null
  status: string
  error: string | null
  syncedAt: Date | null
}): PinRow {
  return {
    ...r,
    source: r.source as PinRow['source'],
    status: r.status as PinRow['status'],
    bytes: r.bytes === null ? null : Number(r.bytes),
    derivedRecipe: (r.derivedRecipe as Record<string, unknown> | null) ?? null,
  }
}

export const prismaPinStore: PinStore = {
  async get(pinId, sha256) {
    const row = await prisma.creativePin.findUnique({ where: { pinId_sha256: { pinId, sha256 } } })
    return row ? toRow(row) : null
  },
  async upsert(row) {
    const data = {
      product: row.product,
      source: row.source,
      title: row.title,
      bytes: row.bytes === null ? null : BigInt(row.bytes),
      width: row.width,
      height: row.height,
      mime: row.mime,
      storagePath: row.storagePath,
      previewPath: row.previewPath,
      derivedPath: row.derivedPath,
      derivedSha256: row.derivedSha256,
      derivedRecipe: (row.derivedRecipe ?? undefined) as Prisma.InputJsonValue | undefined,
      geminiFileUri: row.geminiFileUri,
      geminiFileExpiresAt: row.geminiFileExpiresAt,
      status: row.status,
      error: row.error,
      syncedAt: row.syncedAt,
    }
    await prisma.creativePin.upsert({
      where: { pinId_sha256: { pinId: row.pinId, sha256: row.sha256 } },
      create: { pinId: row.pinId, sha256: row.sha256, ...data },
      update: data,
    })
  },
  async list(product) {
    const rows = await prisma.creativePin.findMany({ where: product ? { product } : {}, orderBy: [{ product: 'asc' }, { pinId: 'asc' }] })
    return rows.map(toRow)
  },
}

let admin: SupabaseClient | null = null
function supabaseAdmin(env: NodeJS.ProcessEnv): SupabaseClient {
  if (!admin) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
    admin = createClient(url, key, { auth: { persistSession: false } })
  }
  return admin
}

export function pinStorage(env: NodeJS.ProcessEnv = process.env): PinSyncDeps['storage'] {
  const bucket = pinBucket(env)
  return {
    async put(path, bytes, contentType) {
      const { error } = await supabaseAdmin(env).storage.from(bucket).upload(path, bytes, {
        contentType,
        upsert: true,
        cacheControl: 'private, max-age=31536000, immutable',
      })
      if (error) throw new Error(`Storing ${path} in ${bucket} failed: ${error.message}`)
    },
    async get(path) {
      const { data, error } = await supabaseAdmin(env).storage.from(bucket).download(path)
      if (error || !data) return null
      return Buffer.from(await data.arrayBuffer())
    },
  }
}

/** A Frontify original, byte for byte: a fresh `downloadUrl`, then an unauthenticated GET (as the repo's frontify.py does). */
export async function fetchFrontifyOriginal(assetId: string, env: NodeJS.ProcessEnv = process.env): Promise<PinBytes | null> {
  const domain = env.FRONTIFY_DOMAIN?.trim()
  const token = env.FRONTIFY_API_TOKEN?.trim()
  if (!domain || !token) throw new Error('Frontify is not configured (FRONTIFY_DOMAIN, FRONTIFY_API_TOKEN).')
  const res = await fetch(`https://${domain}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: 'query($id: ID!) { node(id: $id) { ... on Image { downloadUrl(validityInDays: 1) } } }',
      variables: { id: assetId },
    }),
  })
  if (!res.ok) throw new Error(`Frontify answered ${res.status} for asset ${assetId}`)
  const body = (await res.json()) as { data?: { node?: { downloadUrl?: string } }; errors?: Array<{ message: string }> }
  if (body.errors?.length) throw new Error(`Frontify: ${body.errors[0].message}`)
  const url = body.data?.node?.downloadUrl
  if (!url) return null
  const got = await fetchAllowlisted(url, { maxBytes: PIN_MAX_BYTES, timeoutMs: PIN_FETCH_TIMEOUT_MS, contentTypes: ['image/'] })
  return { bytes: got.buffer, contentType: got.contentType }
}

/** A CMF clown from Vesper's clown table, by product and variant slug. */
export async function fetchClown(product: string, variant: string): Promise<PinBytes | null> {
  const clown = await prisma.cmfClownAsset.findFirst({
    where: { productSlug: product, variantSlug: variant },
    select: { imageUrl: true },
  })
  if (!clown?.imageUrl) return null
  const got = await fetchAllowlisted(clown.imageUrl, { maxBytes: PIN_MAX_BYTES, timeoutMs: PIN_FETCH_TIMEOUT_MS, contentTypes: ['image/'] })
  return { bytes: got.buffer, contentType: got.contentType }
}

export function productionPinDeps(env: NodeJS.ProcessEnv = process.env): PinSyncDeps {
  const key = env.GEMINI_API_KEY?.trim()
  return {
    store: prismaPinStore,
    fetchFrontifyOriginal: (id) => fetchFrontifyOriginal(id, env),
    fetchClown,
    storage: pinStorage(env),
    gemini: key ? geminiFilesClient(key) : null,
    async makePreview(bytes) {
      const preview = await makeImagePreview(bytes)
      return Buffer.from(preview.data, 'base64')
    },
  }
}
