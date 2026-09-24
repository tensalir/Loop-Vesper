/**
 * The picture under review, byte for byte, from one of three places:
 *
 * - an output of the caller's own (a draw Vesper made, in the project "Claude" or anywhere they
 *   own): its colourway and view are read from the draw's record, and the colourway is a trusted
 *   claim with source `prompt`, because it was an instruction Vesper sent the model;
 * - a Frontify asset id: the original, as the repository's `frontify.py` pulls it;
 * - an https URL on Vesper's fetch allowlist.
 *
 * Nothing is resized or re-encoded: a grade of a copy is a grade of a different picture.
 */

import crypto from 'crypto'

export const CANDIDATE_MAX_BYTES = 60 * 1024 * 1024

export interface CandidateSource {
  output_id?: string
  frontify_asset_id?: string
  image_url?: string
}

export interface LoadedCandidate {
  bytes: Buffer
  mimeType: string
  sha256: string
  source: 'output' | 'frontify' | 'url'
  outputId: string | null
  frontifyAssetId: string | null
  imageUrl: string | null
  /** From an own draw's record: what it was drawn as. */
  drawn: { product: string | null; colourway: string | null; view: string | null } | null
}

export interface CandidateDeps {
  /** The output and its generation, when the owner may read it; null otherwise. */
  findOwnOutput(outputId: string, ownerId: string): Promise<{ fileUrl: string; parameters: unknown } | null>
  fetchUrl(url: string): Promise<{ bytes: Buffer; contentType: string }>
  fetchFrontify(assetId: string): Promise<{ bytes: Buffer; contentType: string } | null>
}

export class CandidateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CandidateError'
  }
}

function sha(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

/** What an own draw was drawn as, from `parameters.creative` (written by generate_product_image). */
export function drawnAs(parameters: unknown): LoadedCandidate['drawn'] {
  const p = (parameters && typeof parameters === 'object' ? parameters : {}) as Record<string, unknown>
  const c = (p.creative && typeof p.creative === 'object' ? p.creative : null) as Record<string, unknown> | null
  if (!c) return null
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return { product: s(c.product), colourway: s(c.colourway), view: s(c.view) }
}

export async function loadCandidate(src: CandidateSource, ownerId: string, deps: CandidateDeps): Promise<LoadedCandidate> {
  const given = [src.output_id, src.frontify_asset_id, src.image_url].filter(Boolean).length
  if (given !== 1) throw new CandidateError('name exactly one picture: output_id, frontify_asset_id or image_url')

  if (src.output_id) {
    const own = await deps.findOwnOutput(src.output_id, ownerId)
    if (!own) throw new CandidateError(`no output '${src.output_id}' of yours in Vesper`)
    const got = await deps.fetchUrl(own.fileUrl)
    return {
      bytes: got.bytes,
      mimeType: got.contentType,
      sha256: sha(got.bytes),
      source: 'output',
      outputId: src.output_id,
      frontifyAssetId: null,
      imageUrl: null,
      drawn: drawnAs(own.parameters),
    }
  }
  if (src.frontify_asset_id) {
    const got = await deps.fetchFrontify(src.frontify_asset_id)
    if (!got) throw new CandidateError(`Frontify has no image for asset '${src.frontify_asset_id}'`)
    return {
      bytes: got.bytes,
      mimeType: got.contentType,
      sha256: sha(got.bytes),
      source: 'frontify',
      outputId: null,
      frontifyAssetId: src.frontify_asset_id,
      imageUrl: null,
      drawn: null,
    }
  }
  const url = src.image_url!
  if (!/^https:\/\//i.test(url)) throw new CandidateError('image_url must be https')
  const got = await deps.fetchUrl(url)
  return {
    bytes: got.bytes,
    mimeType: got.contentType,
    sha256: sha(got.bytes),
    source: 'url',
    outputId: null,
    frontifyAssetId: null,
    imageUrl: url,
    drawn: null,
  }
}
