/**
 * The ask that started this: "a 10 s video at 1080p at least, with a start and an end frame",
 * through Claude.
 *
 * - Kling 3.0 on Replicate (kwaivgi/kling-v3-video, schema and prices read 2026-10-12) is the
 *   model that renders it: 3 to 15 s, standard 720p / pro 1080p / 4K, start_image and end_image.
 * - A video's real size is read from its file. Every adapter recorded 1280x720 before, so Kling
 *   2.6's 1072x1928 start-and-end renders read as 720p.
 * - Through Claude a Replicate video is submitted and collected, never waited on: the 240 s wall
 *   had cut 6 of 22 Seedance renders while Replicate went on and billed.
 * - A frame must be something Vesper can read: a Claude upload path was passed as the start
 *   frame on 2026-10-12 and Kling answered "File is not in a valid base64 format".
 */
import { test, expect } from '@playwright/test'
import { getModelConfig } from '../src/lib/models/registry'
import {
  buildKling3Input,
  KLING_3_MODEL_PATH,
  KLING_3_PROMPT_MAX,
  nominalVideoDimensions,
  REPLICATE_MODEL_CONFIGS,
  supportsWebhook,
} from '../src/lib/models/replicate-utils'
import { kling3Mode, kling3PricePerSecondUsd } from '../src/lib/models/pricing'
import { calculateGenerationCost } from '../src/lib/cost/calculator'
import { estimateGenerationCostUsd } from '../src/lib/headless/estimate-cost'
import { getScopeForModel } from '../src/lib/rate-limits/config'
import { VIDEO_MODEL_IDS } from '../src/lib/headless/model-allowlists'
import { HeadlessGenerateVideoSchema } from '../src/lib/api/validation'
import { dimensionsFromMoov, httpRangeReader, readMp4Dimensions } from '../src/lib/video/mp4-dimensions'
import {
  advanceVideoJob,
  assertGenerateVideoAllowed,
  executeGenerateVideo,
  parseGenerateVideoArgs,
} from '../src/lib/headless/generate-video'
import { supportsVideoHandoff } from '../src/lib/headless/video-handoff'
import {
  FINISH_LEASE_MS,
  isHandedOff,
  isStale,
  PENDING_MAX_MS,
  PENDING_STALE_MESSAGE,
  pendingOf,
  runWithBudget,
  STALE_PROCESSING_MS,
  HANDED_OFF,
} from '../src/lib/headless/jobs'
import { collectingWaitUntil, MemoryJobStore } from './helpers/memory-job-store'

const MODEL_ID = 'replicate-kling-3'
const START = 'https://replicate.delivery/frames/start.png'
const END = 'https://replicate.delivery/frames/end.png'

test.describe('Kling 3.0 registration', () => {
  test('is a video model with start and end frames, up to 4K', () => {
    const config = getModelConfig(MODEL_ID)!
    expect(config.name).toBe('Kling 3.0')
    expect(config.type).toBe('video')
    expect(config.capabilities?.['image-2-video']).toBe(true)
    expect(config.capabilities?.['frame-interpolation']).toBe(true)
    expect(config.capabilities?.audioGeneration).toBe(true)
    expect(config.maxResolution).toBe(2160)
  })

  test('offers only what the API renders: 720p/1080p/4K, 3 to 15 seconds, 1080p and 10 s by default', () => {
    const config = getModelConfig(MODEL_ID)!
    const resolution = config.parameters!.find((p) => p.name === 'resolution')!
    expect(resolution.options!.map((o) => o.value)).toEqual([720, 1080, 2160])
    expect(resolution.default).toBe(1080)
    const duration = config.parameters!.find((p) => p.name === 'duration')!
    for (const option of duration.options!) {
      expect(option.value).toBeGreaterThanOrEqual(3)
      expect(option.value).toBeLessThanOrEqual(15)
    }
    expect(duration.default).toBe(10)
  })

  test('is on the webhook path, the MCP video list, the handoff and its own rate-limit scope', () => {
    expect(supportsWebhook(MODEL_ID)).toBe(true)
    expect(REPLICATE_MODEL_CONFIGS[MODEL_ID].modelPath).toBe(KLING_3_MODEL_PATH)
    expect(KLING_3_MODEL_PATH).toBe('kwaivgi/kling-v3-video')
    expect([...VIDEO_MODEL_IDS]).toContain(MODEL_ID)
    expect(supportsVideoHandoff(MODEL_ID)).toBe(true)
    expect(getScopeForModel(MODEL_ID)).toBe('replicate-kling-3')
  })

  test('the Replicate video models are handed off; Veo and Kling official still run inline', () => {
    expect(supportsVideoHandoff('replicate-seedance-2.5')).toBe(true)
    expect(supportsVideoHandoff('replicate-kling-2.6')).toBe(true)
    expect(supportsVideoHandoff('gemini-veo-3.1')).toBe(false)
    expect(supportsVideoHandoff('kling-official')).toBe(false)
    // an image model on the same webhook table is not a video
    expect(supportsVideoHandoff('replicate-seedream-4')).toBe(false)
  })
})

