/**
 * The preview id: proof that what is filed is what the colleague saw.
 *
 *   b64url(json{h, r, e, t, k, v}) + "." + b64url(HMAC-SHA256(FEEDBACK_HMAC_SECRET, first part))
 *
 * h  sha256 of the rendered issue (title, labels, body, mode, issue number)
 * r  the reporter's profile id: only the person who previewed can file it
 * e  expiry, epoch milliseconds (15 minutes)
 * t  when the remark was made, k the kit commit, v the plugin version: the
 *    parts of the body the preview chose, fixed so the submission renders the
 *    same bytes
 */

import crypto from 'node:crypto'
import type { Pinned } from './render'

export const PREVIEW_TTL_MS = 15 * 60 * 1000

export interface PreviewClaims {
  h: string
  r: string
  e: number
  t: string
  k: string | null
  v: string
}

export class PreviewInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreviewInvalid'
  }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function mac(secret: string, part: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(part).digest())
}

export function signPreview(secret: string, claims: PreviewClaims): string {
  if (!secret || secret.length < 16) throw new Error('FEEDBACK_HMAC_SECRET is not set (at least 16 characters).')
  const part = b64url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${part}.${mac(secret, part)}`
}

/** The claims of a genuine, unexpired preview made by this person; throws otherwise. */
export function verifyPreview(secret: string, token: string, profileId: string, nowMs: number): PreviewClaims {
  const [part, sig, extra] = String(token || '').split('.')
  if (!part || !sig || extra !== undefined) throw new PreviewInvalid('That is not a preview id Vesper made. Preview again.')
  const want = mac(secret, part)
  const a = Buffer.from(sig)
  const b = Buffer.from(want)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new PreviewInvalid('That preview id was not made by this Vesper, or it was changed. Preview again.')
  }
  let claims: PreviewClaims
  try {
    claims = JSON.parse(fromB64url(part).toString('utf8')) as PreviewClaims
  } catch {
    throw new PreviewInvalid('That preview id does not read. Preview again.')
  }
  if (claims.r !== profileId) {
    throw new PreviewInvalid('That preview was made by someone else. A remark is filed only by the person who said it; preview it as yourself.')
  }
  if (!(claims.e > nowMs)) throw new PreviewInvalid('That preview is more than 15 minutes old. Preview again and show them the text.')
  return claims
}

export function pinnedFrom(claims: PreviewClaims): Pinned {
  return { askedAt: claims.t, kitCommit: claims.k, pluginVersion: claims.v }
}
