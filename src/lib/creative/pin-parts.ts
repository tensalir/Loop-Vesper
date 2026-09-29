/**
 * A usable pin as something a model reads: its Files API URI while that is
 * alive, else the copy Vesper holds (the original, or the admin's derived
 * copy for a pin too large for a model), inline when small, uploaded once
 * when not. The bytes are the stored ones, never re-encoded.
 */

import type { PinRow, PinSpec } from './pins'
import { filePart, type GeminiPart } from './gemini'

/** A Files API URI this close to expiry is uploaded again rather than trusted. */
export const URI_MARGIN_MS = 10 * 60 * 1000

export interface PinPartDeps {
  storage: { get(path: string): Promise<Buffer | null> }
  /** Uploads to the Files API; returns the URI. Absent when no Gemini key is configured. */
  upload?: (bytes: Buffer, mimeType: string, displayName: string) => Promise<{ uri: string; expiresAt: Date }>
  /** Keeps a fresh upload on the pin's row, so the next call reuses it. */
  remember?: (row: PinRow) => Promise<void>
  inlineLimit: number
  now?: () => number
}

export function modelCopyMime(row: PinRow, spec: Pick<PinSpec, 'derived'>): string {
  return spec.derived ? 'image/png' : row.mime || 'image/png'
}

export async function pinModelCopy(
  row: PinRow,
  spec: Pick<PinSpec, 'derived' | 'pinId'>,
  storage: PinPartDeps['storage']
): Promise<{ bytes: Buffer; mimeType: string }> {
  const path = spec.derived ? row.derivedPath : row.storagePath
  if (!path) throw new Error(`pin ${spec.pinId} has no stored copy for a model`)
  const bytes = await storage.get(path)
  if (!bytes) throw new Error(`pin ${spec.pinId}: its stored copy could not be read`)
  return { bytes, mimeType: modelCopyMime(row, spec) }
}

export async function pinPart(
  row: PinRow,
  spec: Pick<PinSpec, 'derived' | 'pinId' | 'product'>,
  deps: PinPartDeps
): Promise<GeminiPart> {
  const now = deps.now ?? Date.now
  const mimeType = modelCopyMime(row, spec)
  if (row.geminiFileUri && row.geminiFileExpiresAt && row.geminiFileExpiresAt.getTime() - now() > URI_MARGIN_MS) {
    return filePart(row.geminiFileUri, mimeType)
  }
  const copy = await pinModelCopy(row, spec, deps.storage)
  if (copy.bytes.length <= deps.inlineLimit || !deps.upload) {
    return { inline_data: { mime_type: copy.mimeType, data: copy.bytes.toString('base64') } }
  }
  const uploaded = await deps.upload(copy.bytes, copy.mimeType, `${spec.product}/${spec.pinId}`)
  if (deps.remember) {
    await deps.remember({ ...row, geminiFileUri: uploaded.uri, geminiFileExpiresAt: uploaded.expiresAt }).catch(() => undefined)
  }
  return filePart(uploaded.uri, copy.mimeType)
}