test.describe('Kling 3.0 input', () => {
  test('the ask itself: 10 s, 1080p, a start and an end frame', () => {
    const input = buildKling3Input({
      prompt: 'the case opens',
      duration: 10,
      resolution: 1080,
      referenceImage: START,
      endFrameImageUrl: END,
    })
    expect(input).toMatchObject({
      prompt: 'the case opens',
      duration: 10,
      mode: 'pro',
      start_image: START,
      end_image: END,
      generate_audio: true,
    })
  })

  test('the resolution picks the mode', () => {
    expect(kling3Mode(720)).toBe('standard')
    expect(kling3Mode(480)).toBe('standard')
    expect(kling3Mode(1080)).toBe('pro')
    expect(kling3Mode(2160)).toBe('4k')
    expect(kling3Mode('4K')).toBe('4k')
    expect(kling3Mode(undefined)).toBe('pro')
  })

  test('duration is held to 3-15 s, and 5 s when missing', () => {
    expect(buildKling3Input({ prompt: 'p', duration: 30 }).duration).toBe(15)
    expect(buildKling3Input({ prompt: 'p', duration: 1 }).duration).toBe(3)
    expect(buildKling3Input({ prompt: 'p', duration: 7.4 }).duration).toBe(7)
    expect(buildKling3Input({ prompt: 'p' }).duration).toBe(5)
  })

  test('an end frame without a start frame is not sent; Kling requires the start', () => {
    const input = buildKling3Input({ prompt: 'p', endFrameImageUrl: END })
    expect(input.start_image).toBeUndefined()
    expect(input.end_image).toBeUndefined()
  })

  test('the start frame is read in the polling adapter order', () => {
    expect(buildKling3Input({ prompt: 'p', referenceImage: 'a', referenceImageUrl: 'b', referenceImages: ['c'] }).start_image).toBe('a')
    expect(buildKling3Input({ prompt: 'p', referenceImageUrl: 'b', referenceImages: ['c'] }).start_image).toBe('b')
    expect(buildKling3Input({ prompt: 'p', referenceImages: ['c'] }).start_image).toBe('c')
  })

  test('an unknown ratio falls back to 16:9, audio can be turned off, a negative prompt is passed', () => {
    const input = buildKling3Input({ prompt: 'p', aspectRatio: '21:9', generateAudio: false, negativePrompt: 'blur' })
    expect(input.aspect_ratio).toBe('16:9')
    expect(input.generate_audio).toBe(false)
    expect(input.negative_prompt).toBe('blur')
  })

  test("a prompt over Kling's 2500 characters is refused in words, before any submit", () => {
    expect(() => buildKling3Input({ prompt: 'x'.repeat(KLING_3_PROMPT_MAX + 1) })).toThrow(/at most 2500 characters/)
    expect(() => buildKling3Input({ prompt: 'x'.repeat(KLING_3_PROMPT_MAX) })).not.toThrow()
  })

  test('the nominal size follows the tier, used only when the file cannot be read', () => {
    expect(nominalVideoDimensions({ mode: 'pro' }, '16:9')).toEqual({ width: 1920, height: 1080 })
    expect(nominalVideoDimensions({ mode: '4k' }, '9:16')).toEqual({ width: 2160, height: 3840 })
    expect(nominalVideoDimensions({ mode: 'standard' }, '1:1')).toEqual({ width: 720, height: 720 })
    expect(nominalVideoDimensions({ resolution: '480p' }, '16:9')).toEqual({ width: 853, height: 480 })
  })
})

