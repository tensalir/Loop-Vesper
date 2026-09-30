/**
 * The two things that stopped a Veo video asked for through Claude.
 *
 * 1. Veo returns a Gemini Files URI, not the bytes. `uploadUrlToStorage` fetched it with no API
 *    key, Google answered 403, and the error read "Failed to upload URL to storage: Failed to
 *    fetch from URL: Forbidden" — a provider refusal wearing a storage problem's clothes. The web
 *    generation processor sent the key; the MCP paths and the CMF render did not.
 * 2. A video model's MCP wall was 30s, doubled to 60s by `generate_video`. Veo 3.1 does not
 *    finish in a minute, so the job was given up on while the render was still going — although
 *    video runs async under a function with 300s.
 */
import { test, expect } from '@playwright/test'
import { GEMINI_FILES_HOST, providerFetchHeaders } from '../src/lib/storage/provider-fetch'
import { getMcpGenerationTimeoutMs } from '../src/lib/headless/mcp-timeout'
import { VIDEO_MODEL_IDS, PHASE_1_MODEL_IDS } from '../src/lib/headless/model-allowlists'

const VEO_OUTPUT = `https://${GEMINI_FILES_HOST}/v1beta/files/abc123:download?alt=media`

test('a Veo output is fetched with the Gemini API key', () => {
  expect(providerFetchHeaders(VEO_OUTPUT, undefined, 'the-key')).toEqual({ 'x-goog-api-key': 'the-key' })
})

test('without a key configured nothing is invented', () => {
  expect(providerFetchHeaders(VEO_OUTPUT, undefined, '')).toEqual({})
  // and with the argument left off entirely, the environment decides
  const had = process.env.GEMINI_API_KEY
  try {
    delete process.env.GEMINI_API_KEY
    expect(providerFetchHeaders(VEO_OUTPUT)).toEqual({})
    process.env.GEMINI_API_KEY = 'from-the-environment'
    expect(providerFetchHeaders(VEO_OUTPUT)).toEqual({ 'x-goog-api-key': 'from-the-environment' })
  } finally {
    if (had === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = had
  }
})

test("the caller's own key wins, whatever its casing", () => {
  expect(providerFetchHeaders(VEO_OUTPUT, { 'x-goog-api-key': 'theirs' }, 'ours')).toEqual({
    'x-goog-api-key': 'theirs',
  })
  expect(providerFetchHeaders(VEO_OUTPUT, { 'X-Goog-Api-Key': 'theirs' }, 'ours')).toEqual({
    'X-Goog-Api-Key': 'theirs',
  })
})

test('another host is left alone, and other headers are kept', () => {
  expect(providerFetchHeaders('https://replicate.delivery/xyz/out.mp4', undefined, 'the-key')).toEqual({})
  expect(providerFetchHeaders('https://replicate.delivery/xyz/out.mp4', { authorization: 'Bearer x' }, 'the-key')).toEqual({
    authorization: 'Bearer x',
  })
  // one of our own stored files: signed by the caller, never given Google's key
  expect(providerFetchHeaders('https://project.supabase.co/storage/v1/object/sign/generated-videos/a.mp4?token=t', undefined, 'the-key')).toEqual({})
})

test('a video model gets a wall Veo can meet, not a minute', () => {
  // generate_video doubles it, so this is half the wall it applies
  const wall = getMcpGenerationTimeoutMs('gemini-veo-3.1') * 2
  expect(wall).toBeGreaterThanOrEqual(180_000)
  // and stays inside /api/cron/mcp-jobs' maxDuration of 300s, with room to upload and record
  expect(wall).toBeLessThanOrEqual(270_000)
})

test('every video model gets the video wall, and no image model is slowed to it', () => {
  for (const id of VIDEO_MODEL_IDS) {
    expect(getMcpGenerationTimeoutMs(id) * 2, `${id} wall`).toBeGreaterThanOrEqual(180_000)
  }
  for (const id of PHASE_1_MODEL_IDS) {
    expect(getMcpGenerationTimeoutMs(id), `${id} wall`).toBeLessThanOrEqual(120_000)
  }
})
