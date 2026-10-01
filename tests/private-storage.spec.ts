import { test, expect } from '@playwright/test'
import {
  canonicalStorageUrl,
  findStorageUrls,
  parseStorageRef,
  toDownloadUrl,
  toViewUrl,
} from '../src/lib/storage/refs'
import {
  CLAUDE_TTL_SECONDS,
  MODEL_INPUT_TTL_SECONDS,
  SERVER_READ_TTL_SECONDS,
  VIEW_TTL_SECONDS,
  setStorageSignerForTests,
  signStoredUrl,
  signStoredUrlsDeep,
  type StorageSigner,
} from '../src/lib/storage/access'
import { handleStorageRequest, REDIRECT_MAX_AGE_SECONDS } from '../src/lib/storage/browser-route'
import { mediaAccessProblem, mediaAccessDomains, mediaAccessEmails } from '../src/lib/storage/media-access'
import { storageImageLoader } from '../src/lib/storage/image-loader'
import { fetchAllowlisted, allowedHostPatterns } from '../src/lib/net/fetch-allowlisted'
import { downloadReferenceImageAsDataUrl } from '../src/lib/reference-images'
import { withSignedInputs } from '../src/lib/models/registry'
import { BaseModelAdapter, type GenerationRequest, type GenerationResponse } from '../src/lib/models/base'
import { dispatch } from '../src/lib/headless/mcp-dispatch'
import { TOOL_HANDLERS } from '../src/lib/headless/tools'
import type { ToolPrincipal } from '../src/lib/headless/tools/types'
import type { HeadlessTool } from '../src/lib/headless/tool-registry'

/**
 * The three media buckets were public: every render, video and product render, unreleased
 * colourways included, opened for anyone holding its URL. The code now signs every read, so the
 * buckets can be made private. The deploy goes first and the flip after, so each consumer is run
 * here against a fake storage twice, once with the buckets still public and once private, and
 * must work both times without handing anyone a public URL.
 */

const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co').replace(/\/+$/, '')
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE

const RENDER_PATH = 'mcp/cred-1/0b6f/0.jpg'
const RENDER = `${BASE}/storage/v1/object/public/generated-images/${RENDER_PATH}`
const PREVIEW = `${BASE}/storage/v1/object/public/generated-images/mcp/cred-1/0b6f/0-preview.jpg`
const CLIP = `${BASE}/storage/v1/object/public/generated-videos/u1/g1/0.mp4`
const PRODUCT = `${BASE}/storage/v1/object/public/product-renders/products/Quiet%202/Mint-1727.png`
const PROVIDER = 'https://replicate.delivery/pbxt/abc/out.png'
const DATA = 'data:image/png;base64,iVBORw0KGgo='
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

type Mode = 'public' | 'private'

/**
 * Supabase as the code meets it: a signer, and the HTTP answers for public and signed URLs.
 * A public URL opens only while the bucket is public (Supabase answers 400 once it is not);
 * a signed URL opens either way.
 */
function fakeStorage(mode: Mode) {
  const files = new Set([
    `generated-images/${RENDER_PATH}`,
    'generated-images/mcp/cred-1/0b6f/0-preview.jpg',
    'generated-videos/u1/g1/0.mp4',
    'product-renders/products/Quiet 2/Mint-1727.png',
  ])
  const signs: Array<{ bucket: string; paths: string[]; ttl: number; download?: string }> = []
  const signer: StorageSigner = {
    async sign(bucket, paths, ttl, options) {
      signs.push({ bucket, paths, ttl, download: options?.download })
      return paths.map((p) =>
        files.has(`${bucket}/${p}`)
          ? `${BASE}/storage/v1/object/sign/${bucket}/${encodeURI(p)}?token=t${ttl}${options?.download ? `&download=${options.download}` : ''}`
          : null
      )
    },
  }
  const opened: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input)
    opened.push(url)
    const u = new URL(url)
    const signed = /\/object\/sign\//.test(u.pathname) && u.searchParams.has('token')
    const isPublic = /\/object\/public\//.test(u.pathname)
    if (u.origin === BASE && (signed || (isPublic && mode === 'public'))) {
      return new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    if (u.origin === BASE && isPublic) return new Response('{"error":"Bucket not found"}', { status: 400 })
    return new Response('not found', { status: 404 })
  }) as typeof fetch
  return { signer, signs, fetchImpl, opened }
}

