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

/**
 * Storage path for an image dropped as a refinement reference.
 *
 * Uploads happen BEFORE the attempt exists (the upload route fires
 * when the designer drops a file in the refine panel; the attempt
 * is only created when they click "Generate refined attempt"). So
 * the path is keyed on a `batchId` generated server-side by the
 * upload route — every file uploaded in one HTTP request lands in
 * the same batch folder. Once the attempt is created, the paths
 * are stored verbatim on the attempt row; no rename / copy step is
 * needed.
 *
 * Path layout:
 *   cmf/{ownerId}/packets/{packetId}/refinements/{batchId}/{filename}
 *
 * `filename` should already be passed through `safeFileSlug` by the
 * upload route so we never write user-controlled characters to
 * storage. Orphaned uploads (where the user dropped files but
 * never submitted) live in storage indefinitely; flagged in the
 * plan as a quarterly cleanup TODO, not a launch blocker.
 */
export function refinementReferenceStoragePath(args: {
  ownerId: string
  packetId: string
  batchId: string
  filename: string
}): string {
  return `cmf/${args.ownerId}/packets/${args.packetId}/refinements/${args.batchId}/${args.filename}`
}

/**
 * Derive a public URL for a path inside the CMF storage bucket.
 *
 * The bucket is fronted by Supabase's public storage endpoint
 * (`{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}`), so
 * we can compose the URL without going through the supabase client
 * — handy on the server side of the render pipeline where we already
 * hold the path and just need bytes.
 *
 * Used by the render service to resolve refinement-reference paths
 * stored on `CmfRenderAttempt.referenceImagePaths` back into
 * downloadable URLs. Strict — throws if the env isn't configured so
 * an upstream caller can fail fast instead of silently passing the
 * model an empty string.
 */
export function publicUrlForCmfStoragePath(path: string): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL is not set; cannot resolve CMF storage path to a public URL.'
    )
  }
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${CMF_STORAGE_BUCKET}/${path}`
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
