/**
 * The pinned references: the real pictures of each product that the grader
 * attaches and a draw starts from, named in the creative kit with their sha256.
 *
 * A pin is used only when Vesper holds exactly the bytes the kit names:
 *   - Frontify pins are pulled by asset id, the original byte for byte;
 *   - CMF clowns come from Vesper's own storage;
 *   - packaging's pins are Figma exports that live on the machine that pulled
 *     them, so an admin uploads them with `scripts/creative-upload-pin.mjs`.
 * Every copy is hashed; a sha256 that is not the kit's disables the pin, and
 * nothing is stored or sent for it. Bytes are kept unchanged in the private
 * bucket `creative-pins`, with a JPEG preview beside them for Claude to read.
 *
 * A pin over the product's `grading.max_model_pixels` (the kit marks it
 * `model_copy: derived-4096`) is sent to a model as a derived copy, made once
 * by the admin script with the repository's own resampling, never decoded in
 * a function. Each model copy is uploaded once to Gemini's Files API; the
 * daily cron refreshes an upload before its 48-hour expiry.
 */

import crypto from 'crypto'
import type { Kit } from './kit-schema'

export const PIN_BUCKET_DEFAULT = 'creative-pins'
export const GEMINI_REFRESH_WITHIN_MS = 24 * 60 * 60 * 1000
export const DEFAULT_MAX_MODEL_PIXELS = 80_000_000

export type PinSource = 'frontify' | 'vesper-storage' | 'upload'
export type PinStatus = 'pending' | 'ok' | 'sha_mismatch' | 'missing' | 'needs_upload' | 'needs_derived' | 'error'

export interface PinSpec {
  product: string
  pinId: string
  source: PinSource
  title: string | null
  sha256: string
  bytes: number | null
  width: number | null
  height: number | null
  /** The kit says a model gets a derived copy. */
  derived: boolean
  frontifyAssetId: string | null
  /** For a CMF clown: the clown table's product and variant slugs. */
  clown: { product: string; variant: string } | null
  localPath: string | null
}

export interface PinRow {
  product: string
  pinId: string
  source: PinSource
  title: string | null
  sha256: string
  bytes: number | null
  width: number | null
  height: number | null
  mime: string | null
  storagePath: string | null
  previewPath: string | null
  derivedPath: string | null
  derivedSha256: string | null
  derivedRecipe: Record<string, unknown> | null
  geminiFileUri: string | null
  geminiFileExpiresAt: Date | null
  status: PinStatus
  error: string | null
  syncedAt: Date | null
}

export interface PinStore {
  get(pinId: string, sha256: string): Promise<PinRow | null>
  upsert(row: PinRow): Promise<void>
  list(product?: string): Promise<PinRow[]>
}

export interface PinBytes {
  bytes: Buffer
  contentType: string
}

export interface PinSyncDeps {
  store: PinStore
  fetchFrontifyOriginal(assetId: string): Promise<PinBytes | null>
  fetchClown(product: string, variant: string): Promise<PinBytes | null>
  storage: {
    put(path: string, bytes: Buffer, contentType: string): Promise<void>
    get(path: string): Promise<Buffer | null>
  }
  /** Null when no Gemini key is configured: pins are still stored and previewed. */
  gemini: { upload(bytes: Buffer, mimeType: string, displayName: string): Promise<{ uri: string; expiresAt: Date }> } | null
  makePreview(bytes: Buffer): Promise<Buffer>
  now?: () => number
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/tiff': 'tif',
  'image/gif': 'gif',
}

export function extensionFor(contentType: string | null | undefined): string {
  return EXTENSIONS[(contentType || '').split(';')[0].trim().toLowerCase()] ?? 'bin'
}

export function pinStoragePath(sha256: string, contentType: string): string {
  return `pins/${sha256}.${extensionFor(contentType)}`
}

export function pinPreviewPath(sha256: string): string {
  return `previews/${sha256}.jpg`
}