test.describe('Kling 3.0 prices (per second of output, Replicate 2026-10-12)', () => {
  test('per second by mode and audio', () => {
    expect(kling3PricePerSecondUsd(720, false)).toBeCloseTo(0.168)
    expect(kling3PricePerSecondUsd(720, true)).toBeCloseTo(0.252)
    expect(kling3PricePerSecondUsd(1080, false)).toBeCloseTo(0.224)
    expect(kling3PricePerSecondUsd(1080, true)).toBeCloseTo(0.336)
    expect(kling3PricePerSecondUsd(2160, false)).toBeCloseTo(0.42)
    expect(kling3PricePerSecondUsd(2160, true)).toBeCloseTo(0.42)
  })

  test('the web app logs a 10 s 1080p render at its real price, not by compute time', () => {
    const silent = calculateGenerationCost(MODEL_ID, { videoDurationSeconds: 10, resolution: 1080, generateAudio: false, computeTimeSeconds: 300 })
    expect(silent.cost).toBeCloseTo(2.24)
    const withAudio = calculateGenerationCost(MODEL_ID, { videoDurationSeconds: 10, resolution: 1080 })
    expect(withAudio.cost).toBeCloseTo(3.36)
  })

  test("the connector's estimate (and so the daily cap) prices what was asked for", () => {
    expect(estimateGenerationCostUsd({ modelId: MODEL_ID, durationSeconds: 10, resolution: 1080, generateAudio: false })).toBeCloseTo(2.24)
    expect(estimateGenerationCostUsd({ modelId: MODEL_ID, durationSeconds: 10 })).toBeCloseTo(3.36)
    expect(estimateGenerationCostUsd({ modelId: MODEL_ID, durationSeconds: 15, resolution: 2160 })).toBeCloseTo(6.3)
  })
})

/** An MP4 box: size, type, payload. */
function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const length = 8 + payload.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(length)
  new DataView(out.buffer).setUint32(0, length)
  out.set([...type].map((c) => c.charCodeAt(0)), 4)
  let at = 8
  for (const p of payload) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A `tkhd` payload with the picture size at its version's offset. */
function tkhd(width: number, height: number, version = 0): Uint8Array {
  const payload = new Uint8Array(version === 1 ? 96 : 84)
  payload[0] = version
  const view = new DataView(payload.buffer)
  const at = version === 1 ? 88 : 76
  view.setUint32(at, width * 65536)
  view.setUint32(at + 4, height * 65536)
  return box('tkhd', payload)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const memoryReader = (file: Uint8Array) => async (start: number, length: number) => file.subarray(start, start + length)

test.describe('a video file reports its own size', () => {
  const moov = box('moov', box('mvhd', new Uint8Array(100)), box('trak', tkhd(0, 0)), box('trak', tkhd(1072, 1928)))

  test('the first track with a picture: the audio track before it has none', () => {
    expect(dimensionsFromMoov(moov)).toEqual({ width: 1072, height: 1928 })
    expect(dimensionsFromMoov(box('moov', box('trak', tkhd(3840, 2160, 1))))).toEqual({ width: 3840, height: 2160 })
  })

  test('moov at the start (fast start) or after a large mdat', async () => {
    const ftyp = box('ftyp', new Uint8Array(16))
    expect(await readMp4Dimensions(memoryReader(concat(ftyp, moov, box('mdat', new Uint8Array(1000)))))).toEqual({ width: 1072, height: 1928 })
    const afterMdat = concat(ftyp, box('mdat', new Uint8Array(2 * 1024 * 1024)), moov)
    const reads: Array<[number, number]> = []
    const reader = async (start: number, length: number) => {
      reads.push([start, length])
      return afterMdat.subarray(start, start + length)
    }
    expect(await readMp4Dimensions(reader)).toEqual({ width: 1072, height: 1928 })
    // the 2 MB of picture data in between is never read
    expect(reads.reduce((n, [, len]) => n + Math.min(len, afterMdat.length), 0)).toBeLessThan(1024 * 1024)
  })

  test('a host that ignores Range is read once, only as far as the first chunk', async () => {
    const ftyp = box('ftyp', new Uint8Array(16))
    const file = concat(ftyp, box('mdat', new Uint8Array(2 * 1024 * 1024)), moov)
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(file, { status: 200 })
    }) as unknown as typeof fetch
    expect(await readMp4Dimensions(httpRangeReader('https://cdn.example/v.mp4', fetchImpl))).toBeNull()
    expect(calls).toBe(1)
  })

  test('something that is not an MP4 answers null', async () => {
    expect(await readMp4Dimensions(memoryReader(new TextEncoder().encode('<html>not a video</html>')))).toBeNull()
  })
})

