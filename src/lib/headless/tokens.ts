/**
 * Headless Vesper credential token management.
 *
 * Tokens are issued in the form `vsp_live_<24-char-prefix>_<32-char-secret>`.
 * The prefix is non-secret and stored alongside the credential so we can
 * surface it in dashboards and audit logs without leaking the raw token.
 * The full token is hashed with SHA-256 before persisting; the plaintext
 * value is shown to the operator exactly once at creation time.
 *
 * This module is environment-agnostic (no Next.js imports) so it can be
 * used from server route handlers and from server-side scripts.
 */

import crypto from 'crypto'

const TOKEN_PREFIX = 'vsp_live'
const PREFIX_RANDOM_LEN = 8 // bytes -> 16 hex chars
const SECRET_RANDOM_LEN = 24 // bytes -> 48 hex chars

export interface IssuedToken {
  /** Plain bearer token. Only available at creation time. */
  rawToken: string
  /** Non-secret prefix for dashboard display and audit logs. */
  tokenPrefix: string
  /** SHA-256 hex digest stored on the credential row. */
  tokenHash: string
}

/**
 * Generate a fresh `vsp_live_*` token. The plaintext value MUST be shown to
 * the user once and then discarded; only `tokenHash` is persisted.
 */
export function issueHeadlessToken(): IssuedToken {
  const prefixRandom = crypto.randomBytes(PREFIX_RANDOM_LEN).toString('hex')
  const secretRandom = crypto.randomBytes(SECRET_RANDOM_LEN).toString('hex')
  const tokenPrefix = `${TOKEN_PREFIX}_${prefixRandom}`
  const rawToken = `${tokenPrefix}_${secretRandom}`
  const tokenHash = hashHeadlessToken(rawToken)

  return { rawToken, tokenPrefix, tokenHash }
}

/**
 * SHA-256 hash of a raw token. Tokens have enough entropy (24 bytes / 192
 * bits in the secret portion) that a single hash with no per-row salt is
 * appropriate, and using a deterministic hash lets us look up the row by
 * hash in a single indexed query without leaking timing information.
 */
export function hashHeadlessToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Compare two SHA-256 hex digests in constant time. The comparison itself
 * is not strictly required to be timing-safe because we look up by hash
 * (a single indexed equality), but doing it anyway costs nothing.
 */
export function safeCompareHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  const aBuf = Buffer.from(a, 'hex')
  const bBuf = Buffer.from(b, 'hex')
  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

/**
 * Extract a `vsp_live_*` token from an `Authorization: Bearer ...` header
 * or from a raw header value. Returns `null` if no plausible token was
 * present. The shape check is intentionally light — verification is done
 * by hashing and looking up the credential row.
 */
export function extractBearerToken(headerValue: string | null | undefined): string | null {
  if (!headerValue) return null
  const trimmed = headerValue.trim()
  if (!trimmed) return null
  // Accept "Bearer <token>" or a bare token value.
  const match = /^Bearer\s+(.+)$/i.exec(trimmed)
  const token = match ? match[1].trim() : trimmed
  if (!token.startsWith(`${TOKEN_PREFIX}_`)) return null
  // Reject obviously malformed tokens.
  if (token.length < TOKEN_PREFIX.length + 1 + 16 + 1 + 32) return null
  return token
}
