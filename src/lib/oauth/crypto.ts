/** Small crypto helpers for the OAuth server: base64url, HMAC, hashes, random tokens. */

import crypto from 'crypto'

export function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) return null
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4)
  try {
    return Buffer.from(padded, 'base64')
  } catch {
    return null
  }
}

export function hmac(secret: string, data: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest())
}

export function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

export function sha256B64url(data: string): string {
  return b64url(crypto.createHash('sha256').update(data).digest())
}

export function randomB64url(bytes = 32): string {
  return b64url(crypto.randomBytes(bytes))
}

export function randomUuid(): string {
  return crypto.randomUUID()
}

/** Constant-time string comparison; unequal lengths are unequal without a timing oracle on content. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab)
    return false
  }
  return crypto.timingSafeEqual(ab, bb)
}

/** `<b64url(json)>.<hmac>` signed with a purpose label, so one signature cannot stand in for another. */
export function signPayload(secret: string, purpose: string, payload: unknown): string {
  const body = b64url(JSON.stringify(payload))
  return `${body}.${hmac(secret, `${purpose}:${body}`)}`
}

export function verifyPayload<T>(secret: string, purpose: string, signed: string): T | null {
  const dot = signed.lastIndexOf('.')
  if (dot <= 0) return null
  const body = signed.slice(0, dot)
  const sig = signed.slice(dot + 1)
  if (!safeEqual(sig, hmac(secret, `${purpose}:${body}`))) return null
  const raw = fromB64url(body)
  if (!raw) return null
  try {
    return JSON.parse(raw.toString('utf8')) as T
  } catch {
    return null
  }
}
