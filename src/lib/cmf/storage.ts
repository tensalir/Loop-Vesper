/**
 * Storage path conventions for the CMF flow.
 *
 * All CMF artefacts live under the existing `generated-images` bucket so we
 * inherit its service-role access policy (no anon read/write). Paths are
 * namespaced by ownerId so a leak of one URL never reveals another user's
 * outputs.
 *
 *   cmf/{ownerId}/clowns/{slug}.{ext}
 *   cmf/{ownerId}/imports/{importId}.xlsx
 *   cmf/{ownerId}/packets/{packetId}/renders/{renderId}.{ext}
 *   cmf/{ownerId}/packets/{packetId}/{packetId}.pdf
 *
 * Reads always go through `/api/cmf/...` routes that verify ownership before
 * returning the public URL.
 */

export const CMF_STORAGE_BUCKET = 'generated-images'

export function clownStoragePath(ownerId: string, slug: string, ext: string): string {
  return `cmf/${ownerId}/clowns/${slug}.${ext}`
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
