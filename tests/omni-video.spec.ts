/**
 * gemini-veo-3.1 draws with Gemini Omni Flash (gemini-omni-1.1-flash) since 2026-10-07:
 * veo-3.1-generate-preview shuts down 2026-10-22. Omni is the Interactions API, not
 * predictLongRunning, so the request is a different shape: images then text as `input`,
 * `response_format` for the video, no durationSeconds (the length goes in the prompt).
 * The shapes follow Google's Omni page; no live call has checked them.
 */
import { test, expect } from '@playwright/test'
import { GeminiAdapter, VEO_3_1_CONFIG, NANO_BANANA_2_CONFIG } from '../src/lib/models/adapters/gemini'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YpukpoAAAAASUVORK5CYII='

function withFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; body: any; headers: any }> = []
  const real = globalThis.fetch
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, headers: init?.headers })
    return handler(url, init)
  }) as typeof fetch
  return { calls, restore: () => { globalThis.fetch = real } }
}

test.describe('Gemini Omni Flash', () => {
  const had = process.env.GEMINI_API_KEY
  test.beforeAll(() => { process.env.GEMINI_API_KEY = 'test-key' })
  test.afterAll(() => { if (had === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = had })

  test('first and last frame go as images then text to the Interactions API', async () => {
    const f = withFetch(() => new Response(JSON.stringify({ id: 'int-1', output_video: { data: 'AAAA', mime_type: 'video/mp4' } }), { status: 200 }))
    try {
      const adapter = new GeminiAdapter(VEO_3_1_CONFIG)
      const res = await adapter.generate({
        prompt: 'A slow push in on a sleeping cat',
        referenceImage: PNG,
        aspectRatio: '9:16',
        resolution: 720,
        duration: 6,
        parameters: { endFrameImage: PNG },
      } as any)
      expect(res.status).toBe('completed')
      expect(res.outputs?.[0].url).toBe('data:video/mp4;base64,AAAA')

      const call = f.calls.find((c) => c.url.endsWith('/interactions'))!
      expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
      expect(call.body.model).toBe('gemini-omni-1.1-flash')
      expect(call.body.input.map((p: any) => p.type)).toEqual(['image', 'image', 'text'])
      expect(call.body.input[2].text).toContain('about 6 seconds')
      expect(call.body.response_format).toEqual({ type: 'video', aspect_ratio: '9:16', resolution: '720p' })
      expect(JSON.stringify(call.body)).not.toContain('durationSeconds')
    } finally {
      f.restore()
    }
  })

  test('text alone is a string input; 1080p asks for a file and waits until it is ACTIVE', async () => {
    let polls = 0
    const f = withFetch((url) => {
      if (url.endsWith('/interactions')) {
        return new Response(JSON.stringify({ output_video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/vid9' } }), { status: 200 })
      }
      polls++
      return new Response(JSON.stringify({ name: 'files/vid9', state: 'ACTIVE', downloadUri: 'https://generativelanguage.googleapis.com/v1beta/files/vid9:download?alt=media' }), { status: 200 })
    })
    try {
      const adapter = new GeminiAdapter(VEO_3_1_CONFIG)
      const res = await adapter.generate({ prompt: 'Waves at dusk', aspectRatio: '16:9', resolution: 1080 } as any)
      expect(res.status).toBe('completed')
      expect(res.outputs?.[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/files/vid9:download?alt=media')
      const call = f.calls.find((c) => c.url.endsWith('/interactions'))!
      expect(typeof call.body.input).toBe('string')
      expect(call.body.response_format.delivery).toBe('uri')
      expect(polls).toBe(1)
    } finally {
      f.restore()
    }
  })
})

test.describe('Nano Banana 2.1', () => {
  test('gemini-nano-banana-2 offers no 0.5K and none of 2\'s extreme ratios', () => {
    const resolutions = NANO_BANANA_2_CONFIG.parameters?.find((p) => p.name === 'resolution')?.options?.map((o: any) => o.value)
    expect(resolutions).toEqual([1024, 2048, 4096])
    for (const r of ['1:4', '4:1', '1:8', '8:1']) expect(NANO_BANANA_2_CONFIG.supportedAspectRatios).not.toContain(r)
    expect(NANO_BANANA_2_CONFIG.name).toBe('Nano Banana 2.1')
  })

  test('draws with gemini-nano-banana-2.1 through generateContent, 512 asking for 1K', async () => {
    const had = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = 'test-key'
    const f = withFetch(() => new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }), { status: 200 }))
    try {
      const adapter = new GeminiAdapter(NANO_BANANA_2_CONFIG)
      const res = await adapter.generate({ prompt: 'A lemon', aspectRatio: '1:1', resolution: 512 } as any)
      expect(res.status).toBe('completed')
      const call = f.calls[0]
      expect(call.url).toContain('/models/gemini-nano-banana-2.1:generateContent')
      expect(call.body.generationConfig.imageConfig.imageSize).toBe('1K')
      const refused = await adapter.generate({ prompt: 'A lemon', aspectRatio: '1:8' } as any)
      expect(refused.status).toBe('failed')
      expect(refused.error).toContain('1:8')
    } finally {
      f.restore()
      if (had === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = had
    }
  })
})