test.describe('generate_video arguments through Claude', () => {
  test('takes an end frame and an audio switch', () => {
    const parsed = HeadlessGenerateVideoSchema.safeParse({
      prompt: 'p',
      modelId: MODEL_ID,
      duration: 10,
      resolution: 1080,
      referenceImage: START,
      endFrameImage: END,
      generateAudio: false,
    })
    expect(parsed.success).toBe(true)
  })

  test("refuses a file path on the caller's side, as the 2026-10-12 attempt passed", () => {
    const args = parseGenerateVideoArgs({
      prompt: 'p',
      modelId: 'kling-official',
      referenceImage: '/root/.claude/uploads/d67f47a5-a8a0-5e24-9f4b-3abf4e03c006/frame.png',
    })
    expect(() => assertGenerateVideoAllowed(args, ['*'])).toThrow(/looks like a file on your side/)
  })

  test('takes an https URL, a data URL or bare base64 as a frame', () => {
    for (const frame of [START, 'data:image/png;base64,iVBORw0KGgo=', 'A'.repeat(80)]) {
      const args = parseGenerateVideoArgs({ prompt: 'p', modelId: MODEL_ID, referenceImage: frame, endFrameImage: frame })
      expect(() => assertGenerateVideoAllowed(args, ['*'])).not.toThrow()
    }
  })

  test('an end frame needs a start frame, and a model that takes one', () => {
    expect(() =>
      assertGenerateVideoAllowed(parseGenerateVideoArgs({ prompt: 'p', modelId: MODEL_ID, endFrameImage: END }), ['*'])
    ).toThrow(/needs referenceImage/)
    expect(() =>
      assertGenerateVideoAllowed(
        parseGenerateVideoArgs({ prompt: 'p', modelId: 'replicate-kling-2.6', referenceImage: START, endFrameImage: END }),
        ['*']
      )
    ).toThrow(/takes no end frame.*replicate-kling-3/)
  })
})

const OWNER = 'owner-1'

function fakeRecord() {
  const calls: unknown[] = []
  const record = (async (input: unknown) => {
    calls.push(input)
    return { outputIds: ['00000000-0000-4000-8000-0000000000aa'], projectId: 'project-claude', sessionId: 'session-video' }
  }) as never
  return { calls, record }
}

