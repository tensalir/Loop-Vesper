import { test, expect } from '@playwright/test'
import {
  issueHeadlessToken,
  hashHeadlessToken,
  safeCompareHash,
  extractBearerToken,
} from '../src/lib/headless/tokens'

/**
 * Pure unit tests for headless token utilities. These functions have no
 * Next.js, Prisma, or filesystem dependencies, so we can import the real
 * source directly and verify the wire-level behaviour.
 */

test.describe('issueHeadlessToken', () => {
  test('emits the vsp_live_ prefix', () => {
    const issued = issueHeadlessToken()
    expect(issued.rawToken.startsWith('vsp_live_')).toBe(true)
    expect(issued.tokenPrefix.startsWith('vsp_live_')).toBe(true)
  })

  test('plaintext token contains the prefix', () => {
    const issued = issueHeadlessToken()
    expect(issued.rawToken.startsWith(`${issued.tokenPrefix}_`)).toBe(true)
  })

  test('hash matches sha256 of raw token', () => {
    const issued = issueHeadlessToken()
    expect(issued.tokenHash).toBe(hashHeadlessToken(issued.rawToken))
  })

  test('two issued tokens differ in prefix and secret', () => {
    const a = issueHeadlessToken()
    const b = issueHeadlessToken()
    expect(a.rawToken).not.toBe(b.rawToken)
    expect(a.tokenPrefix).not.toBe(b.tokenPrefix)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })

  test('hash has expected sha256 hex length (64 chars)', () => {
    const issued = issueHeadlessToken()
    expect(issued.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('different raw tokens produce different hashes', () => {
    expect(hashHeadlessToken('vsp_live_aa_bb')).not.toBe(
      hashHeadlessToken('vsp_live_aa_bc')
    )
  })
})

test.describe('safeCompareHash', () => {
  test('returns true for identical hashes', () => {
    const a = hashHeadlessToken('foo')
    expect(safeCompareHash(a, a)).toBe(true)
  })

  test('returns false for different hashes', () => {
    const a = hashHeadlessToken('foo')
    const b = hashHeadlessToken('bar')
    expect(safeCompareHash(a, b)).toBe(false)
  })

  test('returns false for length mismatch', () => {
    expect(safeCompareHash('aaaa', 'aaaaaa')).toBe(false)
  })
})

test.describe('extractBearerToken', () => {
  test('extracts token from "Bearer <token>" header', () => {
    const issued = issueHeadlessToken()
    const extracted = extractBearerToken(`Bearer ${issued.rawToken}`)
    expect(extracted).toBe(issued.rawToken)
  })

  test('extracts token from bare value', () => {
    const issued = issueHeadlessToken()
    expect(extractBearerToken(issued.rawToken)).toBe(issued.rawToken)
  })

  test('returns null for missing header', () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
  })

  test('returns null for non-vsp prefix', () => {
    expect(extractBearerToken('Bearer foo_bar_baz')).toBeNull()
    expect(extractBearerToken('Bearer eyJhbGciOiJIUzI1NiJ9.x.y')).toBeNull()
  })

  test('rejects obviously malformed tokens', () => {
    expect(extractBearerToken('Bearer vsp_live_short')).toBeNull()
  })

  test('case-insensitive Bearer prefix', () => {
    const issued = issueHeadlessToken()
    expect(extractBearerToken(`bearer ${issued.rawToken}`)).toBe(issued.rawToken)
    expect(extractBearerToken(`BEARER ${issued.rawToken}`)).toBe(issued.rawToken)
  })
})
