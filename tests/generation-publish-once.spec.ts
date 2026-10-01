import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import {
  generationOutputPath,
  isSuperseded,
  newRunTag,
  publishOutputsOnce,
  type OutputRow,
  type PublishStore,
  type PublishTx,
} from '../src/lib/generation/publish-once'
import { handleStorageRequest } from '../src/lib/storage/browser-route'
import type { StorageSigner } from '../src/lib/storage/access'
import { storageImageLoader } from '../src/lib/storage/image-loader'

/**
 * 2026-10-01: a web generation was processed twice (the server's trigger and the page's
 * fallback), both runs wrote `<user>/<generation>/0.jpg` and each added an output row. The feed
 * card kept the resized copy of the first draw; the preview and the download opened the second,
 * which had replaced it. These tests hold the three things that stop it: a run's files have a
 * name of their own, one run publishes, and a resized copy is made from the exact file asked for.
 */

const BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co').replace(/\/+$/, '')
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE

/** One generation row and its outputs, with Postgres's row lock: one transaction at a time, committed only if it finishes. */
function fakeGenerationRow(status: string) {
  const state = { status, outputs: [] as OutputRow[], cost: null as unknown }
  let queue: Promise<unknown> = Promise.resolve()
  const store: PublishStore = {
    transaction<T>(work: (tx: PublishTx) => Promise<T>): Promise<T> {
      const run = queue.then(async () => {
        const staged = { status: state.status, outputs: [...state.outputs], cost: state.cost }
        const tx: PublishTx = {
          generation: {
            async updateMany({ where, data }) {
              if (!where.status.in.includes(staged.status)) return { count: 0 }
              staged.status = String(data.status)
              staged.cost = data.cost
              return { count: 1 }
            },
          },
          output: {
            async createMany({ data }) {
              staged.outputs.push(...data)
              return { count: data.length }
            },
          },
        }
        const result = await work(tx)
        Object.assign(state, staged)
        return result
      })
      queue = run.catch(() => undefined)
      return run
    },
  }
  return { state, store }
}

function draw(run: string): OutputRow[] {
  return [{ generationId: 'g1', fileUrl: `${BASE}/storage/v1/object/public/generated-images/u1/g1/0-${run}.jpg`, fileType: 'image', width: 768, height: 1344 }]
}