function noPublicUrl(value: unknown) {
  expect(JSON.stringify(value)).not.toContain('/storage/v1/object/public/')
}

test.afterEach(() => setStorageSignerForTests(null))

test.describe('reading a stored URL back to bucket and path', () => {
  test('public, signed, authenticated and resized forms, the route, and a bare path', () => {
    expect(parseStorageRef(RENDER)).toEqual({ bucket: 'generated-images', path: RENDER_PATH })
    expect(parseStorageRef(`${BASE}/storage/v1/object/sign/generated-images/${RENDER_PATH}?token=abc`)).toEqual({ bucket: 'generated-images', path: RENDER_PATH })
    expect(parseStorageRef(`${BASE}/storage/v1/object/authenticated/generated-videos/u1/g1/0.mp4`)).toEqual({ bucket: 'generated-videos', path: 'u1/g1/0.mp4' })
    expect(parseStorageRef(`${BASE}/storage/v1/render/image/public/product-renders/a.png?width=200`)).toEqual({ bucket: 'product-renders', path: 'a.png' })
    expect(parseStorageRef(PRODUCT)).toEqual({ bucket: 'product-renders', path: 'products/Quiet 2/Mint-1727.png' })
    expect(parseStorageRef('/api/storage/generated-images/mcp/cred-1/0b6f/0.jpg?w=640')).toEqual({ bucket: 'generated-images', path: RENDER_PATH })
    expect(parseStorageRef(`generated-images/${RENDER_PATH}`, { allowBare: true })).toEqual({ bucket: 'generated-images', path: RENDER_PATH })
  })

  test('leaves alone what is not one of the three buckets in this project', () => {
    expect(parseStorageRef(PROVIDER)).toBeNull()
    expect(parseStorageRef(DATA)).toBeNull()
    expect(parseStorageRef('blob:https://vesper.example/1')).toBeNull()
    expect(parseStorageRef('https://other.supabase.co/storage/v1/object/public/generated-images/a.jpg')).toBeNull()
    expect(parseStorageRef(`${BASE}/storage/v1/object/public/packaging-files/a.pdf`)).toBeNull()
    expect(parseStorageRef(`${BASE}/storage/v1/object/public/creative-pins/a.png`)).toBeNull()
    expect(parseStorageRef('/api/storage/generated-images/../secrets')).toBeNull()
    expect(parseStorageRef(`generated-images/${RENDER_PATH}`)).toBeNull()
  })

  test('a signed URL goes back to its public form before it is stored', () => {
    expect(canonicalStorageUrl(`${BASE}/storage/v1/object/sign/generated-images/${RENDER_PATH}?token=abc`)).toBe(RENDER)
    expect(canonicalStorageUrl(PROVIDER)).toBe(PROVIDER)
  })

  test('finds the URL in a markdown image line and leaves the punctuation out', () => {
    const hits = findStorageUrls(`![Image 1 from x](${PREVIEW})\nFull resolution: ${RENDER}.`)
    expect(hits.map((h) => h.url)).toEqual([PREVIEW, RENDER])
  })
})