test.describe('a Replicate video through Claude is submitted, then collected', () => {
  test('the work submits with the frames and hands off; the job keeps the prediction', async () => {
    const store = new MemoryJobStore()
    const { id } = await store.create({ credentialId: 'cred-1', ownerId: OWNER, toolName: 'generate_video', modelId: MODEL_ID, request: {} })
    const submitted: Array<{ modelPath: string; input: Record<string, any> }> = []

    const result = await executeGenerateVideo(
      parseGenerateVideoArgs({ prompt: 'the case opens', modelId: MODEL_ID, duration: 10, resolution: 1080, referenceImage: START, endFrameImage: END }),
      {
        allowedModels: ['*'],
        credentialId: 'cred-1',
        ownerId: OWNER,
        jobId: id,
        jobStore: store,
        handoff: {
          sign: async (v) => v,
          recordCall: async () => undefined,
          submit: async (options) => {
            submitted.push(options)
            return { predictionId: 'pred-1', status: 'starting', createdAt: new Date().toISOString() }
          },
        },
      }
    )

    expect(isHandedOff(result)).toBe(true)
    expect(submitted).toHaveLength(1)
    expect(submitted[0].modelPath).toBe('kwaivgi/kling-v3-video')
    expect(submitted[0].input).toMatchObject({ mode: 'pro', duration: 10, start_image: START, end_image: END })
    const job = (await store.get(id, OWNER))!
    expect(job.status).toBe('processing')
    expect(pendingOf(job)).toMatchObject({ provider: 'replicate', predictionId: 'pred-1', duration: 10, nominal: { width: 1920, height: 1080 } })
  })

  test('a handed-off job is neither completed nor failed by the budget race', async () => {
    const store = new MemoryJobStore()
    const { waitUntil, settle } = collectingWaitUntil()
    const outcome = await runWithBudget({
      store,
      waitUntil,
      credentialId: 'cred-1',
      ownerId: OWNER,
      toolName: 'generate_video',
      modelId: MODEL_ID,
      request: { prompt: 'p', modelId: MODEL_ID },
      budgetMs: 5_000,
      work: async () => HANDED_OFF,
      toPayload: () => {
        throw new Error('a handed-off job has no payload')
      },
    })
    await settle()
    expect(outcome.kind).toBe('handoff')
    expect((await store.get(outcome.jobId, OWNER))!.status).toBe('processing')
  })

  async function pendingJob(store: MemoryJobStore, submittedAt = new Date()) {
    const { id } = await store.create({
      credentialId: 'cred-1',
      ownerId: OWNER,
      toolName: 'generate_video',
      modelId: MODEL_ID,
      request: { prompt: 'the case opens', modelId: MODEL_ID, duration: 10, resolution: 1080, generateAudio: false, referenceImage: START, endFrameImage: END },
    })
    await store.setPending(id, {
      provider: 'replicate',
      predictionId: 'pred-1',
      submittedAt: submittedAt.toISOString(),
      nominal: { width: 1920, height: 1080 },
      duration: 10,
    })
    return (await store.get(id, OWNER))!
  }

  test('while Replicate renders, a check changes nothing', async () => {
    const store = new MemoryJobStore()
    const job = await pendingJob(store)
    const after = await advanceVideoJob(job, {
      store,
      recordUsage: async () => undefined,
      handoff: { status: async () => ({ status: 'processing' }) },
    })
    expect(after.status).toBe('processing')
    expect(pendingOf(after)?.predictionId).toBe('pred-1')
  })

  test('once done it is finished once, at its real size, its spend logged once, even with two callers at the same time', async () => {
    const store = new MemoryJobStore()
    const job = await pendingJob(store)
    const { calls: recorded, record } = fakeRecord()
    const usage: Array<{ costUsd: number | null }> = []
    let uploads = 0
    const deps = {
      store,
      recordUsage: async (_job: unknown, entry: { costUsd: number | null }) => {
        usage.push(entry)
      },
      handoff: { status: async () => ({ status: 'succeeded', output: 'https://replicate.delivery/out/video.mp4' }) },
      record,
      upload: async () => {
        uploads++
        await new Promise((r) => setTimeout(r, 20))
        return 'https://example.supabase.co/storage/v1/object/public/generated-images/mcp/v.mp4'
      },
      probe: async () => ({ width: 1928, height: 1072 }),
    }

    const [a, b] = await Promise.all([advanceVideoJob(job, deps), advanceVideoJob(job, deps)])
    const final = (await store.get(job.id, OWNER))!

    expect(final.status).toBe('completed')
    expect(uploads).toBe(1)
    expect(recorded).toHaveLength(1)
    expect(usage).toHaveLength(1)
    expect(usage[0].costUsd).toBeCloseTo(2.24)
    const structured = (final.result as { structuredContent: { outputs: Array<{ width: number; height: number }> } }).structuredContent
    expect(structured.outputs[0]).toMatchObject({ width: 1928, height: 1072 })
    expect((final.result as { summary: string }).summary).toContain('at 1928x1072')
    expect([a.status, b.status]).toContain('completed')
  })

  test('a failed prediction fails the job with what Replicate said', async () => {
    const store = new MemoryJobStore()
    const job = await pendingJob(store)
    const after = await advanceVideoJob(job, {
      store,
      recordUsage: async () => undefined,
      handoff: { status: async () => ({ status: 'failed', error: 'NSFW content detected' }) },
    })
    expect(after.status).toBe('failed')
    expect(after.error).toContain('NSFW content detected')
  })

  test('Replicate unreachable for a moment is not a failed video', async () => {
    const store = new MemoryJobStore()
    const job = await pendingJob(store)
    const after = await advanceVideoJob(job, {
      store,
      recordUsage: async () => undefined,
      handoff: {
        status: async () => {
          throw new Error('Failed to get prediction status: 502')
        },
      },
    })
    expect(after.status).toBe('processing')
  })

  test('a finish that breaks gives the lease back, so the next check tries again', async () => {
    const store = new MemoryJobStore()
    const job = await pendingJob(store)
    const base = {
      store,
      recordUsage: async () => undefined,
      handoff: { status: async () => ({ status: 'succeeded', output: ['https://replicate.delivery/out/video.mp4'] }) },
      probe: async () => ({ width: 1920, height: 1080 }),
      record: fakeRecord().record,
    }
    const broken = await advanceVideoJob(job, {
      ...base,
      upload: async () => {
        throw new Error('storage down')
      },
    })
    expect(broken.status).toBe('processing')
    expect(pendingOf(broken)?.leaseUntil ?? null).toBeNull()

    const retried = await advanceVideoJob(broken, { ...base, upload: async () => 'https://example.supabase.co/v.mp4' })
    expect(retried.status).toBe('completed')
  })
})

