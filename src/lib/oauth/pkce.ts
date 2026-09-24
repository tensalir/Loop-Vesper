/** PKCE (RFC 7636), S256 only: a plain challenge is refused, so a stolen code alone is worth nothing. */

import { safeEqual, sha256B64url } from './crypto'

/** An S256 challenge is the base64url of a 32-byte hash: 43 characters. */
export function isValidChallenge(challenge: unknown): challenge is string {
  return typeof challenge === 'string' && /^[A-Za-z0-9_-]{43}$/.test(challenge)
}

export function isValidVerifier(verifier: unknown): verifier is string {
  return typeof verifier === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
}

export function s256(verifier: string): string {
  return sha256B64url(verifier)
}

export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isValidVerifier(verifier)) return false
  return safeEqual(s256(verifier), challenge)
}
