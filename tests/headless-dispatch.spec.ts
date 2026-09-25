import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { dispatch } from '../src/lib/headless/mcp-dispatch'
import { imageAudienceMode, imageBlocks, imageResultContent, previewFilename, saveToFolderText, showInReplyLines } from '../src/lib/headless/generate-asset'
import { PREVIEW_LONG_EDGE, PREVIEW_MAX_BYTES } from '../src/lib/images/preview'
import { ORG_DEFAULT_TOOLS, HEADLESS_TOOLS } from '../src/lib/headless/tool-registry'
import { TOOL_HANDLERS } from '../src/lib/headless/tools'
import type { ToolPrincipal } from '../src/lib/headless/tools/types'

/**
 * The dispatcher (moved out of the route) and the image results it returns:
 * previews Claude can read, where before every image block was marked for
 * the user only and a 2K draw was usually too large to inline at all.
 */

const orgPrincipal: ToolPrincipal = {
  credentialId: 'cred-org',
  ownerId: 'owner-admin',
  allowedTools: [...ORG_DEFAULT_TOOLS],
  allowedModels: ['*'],
}

const noUsage = async () => undefined

test.describe('dispatch', () => {
  test('tools/list shows only the tools the credential may call', async () => {
    const res = (await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, orgPrincipal, {
      recordUsage: noUsage,
    })) as { result: { tools: Array<{ name: string }> } }
    expect(res.result.tools.map((t) => t.name)).toEqual([...ORG_DEFAULT_TOOLS])
  })

  test('calling a tool outside the list is refused', async () => {
    const res = (await dispatch(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_generation_status', arguments: {} } },
      orgPrincipal,
      { recordUsage: noUsage }
    )) as { error?: { code: number } }
    expect(res.error?.code).toBe(-32001)
  })

  test('a paid call over the daily cap comes back as an isError result, and the tool never runs', async () => {
    let ran = false
    const handlers = {
      ...TOOL_HANDLERS,
      generate_asset: {
        estimateCostUsd: () => 0.5,
        run: async () => {
          ran = true
          return { content: [] }
        },
      },
    }
    const res = (await dispatch(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'generate_asset', arguments: { prompt: 'x', modelId: 'gemini-nano-banana-pro' } },
      },
      orgPrincipal,
      {
        handlers,
        recordUsage: noUsage,
        checkCostCap: async () => ({
          ok: false,
          capUsd: 1,
          spentUsd: 0.9,
          estimateUsd: 0.5,
          message: 'over the cap',
        }),
      }
    )) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(ran).toBe(false)
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toBe('over the cap')
  })

  test('a tool failure is an isError result the agent can read', async () => {
    const handlers = {
      ...TOOL_HANDLERS,
      list_models: {
        run: async () => {
          throw new Error('registry offline')
        },
      },
    }
    const res = (await dispatch(
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_models', arguments: {} } },
      orgPrincipal,
      { handlers, recordUsage: noUsage }
    )) as { result: { isError: boolean; content: Array<{ text: string }> } }
    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toBe('registry offline')
  })

  test('costUsd is logged but never sent', async () => {
    const logged: Array<number | null | undefined> = []
    const handlers = {
      ...TOOL_HANDLERS,
      list_models: { run: async () => ({ content: [{ type: 'text' as const, text: 'x' }], costUsd: 0.25 }) },
    }
    const res = (await dispatch(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_models', arguments: {} } },
      orgPrincipal,
      {
        handlers,
        recordUsage: async (entry) => {
          logged.push(entry.costUsd)
        },
      }
    )) as { result: Record<string, unknown> }
    expect(res.result.costUsd).toBeUndefined()
    expect(logged).toEqual([0.25])
  })

  test('initialize tells the caller about jobs and previews', async () => {
    const res = (await dispatch(
      { jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
      { ...orgPrincipal, allowedTools: [...HEADLESS_TOOLS] },
      { recordUsage: noUsage }
    )) as { result: { instructions: string } }
    expect(res.result.instructions).toContain('get_generation_status')
    expect(res.result.instructions).toContain('previews')
  })
})

