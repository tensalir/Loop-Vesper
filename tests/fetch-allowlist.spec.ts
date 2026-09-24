import { test, expect } from '@playwright/test'
import {
  allowedHostPatterns,
  assertAllowlistedUrl,
  fetchAllowlisted,
  isHostAllowed,
  referenceToDataUrl,
  splitDataUrl,
  FetchNotAllowedError,
} from '../src/lib/net/fetch-allowlisted'

/**
 * Caller-supplied URLs are fetched only from hosts Vesper trusts; before
 * this, any host (including addresses inside the hosting network) was fetched.
 */

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co',
  VESPER_FETCH_ALLOWLIST: 'cdn.loop.example, *.assets.example',
} as unknown as NodeJS.ProcessEnv
const PATTERNS = allowedHostPatterns(ENV)

function response(body: Uint8Array | string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(typeof body === 'string' ? body : Buffer.from(body), {
    status: init.status ?? 200,
    headers: init.headers ?? { 'content-type': 'image/png' },
  })
}

test.describe('host allowlist', () => {
  test('built-in, own Supabase and environment hosts', () => {
    expect(isHostAllowed('abcd.supabase.co', PATTERNS)).toBe(true)
    expect(isHostAllowed('loop.frontify.com', PATTERNS)).toBe(true)
    expect(isHostAllowed('media.ffycdn.net', PATTERNS)).toBe(true)
    expect(isHostAllowed('replicate.delivery', PATTERNS)).toBe(true)
    expect(isHostAllowed('pbxt.replicate.delivery', PATTERNS)).toBe(true)
    expect(isHostAllowed('cdn.loop.example', PATTERNS)).toBe(true)
    expect(isHostAllowed('x.assets.example', PATTERNS)).toBe(true)
  })

  test('refuses other hosts, lookalikes and bare wildcard roots', () => {
    expect(isHostAllowed('other.supabase.co', PATTERNS)).toBe(false)
    expect(isHostAllowed('frontify.com.evil.example', PATTERNS)).toBe(false)
    expect(isHostAllowed('evilfrontify.com', PATTERNS)).toBe(false)
    expect(isHostAllowed('assets.example', PATTERNS)).toBe(false)
    expect(isHostAllowed('169.254.169.254', PATTERNS)).toBe(false)
  })

  test('assertAllowlistedUrl refuses http, credentials and unknown hosts', () => {
    expect(() => assertAllowlistedUrl('http://abcd.supabase.co/x.png', PATTERNS)).toThrow(FetchNotAllowedError)
    expect(() => assertAllowlistedUrl('https://u:p@abcd.supabase.co/x.png', PATTERNS)).toThrow(/credentials/)
    expect(() => assertAllowlistedUrl('https://example.org/x.png', PATTERNS)).toThrow(/allowlist/)
    expect(() => assertAllowlistedUrl('not a url', PATTERNS)).toThrow(/valid URL/)
    expect(assertAllowlistedUrl('https://abcd.supabase.co/x.png', PATTERNS).hostname).toBe('abcd.supabase.co')
  })
})

test.describe('fetchAllowlisted', () => {
  test('follows a redirect on the list and returns the bytes', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string) => {
      calls.push(url)
      if (url.includes('/start')) {
        return response('', { status: 302, headers: { location: 'https://abcd.supabase.co/final.png' } })
      }
      return response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof fetch
    const out = await fetchAllowlisted('https://abcd.supabase.co/start', { patterns: PATTERNS, fetchImpl })
    expect(out.buffer.length).toBe(3)
    expect(out.finalUrl).toBe('https://abcd.supabase.co/final.png')
    expect(calls).toHaveLength(2)
  })

  test('a redirect off the list is refused', async () => {
    const fetchImpl = (async () =>
      response('', { status: 301, headers: { location: 'http://169.254.169.254/latest' } })) as unknown as typeof fetch
    await expect(
      fetchAllowlisted('https://abcd.supabase.co/start', { patterns: PATTERNS, fetchImpl })
    ).rejects.toThrow(FetchNotAllowedError)
  })

  test('oversize bodies are refused, by header and by stream', async () => {
    const declared = (async () =>
      response(new Uint8Array(10), { headers: { 'content-type': 'image/png', 'content-length': String(50 * 1024 * 1024) } })) as unknown as typeof fetch
    await expect(
      fetchAllowlisted('https://abcd.supabase.co/big.png', { patterns: PATTERNS, fetchImpl: declared })
    ).rejects.toThrow(/cap/)

    const streamed = (async () => response(new Uint8Array(2048))) as unknown as typeof fetch
    await expect(
      fetchAllowlisted('https://abcd.supabase.co/big.png', { patterns: PATTERNS, fetchImpl: streamed, maxBytes: 1024 })
    ).rejects.toThrow(/cap/)
  })

  test('only images and PDFs', async () => {
    const html = (async () => response('<html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    await expect(
      fetchAllowlisted('https://abcd.supabase.co/page', { patterns: PATTERNS, fetchImpl: html })
    ).rejects.toThrow(/not an image/)
  })
})

test.describe('referenceToDataUrl', () => {
  test('data URLs pass through; bare base64 is wrapped; https is fetched', async () => {
    expect(await referenceToDataUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    const bare = 'A'.repeat(80)
    expect(await referenceToDataUrl(bare)).toBe(`data:image/jpeg;base64,${bare}`)
    const fetchImpl = (async () => response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch
    const url = await referenceToDataUrl('https://abcd.supabase.co/r.jpg', { patterns: PATTERNS, fetchImpl })
    expect(url).toBe(`data:image/jpeg;base64,${Buffer.from([255, 216, 255]).toString('base64')}`)
  })

  test('an https reference is inlined, never sent as an empty image', async () => {
    const fetchImpl = (async () => response(new Uint8Array([1, 2, 3, 4]))) as unknown as typeof fetch
    const url = await referenceToDataUrl('https://abcd.supabase.co/r.png', { patterns: PATTERNS, fetchImpl })
    const { mediaType, base64 } = splitDataUrl(url)
    expect(mediaType).toBe('image/png')
    expect(base64.length).toBeGreaterThan(0)
  })

  test('anything else is refused', async () => {
    await expect(referenceToDataUrl('ftp://x/y.png')).rejects.toThrow(FetchNotAllowedError)
  })
})