test.describe('people in the web app', () => {
  test('pages load stored files through the signed-in route, never the public URL', () => {
    expect(toViewUrl(RENDER)).toBe('/api/storage/generated-images/mcp/cred-1/0b6f/0.jpg')
    expect(toViewUrl(PRODUCT)).toBe('/api/storage/product-renders/products/Quiet%202/Mint-1727.png')
    expect(toViewUrl(PROVIDER)).toBe(PROVIDER)
    expect(toViewUrl(DATA)).toBe(DATA)
    expect(toViewUrl(null)).toBeNull()
    expect(toDownloadUrl(CLIP, 'video-1.mp4')).toBe('/api/storage/generated-videos/u1/g1/0.mp4?download=video-1.mp4')
    expect(storageImageLoader({ src: RENDER, width: 640, quality: 75 })).toBe('/api/storage/generated-images/mcp/cred-1/0b6f/0.jpg?w=640&q=75')
    expect(storageImageLoader({ src: PROVIDER, width: 640 })).toBe(`/_next/image?url=${encodeURIComponent(PROVIDER)}&w=640&q=75`)
  })

  for (const mode of ['public', 'private'] as Mode[]) {
    test(`a signed-in person opens a render, a clip and a download (bucket ${mode})`, async () => {
      const s = fakeStorage(mode)
      const deps = { authenticate: async () => null, signer: s.signer, fetchImpl: s.fetchImpl }

      const res = await handleStorageRequest({ bucket: 'generated-images', path: RENDER_PATH.split('/'), searchParams: new URLSearchParams() }, deps)
      expect(res.status).toBe(302)
      expect(res.headers.get('cache-control')).toBe(`private, max-age=${REDIRECT_MAX_AGE_SECONDS}`)
      const location = res.headers.get('location')!
      noPublicUrl(location)
      expect(s.signs.at(-1)?.ttl).toBe(VIEW_TTL_SECONDS)
      expect((await s.fetchImpl(location)).status).toBe(200)

      const clip = await handleStorageRequest({ bucket: 'generated-videos', path: ['u1', 'g1', '0.mp4'], searchParams: new URLSearchParams('download=video 1.mp4') }, deps)
      expect(clip.status).toBe(302)
      expect(s.signs.at(-1)?.download).toBe('video-1.mp4')
      expect((await s.fetchImpl(clip.headers.get('location')!)).status).toBe(200)

      // The old public URL: still open while public, 400 once private. The route works either way.
      expect((await s.fetchImpl(RENDER)).status).toBe(mode === 'public' ? 200 : 400)
    })

    test(`next/image asks for a resized copy made behind the sign-in (bucket ${mode})`, async () => {
      const s = fakeStorage(mode)
      const res = await handleStorageRequest(
        { bucket: 'generated-images', path: RENDER_PATH, searchParams: new URLSearchParams('w=640&q=75') },
        { authenticate: async () => null, signer: s.signer, fetchImpl: s.fetchImpl, resize: async (_input, width) => Buffer.from(`webp-${width}`) }
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('cache-control')).toMatch(/^private/)
      expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('webp-640')
      expect(s.signs.at(-1)?.ttl).toBe(SERVER_READ_TTL_SECONDS)
      noPublicUrl(s.opened)
    })
  }

  test('no sign-in, no file; nothing is signed', async () => {
    const s = fakeStorage('private')
    const res = await handleStorageRequest(
      { bucket: 'generated-images', path: RENDER_PATH, searchParams: new URLSearchParams() },
      { authenticate: async () => ({ status: 401, error: 'Unauthorized' }), signer: s.signer }
    )
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
    expect(s.signs).toHaveLength(0)
  })

  test('other buckets, odd widths and missing files are refused', async () => {
    const s = fakeStorage('private')
    const deps = { authenticate: async () => null, signer: s.signer, fetchImpl: s.fetchImpl }
    expect((await handleStorageRequest({ bucket: 'packaging-files', path: 'a.pdf', searchParams: new URLSearchParams() }, deps)).status).toBe(404)
    expect((await handleStorageRequest({ bucket: 'generated-images', path: RENDER_PATH, searchParams: new URLSearchParams('w=333') }, deps)).status).toBe(400)
    expect((await handleStorageRequest({ bucket: 'generated-images', path: 'nope.jpg', searchParams: new URLSearchParams() }, deps)).status).toBe(404)
  })
})