test.describe('image results Claude can see', () => {
  test('every picture has a file name to save it as, and the result says where a folder gets it', () => {
    expect(previewFilename('gemini-nano-banana-2', '7d54cc98-9724-47de-9ba2-5f042d7862a7', 0))
      .toBe('gemini-nano-banana-2-7d54cc98-1-preview.jpg')
    expect(previewFilename('openai/GPT Image 2', 'abcdefgh1234', 3)).toBe('openai-gpt-image-2-abcdefgh-4-preview.jpg')
    const text = saveToFolderText(
      [{ url: 'u1', previewUrl: 'p1', filename: 'a-1-preview.jpg' }, { url: 'u2', previewUrl: null, filename: 'a-2-preview.jpg' }],
      'a'
    )
    expect(text).toContain('Cowork, Claude Code')
    expect(text).toMatch(/vesper\/\d{4}-\d{2}-\d{2}\/<name>/)
    expect(text).toContain('a-1-preview.jpg, a-2-preview.jpg')
    expect(text).toContain('no re-encoding')
    expect(saveToFolderText([{ url: 'u' }], 'm')).toContain('m-1-preview.jpg')
  })

  test('every image result hands Claude the markdown line that shows the picture in its reply', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer()
    const preview = `data:image/jpeg;base64,${(await sharp(png).jpeg().toBuffer()).toString('base64')}`
    const content = await imageResultContent({
      summary: 's',
      modelId: 'gemini-nano-banana-2',
      outputs: [
        { url: 'https://abcd.supabase.co/full-0.png', width: 8, height: 8, mimeType: 'image/png', previewUrl: preview },
        { url: 'https://abcd.supabase.co/full-1.png', width: 8, height: 8, mimeType: 'image/png', previewUrl: null },
      ],
      inline: true,
    })
    const texts = content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text)
    const show = texts.find((x) => x.includes('put these lines in your reply'))
    expect(show).toBeDefined()
    // the small preview when there is one, the original when there is not
    expect(show).toContain(`![Image 1 from gemini-nano-banana-2](${preview})`)
    expect(show).toContain('![Image 2 from gemini-nano-banana-2](https://abcd.supabase.co/full-1.png)')
    expect(showInReplyLines([{ url: 'u', previewUrl: 'p' }], 'm')).toEqual(['![Image 1 from m](p)'])
    // a preview that is already the small JPEG is sent as it is, not resized again; the second
    // output's original cannot be fetched here, so it gets the "no preview" line instead
    const images = content.filter((c) => c.type === 'image') as Array<{ data: string }>
    expect(images.length).toBe(2)
    expect(`data:image/jpeg;base64,${images[0].data}`).toBe(preview)
    expect(texts.some((x) => x.startsWith('No preview for image 2'))).toBe(true)
  })

  test('the audience modes: one block for each by default, the old user mark, or one for both', () => {
    const both = imageBlocks('AAAA', 'image/jpeg', 'both')
    expect(both).toHaveLength(1)
    expect(both[0].annotations?.audience).toEqual(['user', 'assistant'])
    expect(imageBlocks('AAAA', 'image/jpeg', 'user')[0].annotations?.audience).toEqual(['user'])
    const split = imageBlocks('AAAA', 'image/jpeg', 'split')
    expect(split.map((b) => b.annotations?.audience)).toEqual([['user'], ['assistant']])
    const was = process.env.MCP_IMAGE_AUDIENCE
    process.env.MCP_IMAGE_AUDIENCE = 'nonsense'
    expect(imageAudienceMode()).toBe('split')
    process.env.MCP_IMAGE_AUDIENCE = 'both'
    expect(imageAudienceMode()).toBe('both')
    delete process.env.MCP_IMAGE_AUDIENCE
    expect(imageAudienceMode()).toBe('split')
    if (was === undefined) delete process.env.MCP_IMAGE_AUDIENCE
    else process.env.MCP_IMAGE_AUDIENCE = was
  })

  test('previews are JPEG, under the inline cap, long edge capped, one for the user and one for Claude', async () => {
    // Noise does not compress: a worst case for the size loop.
    const width = 3000
    const height = 2000
    const noise = Buffer.alloc(width * height * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 251
    const png = await sharp(noise, { raw: { width, height, channels: 3 } }).png().toBuffer()
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`

    const content = await imageResultContent({
      summary: 'Generated 1 image',
      modelId: 'gemini-nano-banana-pro',
      outputs: [{ url: 'https://abcd.supabase.co/x.png', width, height, mimeType: 'image/png' }],
      previewSources: [dataUrl],
      inline: true,
    })

    // claude.ai draws inline only a picture marked for the user alone; Claude reads the other copy.
    const images = content.filter((c) => c.type === 'image')
    expect(images).toHaveLength(2)
    expect(images.map((i) => (i as { annotations?: { audience?: string[] } }).annotations?.audience))
      .toEqual([['user'], ['assistant']])
    expect((images[0] as { data: string }).data).toBe((images[1] as { data: string }).data)
    const image = images[0] as { data: string; mimeType: string }
    expect(image.mimeType).toBe('image/jpeg')
    const bytes = Buffer.from(image.data, 'base64')
    expect(bytes.length).toBeLessThanOrEqual(PREVIEW_MAX_BYTES)
    const meta = await sharp(bytes).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(PREVIEW_LONG_EDGE)
    expect(content.some((c) => c.type === 'resource_link')).toBe(true)
  })

  test('a transparent image previews on white, not black', async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer()
    const content = await imageResultContent({
      summary: 's',
      modelId: 'm',
      outputs: [{ url: 'https://abcd.supabase.co/c.png', width: 64, height: 64, mimeType: 'image/png' }],
      previewSources: [`data:image/png;base64,${png.toString('base64')}`],
      inline: true,
    })
    const image = content.find((c) => c.type === 'image') as { data: string }
    const { data } = await sharp(Buffer.from(image.data, 'base64')).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(240)
  })

  test('inline: false gives links and no previews', async () => {
    const content = await imageResultContent({
      summary: 's',
      modelId: 'm',
      outputs: [{ url: 'https://abcd.supabase.co/c.png', width: 64, height: 64, mimeType: 'image/png' }],
      inline: false,
    })
    expect(content.some((c) => c.type === 'image')).toBe(false)
    expect(content.some((c) => c.type === 'resource_link')).toBe(true)
  })
})