/** Every pin the kit names, once per id and sha256. */
export function kitPins(kit: Kit): PinSpec[] {
  const out: PinSpec[] = []
  const seen = new Set<string>()
  const add = (p: PinSpec) => {
    const key = `${p.pinId}@${p.sha256}`
    if (!p.sha256 || seen.has(key)) return
    seen.add(key)
    out.push(p)
  }
  for (const [slug, product] of Object.entries(kit.products)) {
    const maxPixels = product.grading?.max_model_pixels ?? DEFAULT_MAX_MODEL_PIXELS
    for (const pin of product.references?.pins ?? []) {
      const w = pin.width ?? null
      const h = pin.height ?? null
      add({
        product: slug,
        pinId: pin.id,
        source: pin.source,
        title: pin.title ?? null,
        sha256: pin.sha256 ?? '',
        bytes: pin.bytes ?? null,
        width: w,
        height: h,
        derived: pin.model_copy === 'derived-4096' || (w !== null && h !== null && w * h > maxPixels),
        frontifyAssetId: pin.frontify_asset_id ?? null,
        clown: null,
        localPath: typeof (pin as Record<string, unknown>).local_path === 'string' ? ((pin as Record<string, unknown>).local_path as string) : null,
      })
    }
    if (product.kind === 'cmf') {
      const keys = ((product as Record<string, unknown>).keys ?? {}) as Record<
        string,
        { product?: string; variant?: string; clown?: { id: string; sha256: string; width?: number; height?: number } }
      >
      for (const key of Object.values(keys)) {
        if (!key.clown?.sha256 || !key.product) continue
        add({
          product: slug,
          pinId: key.clown.id,
          source: 'vesper-storage',
          title: key.clown.id,
          sha256: key.clown.sha256,
          bytes: null,
          width: key.clown.width ?? null,
          height: key.clown.height ?? null,
          derived: false,
          frontifyAssetId: null,
          clown: { product: key.product, variant: key.variant ?? 'default' },
          localPath: null,
        })
      }
    }
  }
  return out
}

/** A pin may be attached only when Vesper holds exactly the kit's bytes, and a model copy when one is needed. */
export function usablePin(row: PinRow | null | undefined, spec: Pick<PinSpec, 'sha256' | 'derived'>): boolean {
  if (!row || row.status !== 'ok' || row.sha256 !== spec.sha256 || !row.storagePath) return false
  return !spec.derived || !!row.derivedPath
}

function blankRow(spec: PinSpec): PinRow {
  return {
    product: spec.product,
    pinId: spec.pinId,
    source: spec.source,
    title: spec.title,
    sha256: spec.sha256,
    bytes: spec.bytes,
    width: spec.width,
    height: spec.height,
    mime: null,
    storagePath: null,
    previewPath: null,
    derivedPath: null,
    derivedSha256: null,
    derivedRecipe: null,
    geminiFileUri: null,
    geminiFileExpiresAt: null,
    status: 'pending',
    error: null,
    syncedAt: null,
  }
}

export interface PinSyncResult {
  pinId: string
  product: string
  status: PinStatus | 'skipped'
  note: string
}

/** Bring every pin to `ok` where its bytes can be had; report the rest. Stops at the time budget. */
export async function syncPins(
  specs: readonly PinSpec[],
  deps: PinSyncDeps,
  opts: { budgetMs?: number; force?: boolean } = {}
): Promise<PinSyncResult[]> {
  const now = deps.now ?? Date.now
  const started = now()
  const results: PinSyncResult[] = []
  for (const spec of specs) {
    if (opts.budgetMs !== undefined && now() - started > opts.budgetMs) {
      results.push({ pinId: spec.pinId, product: spec.product, status: 'skipped', note: 'the time budget ran out; the next run takes it' })
      continue
    }
    try {
      results.push(await syncOne(spec, deps, now, opts.force === true))
    } catch (err) {
      const message = (err as Error)?.message || 'failed'
      const row = { ...((await deps.store.get(spec.pinId, spec.sha256)) ?? blankRow(spec)) }
      row.status = 'error'
      row.error = message.slice(0, 500)
      row.syncedAt = new Date(now())
      await deps.store.upsert(row)
      results.push({ pinId: spec.pinId, product: spec.product, status: 'error', note: message })
    }
  }
  return results
}