test.describe('Claude, through the MCP connector', () => {
  const principal: ToolPrincipal = {
    credentialId: 'cred-1',
    ownerId: 'owner-1',
    allowedTools: ['get_generation_status', 'export_creative_records'] as HeadlessTool[],
    allowedModels: ['*'],
  }

  function handlersReturning(urls: { render: string; preview: string }) {
    const result = {
      content: [
        { type: 'text' as const, text: `Generated 1 image. Full resolution: ${urls.render}` },
        { type: 'text' as const, text: `To show the person the picture:\n![Image 1 from gemini](${urls.preview})` },
        { type: 'resource_link' as const, uri: urls.render, name: 'x.jpg', mimeType: 'image/jpeg' },
        { type: 'image' as const, data: JPEG.toString('base64'), mimeType: 'image/jpeg' },
      ],
      structuredContent: { outputs: [{ url: urls.render, previewUrl: urls.preview, outputId: 'o1' }] },
    }
    return {
      ...TOOL_HANDLERS,
      get_generation_status: { run: async () => result },
      export_creative_records: { run: async () => ({ content: [{ type: 'text' as const, text: '1 grades.' }], structuredContent: { rows: [{ imageUrl: urls.render }] } }) },
    }
  }

  for (const mode of ['public', 'private'] as Mode[]) {
    test(`the markdown image, the links and the structured result are signed for a week (bucket ${mode})`, async () => {
      const s = fakeStorage(mode)
      setStorageSignerForTests(s.signer)
      const res = (await dispatch(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_generation_status', arguments: { jobId: 'j1' } } },
        principal,
        { handlers: handlersReturning({ render: RENDER, preview: PREVIEW }), recordUsage: async () => undefined }
      )) as { result: { content: Array<Record<string, string>>; structuredContent: { outputs: Array<Record<string, string>> } } }

      noPublicUrl(res.result)
      expect(s.signs).toHaveLength(1) // one call for the bucket, however many URLs
      expect(s.signs[0].ttl).toBe(CLAUDE_TTL_SECONDS)
      const markdown = res.result.content[1].text
      const inReply = /!\[[^\]]*\]\(([^)]+)\)/.exec(markdown)![1]
      const link = res.result.content[2].uri
      const structured = res.result.structuredContent.outputs[0]
      for (const url of [inReply, link, structured.url, structured.previewUrl]) {
        expect((await s.fetchImpl(url)).status).toBe(200)
      }
      expect(res.result.content[3].data).toBe(JPEG.toString('base64'))
    })
  }

  test('exported records keep the canonical URL, as the REST export does', async () => {
    const s = fakeStorage('private')
    setStorageSignerForTests(s.signer)
    const res = (await dispatch(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'export_creative_records', arguments: { kind: 'grades' } } },
      principal,
      { handlers: handlersReturning({ render: RENDER, preview: PREVIEW }), recordUsage: async () => undefined }
    )) as { result: { structuredContent: { rows: Array<{ imageUrl: string }> } } }
    expect(res.result.structuredContent.rows[0].imageUrl).toBe(RENDER)
    expect(s.signs).toHaveLength(0)
  })
})

test.describe('model providers (Replicate, Kling, fal, OpenAI, Gemini)', () => {
  class RecordingAdapter extends BaseModelAdapter {
    seen: GenerationRequest | null = null
    constructor(private readonly open: typeof fetch) {
      super({ id: 'fake', name: 'Fake', provider: 'Test', type: 'video', description: '' })
    }
    async generate(request: GenerationRequest): Promise<GenerationResponse> {
      this.seen = request
      // What a provider does with an input URL: fetch it.
      const urls = [request.referenceImageUrl, ...(request.referenceImages ?? []), request.parameters?.endFrameImageUrl, ...(request.parameters?.referenceVideoUrls ?? [])]
      for (const url of urls.filter((u): u is string => typeof u === 'string' && u.startsWith('https://') && !u.includes('replicate.delivery'))) {
        const res = await this.open(url)
        if (!res.ok) return { id: 'x', status: 'failed', error: `input ${url} answered ${res.status}` }
      }
      return { id: 'x', status: 'completed', outputs: [] }
    }
  }

  for (const mode of ['public', 'private'] as Mode[]) {
    test(`every stored input reaches the adapter signed for an hour, however deep (bucket ${mode})`, async () => {
      const s = fakeStorage(mode)
      setStorageSignerForTests(s.signer)
      const adapter = withSignedInputs(new RecordingAdapter(s.fetchImpl))
      const request: GenerationRequest = {
        prompt: 'a clip',
        referenceImageUrl: RENDER,
        referenceImages: [PRODUCT, DATA, PROVIDER],
        parameters: { endFrameImageUrl: PREVIEW, referenceVideoUrls: [CLIP] },
      }
      const out = await adapter.generate(request)
      expect(out.status).toBe('completed')
      noPublicUrl(adapter.seen)
      expect(adapter.seen!.referenceImages![1]).toBe(DATA)
      expect(adapter.seen!.referenceImages![2]).toBe(PROVIDER)
      expect(new Set(s.signs.map((x) => x.ttl))).toEqual(new Set([MODEL_INPUT_TTL_SECONDS]))
      // What is persisted from the request is untouched.
      expect(request.referenceImageUrl).toBe(RENDER)
      expect(request.parameters.endFrameImageUrl).toBe(PREVIEW)
    })
  }
})