test.describe('two runs of one generation', () => {
  test('never write the same file', () => {
    const first = generationOutputPath({ userId: 'u1', generationId: 'g1', index: 0, extension: 'jpg', runTag: newRunTag() })
    const second = generationOutputPath({ userId: 'u1', generationId: 'g1', index: 0, extension: 'jpg', runTag: newRunTag() })
    expect(first).not.toBe(second)
    expect(first).toMatch(/^u1\/g1\/0-[a-f0-9]{10}\.jpg$/)
    // Two outputs of one run are two files as well.
    const tag = newRunTag()
    expect(generationOutputPath({ userId: 'u1', generationId: 'g1', index: 0, extension: 'png', runTag: tag })).not.toBe(
      generationOutputPath({ userId: 'u1', generationId: 'g1', index: 1, extension: 'png', runTag: tag })
    )
    expect(() => generationOutputPath({ userId: 'u1', generationId: 'g1', index: 0, extension: 'jpg', runTag: '../x' })).toThrow()
  })

  test('finishing together: exactly one publishes, and only its outputs exist', async () => {
    const row = fakeGenerationRow('processing')
    const outcomes = await Promise.all([
      publishOutputsOnce(row.store, { generationId: 'g1', outputs: draw('aaaa'), completion: { cost: 0.067 } }),
      publishOutputsOnce(row.store, { generationId: 'g1', outputs: draw('bbbb'), completion: { cost: 0.067 } }),
    ])
    expect(outcomes.sort()).toEqual(['published', 'superseded'])
    expect(row.state.status).toBe('completed')
    expect(row.state.outputs).toHaveLength(1)
    expect(row.state.outputs[0].fileUrl).toContain('/0-aaaa.jpg')
  })

  test('the run that finishes second publishes nothing', async () => {
    const row = fakeGenerationRow('processing')
    expect(await publishOutputsOnce(row.store, { generationId: 'g1', outputs: draw('aaaa'), completion: {} })).toBe('published')
    expect(await publishOutputsOnce(row.store, { generationId: 'g1', outputs: draw('bbbb'), completion: {} })).toBe('superseded')
    expect(row.state.outputs.map((o) => o.fileUrl)).toEqual([draw('aaaa')[0].fileUrl])
  })

  test("a draw that succeeds still publishes over a sibling's failure, never over a cancel", async () => {
    const failed = fakeGenerationRow('failed')
    expect(await publishOutputsOnce(failed.store, { generationId: 'g1', outputs: draw('aaaa'), completion: {} })).toBe('published')
    expect(failed.state.status).toBe('completed')

    const cancelled = fakeGenerationRow('cancelled')
    expect(await publishOutputsOnce(cancelled.store, { generationId: 'g1', outputs: draw('aaaa'), completion: {} })).toBe('superseded')
    expect(cancelled.state.outputs).toHaveLength(0)

    expect(isSuperseded('completed')).toBe(true)
    expect(isSuperseded('cancelled')).toBe(true)
    expect(isSuperseded('processing')).toBe(false)
    expect(isSuperseded('failed')).toBe(false)
  })

  test('the web processor stores under its run tag and publishes through the guard', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'api', 'generate', 'process', 'route.ts'), 'utf8')
    // The shared name both runs wrote over each other.
    expect(route).not.toMatch(/\$\{generationId\}\/\$\{i\}\.\$\{extension\}/)
    expect(route).toContain('generationOutputPath(')
    expect(route).toContain('publishOutputsOnce(')
    // Outputs are only ever added inside the guard.
    expect(route).not.toMatch(/prisma\.output\.createMany/)
    // The lock is read back before the parameters are spread into later writes.
    const lock = route.indexOf('Acquired processing lock')
    const reread = route.indexOf('generation.parameters = lockedRow.parameters')
    const routing = route.indexOf('addRouteToParameters(generation.parameters')
    expect(lock).toBeGreaterThan(0)
    expect(reread).toBeGreaterThan(lock)
    expect(routing).toBeGreaterThan(reread)
  })
})

test.describe('resized copies in the feed', () => {
  // A stored file whose bytes are its own path, so a test can tell which file a copy was made from.
  const signer: StorageSigner = {
    async sign(bucket, paths, ttl) {
      return paths.map((p) => `${BASE}/storage/v1/object/sign/${bucket}/${encodeURI(p)}?token=t${ttl}`)
    },
  }
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input))
    const file = decodeURI(u.pathname.replace(/^.*\/object\/sign\/[^/]+\//, ''))
    return new Response(Buffer.from(file), { status: 200, headers: { 'content-type': 'image/jpeg' } })
  }) as typeof fetch
  const resize = async (input: Buffer, width: number) => Buffer.from(`${width}:${input.toString()}`)

  async function feedCard(fileUrl: string, width: number) {
    const address = storageImageLoader({ src: fileUrl, width, quality: 75 })
    const u = new URL(address, 'https://vesper.example')
    const [bucket, ...segments] = u.pathname.replace('/api/storage/', '').split('/')
    const res = await handleStorageRequest(
      { bucket, path: segments.map(decodeURIComponent), searchParams: u.searchParams },
      { authenticate: async () => null, signer, fetchImpl, resize }
    )
    expect(res.status).toBe(200)
    return { address, body: Buffer.from(await res.arrayBuffer()).toString() }
  }

  test('two outputs of one generation give two different resized copies, each from its own file', async () => {
    const a = `${BASE}/storage/v1/object/public/generated-images/u1/g1/0-aaaa.jpg`
    const b = `${BASE}/storage/v1/object/public/generated-images/u1/g1/1-aaaa.jpg`
    const cardA = await feedCard(a, 640)
    const cardB = await feedCard(b, 640)
    expect(cardA.address).not.toBe(cardB.address)
    expect(cardA.body).toBe('640:u1/g1/0-aaaa.jpg')
    expect(cardB.body).toBe('640:u1/g1/1-aaaa.jpg')
    // The browser keeps a copy per address: the address names the exact file and the width.
    const wide = await feedCard(a, 1080)
    expect(wide.address).not.toBe(cardA.address)
    expect(wide.body).toBe('1080:u1/g1/0-aaaa.jpg')
  })
})
