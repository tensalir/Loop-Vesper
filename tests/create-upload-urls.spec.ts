/**
 * `create_upload_urls`: a file on the caller's side reaches Vesper by the caller's own PUT.
 *
 * On 2026-10-12 a colleague's Claude in Cowork held 16 frames (2160x2160 PNGs) and could not give
 * Kling any of them: a tool call carries text, not megabytes, and a path on the caller's side
 * means nothing to Vesper. Cowork's workspace reaches Vesper's storage (HTTP 200, same day), so
 * Vesper now hands out signed upload URLs, and the stored URL is accepted as a frame.
 */
import { test, expect } from '@playwright/test'
import { HeadlessCreateUploadUrlsSchema } from '../src/lib/api/validation'
import { UPLOAD_BUCKET, UPLOAD_URL_TTL_SECONDS, uploadContentType, uploadPath } from '../src/lib/headless/uploads'
import { createUploadUrlsHandlerWith } from '../src/lib/headless/tools/create-upload-urls'
import { assertGenerateVideoAllowed, parseGenerateVideoArgs } from '../src/lib/headless/generate-video'
import { TOOL_META } from '../src/lib/headless/tool-registry'
import type { ToolContext } from '../src/lib/headless/tools/types'

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co'
const OWNER = '11111111-2222-4333-8444-555555555555'

function fakeIssuer() {
  const issued: Array<{ bucket: string; path: string }> = []
  return {
    issued,
    issuer: {
      async issue(bucket: string, path: string) {
        issued.push({ bucket, path })
        return {
          uploadUrl: `${SUPABASE}/storage/v1/object/upload/sign/${bucket}/${path}?token=t`,
          url: `${SUPABASE}/storage/v1/object/public/${bucket}/${path}`,
        }
      },
    },
  }
}

const ctx = { principal: { ownerId: OWNER, credentialId: 'cred-1', allowedTools: [], allowedModels: ['*'] } } as unknown as ToolContext

test.describe('what can be uploaded', () => {
  test('PNG, JPEG and WebP, from the name or a type given', () => {
    expect(uploadContentType('pair-01-start.PNG')).toBe('image/png')
    expect(uploadContentType('frame.jpeg')).toBe('image/jpeg')
    expect(uploadContentType('frame.jpg')).toBe('image/jpeg')
    expect(uploadContentType('frame.webp')).toBe('image/webp')
    expect(uploadContentType('frame', 'image/png')).toBe('image/png')
  })

  test('anything else is refused, saying what is taken', () => {
    expect(() => uploadContentType('clip.mp4')).toThrow(/only PNG, JPEG and WebP/)
    expect(() => uploadContentType('frame')).toThrow(/contentType/)
    expect(() => uploadContentType('frame.png', 'application/pdf')).toThrow(/only PNG, JPEG and WebP/)
  })

  test('one call names 1 to 20 files', () => {
    expect(HeadlessCreateUploadUrlsSchema.safeParse({ files: [] }).success).toBe(false)
    expect(HeadlessCreateUploadUrlsSchema.safeParse({ files: Array.from({ length: 21 }, (_, i) => ({ name: `${i}.png` })) }).success).toBe(false)
    expect(HeadlessCreateUploadUrlsSchema.safeParse({ files: Array.from({ length: 16 }, (_, i) => ({ name: `${i}.png` })) }).success).toBe(true)
  })
})

test('an upload is kept under its owner, by day, with a readable name and a fresh id', () => {
  const path = uploadPath(OWNER, 'Pair 01 — Start Frame.PNG', 'image/png', new Date('2026-10-12T12:00:00Z'), 'abc')
  expect(path).toBe(`mcp-uploads/${OWNER}/20261012/abc-pair-01-start-frame.png`)
  expect(uploadPath(OWNER, '....', 'image/jpeg', new Date('2026-10-12T12:00:00Z'), 'abc')).toBe(`mcp-uploads/${OWNER}/20261012/abc-file.jpg`)
  expect(uploadPath(OWNER, 'a.png', 'image/png')).not.toBe(uploadPath(OWNER, 'a.png', 'image/png'))
})

test.describe('create_upload_urls', () => {
  test('one PUT URL and one stored URL per file, with the recipe, free', async () => {
    const { issued, issuer } = fakeIssuer()
    const handler = createUploadUrlsHandlerWith(issuer)
    const result = await handler.run({ files: [{ name: 'pair-01-start.png' }, { name: 'pair-01-end.png' }] }, ctx)

    expect(issued).toHaveLength(2)
    expect(issued.every((i) => i.bucket === UPLOAD_BUCKET && i.path.startsWith(`mcp-uploads/${OWNER}/`))).toBe(true)
    const structured = result.structuredContent as { method: string; expiresInSeconds: number; uploads: Array<{ name: string; uploadUrl: string; url: string; contentType: string }> }
    expect(structured.method).toBe('PUT')
    expect(structured.expiresInSeconds).toBe(UPLOAD_URL_TTL_SECONDS)
    expect(structured.uploads.map((u) => u.name)).toEqual(['pair-01-start.png', 'pair-01-end.png'])
    expect(structured.uploads[0].contentType).toBe('image/png')
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('--data-binary @<file>')
    expect(text).toContain('endFrameImage')
    expect(text).toContain(structured.uploads[1].url)
    expect(result.costUsd).toBeNull()
    expect(handler.estimateCostUsd).toBeUndefined()
  })

  test('a non-image is refused before any URL is issued', async () => {
    const { issued, issuer } = fakeIssuer()
    await expect(createUploadUrlsHandlerWith(issuer).run({ files: [{ name: 'notes.txt' }] }, ctx)).rejects.toThrow(/only PNG, JPEG and WebP/)
    expect(issued).toHaveLength(0)
  })

  test('is a Claude connector tool, off the organisation token', () => {
    expect(TOOL_META.create_upload_urls).toMatchObject({ oauth: true, selfIssued: true, org: false })
  })
})

test.describe('an uploaded file is a frame Kling 3.0 takes', () => {
  test('the stored URLs pass as start and end frame', async () => {
    const { issuer } = fakeIssuer()
    const result = await createUploadUrlsHandlerWith(issuer).run({ files: [{ name: 'start.png' }, { name: 'end.png' }] }, ctx)
    const [start, end] = (result.structuredContent as { uploads: Array<{ url: string }> }).uploads
    const args = parseGenerateVideoArgs({
      prompt: 'the ink bleeds from the first frame into the second',
      modelId: 'replicate-kling-3',
      duration: 10,
      resolution: 1080,
      referenceImage: start.url,
      endFrameImage: end.url,
    })
    expect(() => assertGenerateVideoAllowed(args, ['*'])).not.toThrow()
  })

  test('a path on the caller\'s side is refused with the way to upload it', () => {
    const args = parseGenerateVideoArgs({ prompt: 'p', modelId: 'replicate-kling-3', referenceImage: '/sessions/cowork/uploads/pair-01-start.png' })
    expect(() => assertGenerateVideoAllowed(args, ['*'])).toThrow(/create_upload_urls/)
  })
})
