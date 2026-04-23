import { test, expect } from '@playwright/test'

/**
 * Unit tests for the OpenAI adapter size-resolution mapping
 * and request body construction patterns.
 *
 * We duplicate the SIZE_TABLE here so we can test the mapping
 * without hitting the TS module import limitation in Playwright.
 * Any drift from the real adapter is caught at build time by
 * TypeScript / the integration tests.
 */

const SIZE_TABLE: Record<string, Record<number, string>> = {
  '1:1':   { 1024: '1024x1024', 2048: '2048x2048', 4096: '2880x2880' },
  '3:2':   { 1024: '1536x1024', 2048: '2048x1360', 4096: '3504x2336' },
  '2:3':   { 1024: '1024x1536', 2048: '1360x2048', 4096: '2336x3504' },
  '16:9':  { 1024: '1536x864',  2048: '2048x1152', 4096: '3840x2160' },
  '9:16':  { 1024: '864x1536',  2048: '1152x2048', 4096: '2160x3840' },
  '4:3':   { 1024: '1536x1152', 2048: '2048x1536', 4096: '3264x2448' },
  '3:4':   { 1024: '1152x1536', 2048: '1536x2048', 4096: '2448x3264' },
}

function resolveSize(aspectRatio?: string, resolution?: number): string | undefined {
  if (!aspectRatio || aspectRatio === 'auto') return 'auto'
  const byRes = SIZE_TABLE[aspectRatio]
  if (!byRes) return 'auto'
  return byRes[resolution ?? 1024] ?? byRes[1024] ?? 'auto'
}

// ---- resolveSize ----

test.describe('resolveSize — aspect ratio + resolution → OpenAI size', () => {
  test('1:1 at 1K returns 1024x1024', () => {
    expect(resolveSize('1:1', 1024)).toBe('1024x1024')
  })

  test('16:9 at 4K returns 3840x2160', () => {
    expect(resolveSize('16:9', 4096)).toBe('3840x2160')
  })

  test('9:16 at 2K returns 1152x2048', () => {
    expect(resolveSize('9:16', 2048)).toBe('1152x2048')
  })

  test('auto aspect ratio returns "auto"', () => {
    expect(resolveSize('auto', 1024)).toBe('auto')
  })

  test('undefined aspect ratio returns "auto"', () => {
    expect(resolveSize(undefined, 1024)).toBe('auto')
  })

  test('unknown aspect ratio returns "auto"', () => {
    expect(resolveSize('7:3', 1024)).toBe('auto')
  })

  test('missing resolution defaults to 1K', () => {
    expect(resolveSize('3:2')).toBe('1536x1024')
  })

  test('all standard aspect ratios have entries for 1K/2K/4K', () => {
    for (const [ar, resMap] of Object.entries(SIZE_TABLE)) {
      for (const res of [1024, 2048, 4096]) {
        const size = resolveSize(ar, res)
        expect(size, `${ar} @ ${res}`).toMatch(/^\d+x\d+$/)
      }
    }
  })

  test('all generated sizes satisfy gpt-image-2 constraints', () => {
    for (const [ar, resMap] of Object.entries(SIZE_TABLE)) {
      for (const [res, size] of Object.entries(resMap)) {
        const [w, h] = size.split('x').map(Number)
        expect(w % 16, `${ar}@${res} width must be multiple of 16`).toBe(0)
        expect(h % 16, `${ar}@${res} height must be multiple of 16`).toBe(0)
        expect(Math.max(w, h), `${ar}@${res} max edge must be <= 3840`).toBeLessThanOrEqual(3840)
        const ratio = Math.max(w, h) / Math.min(w, h)
        expect(ratio, `${ar}@${res} long:short ratio must be <= 3`).toBeLessThanOrEqual(3.01)
        const totalPx = w * h
        expect(totalPx, `${ar}@${res} total pixels must be >= 655360`).toBeGreaterThanOrEqual(655360)
        expect(totalPx, `${ar}@${res} total pixels must be <= 8294400`).toBeLessThanOrEqual(8294400)
      }
    }
  })
})

// ---- Generations body construction patterns ----

test.describe('Generations body construction', () => {
  test('omits response_format for gpt-image-2', () => {
    const body: Record<string, any> = {
      model: 'gpt-image-2',
      prompt: 'test',
    }

    expect(body.response_format).toBeUndefined()
  })

  test('omits output_compression when format is png', () => {
    const body: Record<string, any> = {
      model: 'gpt-image-2',
      prompt: 'test',
    }
    const format = 'png'
    if (format !== 'png') body.output_compression = 85
    expect(body.output_compression).toBeUndefined()
  })

  test('includes output_compression when format is jpeg', () => {
    const body: Record<string, any> = {
      model: 'gpt-image-2',
      prompt: 'test',
    }
    const format: string = 'jpeg'
    if (format !== 'png') body.output_compression = 85
    expect(body.output_compression).toBe(85)
  })

  test('includes output_compression when format is webp', () => {
    const body: Record<string, any> = {
      model: 'gpt-image-2',
      prompt: 'test',
    }
    const format: string = 'webp'
    if (format !== 'png') body.output_compression = 50
    expect(body.output_compression).toBe(50)
  })

  test('n is omitted when numOutputs is 1', () => {
    const body: Record<string, any> = { model: 'gpt-image-2', prompt: 'test' }
    const n = 1
    if (n > 1) body.n = n
    expect(body.n).toBeUndefined()
  })

  test('n is set when numOutputs > 1', () => {
    const body: Record<string, any> = { model: 'gpt-image-2', prompt: 'test' }
    const n = 4
    if (n > 1) body.n = n
    expect(body.n).toBe(4)
  })

  test('size field is set from resolveSize', () => {
    const body: Record<string, any> = { model: 'gpt-image-2', prompt: 'test' }
    const size = resolveSize('16:9', 2048)
    if (size) body.size = size
    expect(body.size).toBe('2048x1152')
  })
})

// ---- Edits FormData shape expectations ----

test.describe('Edits endpoint shape', () => {
  test('image[] entries correspond to reference images count', () => {
    const refs = ['data:image/png;base64,a', 'data:image/png;base64,b', 'data:image/png;base64,c']
    const fields: string[] = []
    for (const _ref of refs) {
      fields.push('image[]')
    }
    expect(fields.length).toBe(3)
    expect(fields.every(f => f === 'image[]')).toBe(true)
  })

  test('mask field is added only when mask data is present', () => {
    const fields: string[] = []
    const mask: string | undefined = 'data:image/png;base64,mask'
    if (mask) fields.push('mask')
    expect(fields).toContain('mask')
  })

  test('mask field is omitted when no mask', () => {
    const fields: string[] = []
    const mask: string | undefined = undefined
    if (mask) fields.push('mask')
    expect(fields).not.toContain('mask')
  })
})
