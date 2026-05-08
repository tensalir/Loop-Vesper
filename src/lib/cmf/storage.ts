/**
 * Storage path conventions for the CMF flow.
 *
 * All CMF artefacts live under the existing `generated-images` bucket so we
 * inherit its service-role access policy (no anon read/write).
 *
 *   cmf/clowns/{productSlug}/{variantSlug}.{ext}      <- shared across users
 *   cmf/{ownerId}/imports/{importId}.xlsx              <- per-user
 *   cmf/{ownerId}/packets/{packetId}/renders/{renderId}.{ext}
 *   cmf/{ownerId}/packets/{packetId}/{packetId}.pdf
 *
 * Clowns went from per-user to global on 20260508 — the library is a shared
 * Loop-wide reference now, so paths drop the ownerId segment. Per-packet
 * outputs stay per-user since they encode private design intent.
 */

export const CMF_STORAGE_BUCKET = 'generated-images'

/**
 * Canonical storage path for a clown reference asset.
 *
 * Keyed on (productSlug, variantSlug) — the same composite that uniquely
 * identifies a CmfClownAsset row. Replacing a clown overwrites the file at
 * the same path, so every consumer always reads the latest geometry.
 */
export function clownStoragePath(
  productSlug: string,
  variantSlug: string,
  ext: string
): string {
  return `cmf/clowns/${productSlug}/${variantSlug}.${ext}`
}

export function importStoragePath(ownerId: string, importId: string): string {
  return `cmf/${ownerId}/imports/${importId}.xlsx`
}

export function renderStoragePath(
  ownerId: string,
  packetId: string,
  renderId: string,
  ext: string
): string {
  return `cmf/${ownerId}/packets/${packetId}/renders/${renderId}.${ext}`
}

export function packetPdfStoragePath(ownerId: string, packetId: string, fileSlug: string): string {
  // fileSlug already encodes packet identity (e.g. CMF-001234revA_Switch2_CMF_Sage)
  // so we keep the directory predictable but the filename human-readable.
  return `cmf/${ownerId}/packets/${packetId}/${fileSlug}.pdf`
}

export function safeFileSlug(input: string): string {
  return input
    .replace(/\.+/g, '.')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    // Strip any sequence of dots ("." or "..") that ended up bordered by
    // separators — it would render as "_.._etc" otherwise. We never need
    // dotted components inside a CMF filename.
    .replace(/(^|_)[.]+(?=_|$)/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120)
}