async function syncOne(spec: PinSpec, deps: PinSyncDeps, now: () => number, force: boolean): Promise<PinSyncResult> {
  const existing = await deps.store.get(spec.pinId, spec.sha256)
  if (!force && usablePin(existing, spec) && existing!.previewPath) {
    const lapsing =
      !existing!.geminiFileUri ||
      !existing!.geminiFileExpiresAt ||
      existing!.geminiFileExpiresAt.getTime() - now() < GEMINI_REFRESH_WITHIN_MS
    if (!deps.gemini || !lapsing) {
      return { pinId: spec.pinId, product: spec.product, status: 'ok', note: 'current' }
    }
  }
  const row: PinRow = { ...(existing ?? blankRow(spec)) }
  const done = async (status: PinStatus, note: string, error: string | null = null): Promise<PinSyncResult> => {
    row.status = status
    row.error = error
    row.syncedAt = new Date(now())
    await deps.store.upsert(row)
    return { pinId: spec.pinId, product: spec.product, status, note }
  }

  // 1. The original, byte for byte.
  let original: PinBytes | null = null
  if (row.storagePath && !force) {
    const stored = await deps.storage.get(row.storagePath)
    if (stored) original = { bytes: stored, contentType: row.mime || 'application/octet-stream' }
  }
  if (!original) {
    if (spec.source === 'upload') {
      return done('needs_upload', 'an admin uploads it with scripts/creative-upload-pin.mjs from the machine that holds it')
    }
    original =
      spec.source === 'frontify' && spec.frontifyAssetId
        ? await deps.fetchFrontifyOriginal(spec.frontifyAssetId)
        : spec.clown
          ? await deps.fetchClown(spec.clown.product, spec.clown.variant)
          : null
    if (!original) return done('missing', 'the source has no such picture', 'not found at its source')
  }

  const digest = sha256Hex(original.bytes)
  if (digest !== spec.sha256) {
    // Never stored, never sent: a different picture under the pin's name is the silent failure this guards.
    return done(
      'sha_mismatch',
      `its bytes hash to ${digest.slice(0, 12)}…, the kit names ${spec.sha256.slice(0, 12)}…; not used`,
      `sha256 ${digest} is not the kit's ${spec.sha256}`
    )
  }

  if (!row.storagePath) {
    const path = pinStoragePath(spec.sha256, original.contentType)
    await deps.storage.put(path, original.bytes, original.contentType)
    row.storagePath = path
  }
  row.mime = original.contentType
  row.bytes = original.bytes.length

  // 2. The copy a model reads: the original, or the admin's derived copy.
  let modelCopy: Buffer | null = spec.derived ? null : original.bytes
  let modelMime = original.contentType
  if (spec.derived && row.derivedPath) {
    modelCopy = await deps.storage.get(row.derivedPath)
    modelMime = 'image/png'
  }

  // 3. A preview Claude can read, never from a picture too large to decode here.
  if (!row.previewPath && modelCopy) {
    const preview = await deps.makePreview(modelCopy)
    const path = pinPreviewPath(spec.sha256)
    await deps.storage.put(path, preview, 'image/jpeg')
    row.previewPath = path
  }

  if (spec.derived && !modelCopy) {
    return done('needs_derived', 'stored; a model needs the derived copy, which the admin script makes')
  }

  // 4. Gemini's Files API, refreshed before it lapses.
  const expiring = !row.geminiFileExpiresAt || row.geminiFileExpiresAt.getTime() - now() < GEMINI_REFRESH_WITHIN_MS
  if (deps.gemini && modelCopy && (expiring || !row.geminiFileUri || force)) {
    const uploaded = await deps.gemini.upload(modelCopy, modelMime, `${spec.product}/${spec.pinId}`)
    row.geminiFileUri = uploaded.uri
    row.geminiFileExpiresAt = uploaded.expiresAt
  }
  return done('ok', existing?.status === 'ok' ? 'checked' : 'pinned')
}

export interface PinHealth {
  product: string
  pinId: string
  title: string | null
  source: PinSource
  status: PinStatus
  usable: boolean
  derived: boolean
  geminiExpiresAt: string | null
  expiringSoon: boolean
  error: string | null
}

/** Each pin the kit names, with where it stands in the store. */
export function pinHealth(specs: readonly PinSpec[], rows: readonly PinRow[], nowMs: number = Date.now()): PinHealth[] {
  const byKey = new Map(rows.map((r) => [`${r.pinId}@${r.sha256}`, r]))
  return specs.map((spec) => {
    const row = byKey.get(`${spec.pinId}@${spec.sha256}`) ?? null
    const expires = row?.geminiFileExpiresAt ?? null
    return {
      product: spec.product,
      pinId: spec.pinId,
      title: spec.title,
      source: spec.source,
      status: row?.status ?? 'pending',
      usable: usablePin(row, spec),
      derived: spec.derived,
      geminiExpiresAt: expires ? expires.toISOString() : null,
      expiringSoon: !!expires && expires.getTime() - nowMs < GEMINI_REFRESH_WITHIN_MS,
      error: row?.error ?? null,
    }
  })
}