test.describe('a job waiting on its provider is not a lost worker', () => {
  test('stale only 30 minutes after the submit, not six minutes after the start', () => {
    const now = Date.now()
    const startedAt = new Date(now - STALE_PROCESSING_MS - 60_000)
    const waiting = {
      status: 'processing' as const,
      startedAt,
      updatedAt: startedAt,
      result: { pending: { provider: 'replicate', predictionId: 'p', submittedAt: new Date(now - 10 * 60_000).toISOString() } },
    }
    expect(isStale(waiting, now)).toBe(false)
    const overdue = { ...waiting, result: { pending: { ...waiting.result.pending, submittedAt: new Date(now - PENDING_MAX_MS - 1).toISOString() } } }
    expect(isStale(overdue, now)).toBe(true)
    // and a job with no provider handle keeps the six-minute rule
    expect(isStale({ status: 'processing', startedAt, updatedAt: startedAt, result: null }, now)).toBe(true)
  })

  test('the sweeper leaves a rendering video alone and fails one Replicate never finished', async () => {
    const store = new MemoryJobStore()
    const old = new Date(Date.now() - STALE_PROCESSING_MS - 60_000)
    store.seed({ id: 'lost', status: 'processing', toolName: 'generate_video', request: {}, startedAt: old })
    store.seed({
      id: 'rendering',
      status: 'processing',
      toolName: 'generate_video',
      request: {},
      startedAt: old,
      result: { pending: { provider: 'replicate', predictionId: 'p1', submittedAt: old.toISOString() } },
    })
    store.seed({
      id: 'overdue',
      status: 'processing',
      toolName: 'generate_video',
      request: {},
      startedAt: new Date(Date.now() - PENDING_MAX_MS - 120_000),
      result: { pending: { provider: 'replicate', predictionId: 'p2', submittedAt: new Date(Date.now() - PENDING_MAX_MS - 60_000).toISOString() } },
    })

    expect(await store.failStale(new Date(Date.now() - STALE_PROCESSING_MS), 'lost')).toBe(2)
    expect(store.rows.get('lost')!.status).toBe('failed')
    expect(store.rows.get('rendering')!.status).toBe('processing')
    expect(store.rows.get('overdue')!.error).toBe(PENDING_STALE_MESSAGE)
    expect((await store.listPending(10)).map((j) => j.id)).toEqual(['rendering'])
  })

  test('a lease is held for the finish and then free again', async () => {
    const store = new MemoryJobStore()
    store.seed({
      id: 'j',
      status: 'processing',
      toolName: 'generate_video',
      request: {},
      result: { pending: { provider: 'replicate', predictionId: 'p', submittedAt: new Date().toISOString() } },
    })
    expect(await store.leasePending('j', new Date(Date.now() + FINISH_LEASE_MS))).toBe(true)
    expect(await store.leasePending('j', new Date(Date.now() + FINISH_LEASE_MS))).toBe(false)
    await store.releasePending('j')
    expect(await store.leasePending('j', new Date(Date.now() + FINISH_LEASE_MS))).toBe(true)
  })
})