test.describe("Vesper's own server reads", () => {
  for (const mode of ['public', 'private'] as Mode[]) {
    test(`a stored reference is read through a signature (bucket ${mode})`, async () => {
      const s = fakeStorage(mode)
      const got = await fetchAllowlisted(RENDER, { fetchImpl: s.fetchImpl, signer: s.signer, patterns: allowedHostPatterns() })
      expect(got.buffer.equals(JPEG)).toBe(true)
      const dataUrl = await downloadReferenceImageAsDataUrl(PRODUCT, 'image/png', s.fetchImpl, s.signer)
      expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
      noPublicUrl(s.opened)
      expect(new Set(s.signs.map((x) => x.ttl))).toEqual(new Set([SERVER_READ_TTL_SECONDS]))
    })
  }

  test('when signing fails, the public URL is used: it works until the flip, and fails no worse after', async () => {
    const broken: StorageSigner = { sign: async () => { throw new Error('storage down') } }
    expect(await signStoredUrl(`${BASE}/storage/v1/object/sign/generated-images/${RENDER_PATH}?token=old`, 60, { signer: broken })).toBe(RENDER)
    expect(await signStoredUrlsDeep({ a: RENDER, b: [PROVIDER] }, 60, { signer: broken })).toEqual({ a: RENDER, b: [PROVIDER] })
    expect(await signStoredUrl(PROVIDER, 60, { signer: broken })).toBe(PROVIDER)
  })
})

test.describe('who may open stored media, beyond being signed in', () => {
  const CONFIRMED = '2026-01-01T00:00:00Z'
  const env = (v?: string) => ({ ...(v === undefined ? {} : { MEDIA_ACCESS_DOMAINS: v }) }) as unknown as NodeJS.ProcessEnv

  test('a confirmed Loop address may; the domain is matched exactly and case-insensitively', () => {
    expect(mediaAccessProblem({ email: 'Someone@LoopEarplugs.com', email_confirmed_at: CONFIRMED }, 'user', env())).toBeNull()
    expect(mediaAccessProblem({ email: 'someone@mail.loopearplugs.com', email_confirmed_at: CONFIRMED }, 'user', env())).not.toBeNull()
    expect(mediaAccessProblem({ email: 'someone@loopearplugs.com.evil.io', email_confirmed_at: CONFIRMED }, 'user', env())).not.toBeNull()
  })

  test('any other address, an unconfirmed Loop address, or no email is refused', () => {
    expect(mediaAccessProblem({ email: 'stranger@gmail.com', email_confirmed_at: CONFIRMED }, 'user', env())).toBe('Stored media is open to Loop accounts only')
    expect(mediaAccessProblem({ email: 'someone@loopearplugs.com', email_confirmed_at: null }, 'user', env())).toBe('Stored media needs a confirmed email address')
    expect(mediaAccessProblem({ email: null }, 'user', env())).not.toBeNull()
  })

  test('an admin may, whatever the address', () => {
    expect(mediaAccessProblem({ email: 'owner@elsewhere.ai', email_confirmed_at: CONFIRMED }, 'admin', env())).toBeNull()
  })

  test('MEDIA_ACCESS_DOMAINS widens the list, and * switches the domain rule off', () => {
    expect(mediaAccessProblem({ email: 'x@partner.com', email_confirmed_at: CONFIRMED }, 'user', env('loopearplugs.com, partner.com'))).toBeNull()
    expect(mediaAccessProblem({ email: 'x@anything.io', email_confirmed_at: null }, 'user', env('*'))).toBeNull()
    expect(mediaAccessDomains(env(''))).toEqual(['loopearplugs.com'])
  })

  test('MEDIA_ACCESS_EMAILS lets one confirmed address in, and no one else on its domain', () => {
    const e = { MEDIA_ACCESS_EMAILS: ' Named.Person@Gmail.com , other@x.io' } as unknown as NodeJS.ProcessEnv
    expect(mediaAccessEmails(e)).toEqual(['named.person@gmail.com', 'other@x.io'])
    expect(mediaAccessProblem({ email: 'named.person@gmail.com', email_confirmed_at: CONFIRMED }, 'user', e)).toBeNull()
    expect(mediaAccessProblem({ email: 'someone.else@gmail.com', email_confirmed_at: CONFIRMED }, 'user', e)).toBe('Stored media is open to Loop accounts only')
    expect(mediaAccessProblem({ email: 'named.person@gmail.com', email_confirmed_at: null }, 'user', e)).toBe('Stored media needs a confirmed email address')
    expect(mediaAccessProblem({ email: 'someone@loopearplugs.com', email_confirmed_at: CONFIRMED }, 'user', e)).toBeNull()
    expect(mediaAccessEmails(env())).toEqual([])
  })
})
