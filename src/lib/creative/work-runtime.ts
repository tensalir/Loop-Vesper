/**
 * The production wiring of the creative work tools: the Gemini key, the pin
 * bucket, Vesper's own outputs, Frontify, the OpenAI adapter, storage.
 * Everything here reaches the network or the database; the logic it feeds
 * (`draw.ts`, `grade.ts`, `candidate.ts`) is tested without it.
 *
 * Env: GEMINI_API_KEY (the Gemini API, as the repository's scripts use it:
 * the pins' Files API uploads belong to this key), OPENAI_API_KEY (through
 * Vesper's adapter), FRONTIFY_DOMAIN and FRONTIFY_API_TOKEN, CREATIVE_PINS_BUCKET,
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { fetchAllowlisted } from '@/lib/net/fetch-allowlisted'
import { getModel } from '@/lib/models/registry'
import { geminiImagePriceUsd } from '@/lib/models/pricing'
import { uploadBase64ToStorage } from '@/lib/supabase/storage'
import { geminiFilesClient } from './gemini-files'
import { fetchFrontifyOriginal, pinBucket, pinStorage, prismaPinStore } from './pins-runtime'
import { pinModelCopy, pinPart, type PinPartDeps } from './pin-parts'
import { drawImage, gradeJson, imagePart, type GeminiDeps, type GeminiPart } from './gemini'
import { CANDIDATE_MAX_BYTES, type CandidateDeps } from './candidate'
import { GPT_MAX_REFERENCE_BYTES, type DrawPlan, type DrawnImage, type Lane } from './draw'

export const GENERATED_BUCKET = 'generated-images'
/** A signed URL to a pinned render outlives any iteration on the draw it anchors. */
export const ANCHOR_URL_SECONDS = 365 * 24 * 60 * 60

/** The kit's model names (the Gemini API's and OpenAI's) → Vesper's registry ids, for allowlists and prices. */
export const KIT_MODEL_TO_VESPER: Record<string, string> = {
  'gemini-3-pro-image': 'gemini-nano-banana-pro',
  'gemini-3.1-flash-image': 'gemini-nano-banana-2',
  'gpt-image-2': 'openai-gpt-image-2',
}

/** GPT Image 2 at high quality, as generate.py draws it; OpenAI's price sheet, 2026-09. */
export const GPT_IMAGE_2_HIGH_USD = 0.2
/** Three flash reads of about 9k tokens with a few images each; an estimate, logged as one. */
export const GRADE_READ_USD = 0.015

export function vesperModelId(kitModel: string): string {
  return KIT_MODEL_TO_VESPER[kitModel] ?? kitModel
}

export function drawPriceUsd(kitModel: string, imageSize: string): number | null {
  if (kitModel === 'gpt-image-2') return GPT_IMAGE_2_HIGH_USD
  return geminiImagePriceUsd(vesperModelId(kitModel), imageSize)
}

/** The daily cap's preflight, before the kit is read: the lane's usual model. */
export function laneEstimateUsd(lane: Lane | undefined, n: number, imageSize?: string): number {
  const model = lane === 'second' ? 'gemini-3-pro-image' : lane === 'draft' ? 'gemini-3.1-flash-image' : 'gpt-image-2'
  return (drawPriceUsd(model, imageSize ?? '2K') ?? 0.2) * Math.max(1, n)
}

export function geminiDeps(env: NodeJS.ProcessEnv = process.env): GeminiDeps {
  const apiKey = env.GEMINI_API_KEY?.trim()
  if (!apiKey) throw new Error('Vesper has no GEMINI_API_KEY, so it cannot grade or draw with Gemini.')
  return { apiKey }
}

function uploader(env: NodeJS.ProcessEnv) {
  const key = env.GEMINI_API_KEY?.trim()
  return key ? geminiFilesClient(key) : null
}

export function pinPartDeps(env: NodeJS.ProcessEnv, inlineLimit: number): PinPartDeps {
  const files = uploader(env)
  return {
    storage: pinStorage(env),
    upload: files ? (bytes, mime, name) => files.upload(bytes, mime, name) : undefined,
    remember: (row) => prismaPinStore.upsert(row),
    inlineLimit,
  }
}

/** The candidate as a part: inline up to the kit's limit, else uploaded once (never re-encoded). */
export async function candidatePartFor(
  env: NodeJS.ProcessEnv,
  inlineLimit: number,
  candidate: { bytes: Buffer; mimeType: string; sha256: string }
): Promise<GeminiPart> {
  const files = uploader(env)
  return imagePart(candidate.bytes, candidate.mimeType, {
    inlineLimit: files ? inlineLimit : Number.MAX_SAFE_INTEGER,
    upload: async (bytes, mime) => (await files!.upload(bytes, mime, `candidate/${candidate.sha256.slice(0, 16)}`)).uri,
  })
}

export function gradeReader(env: NodeJS.ProcessEnv, models: readonly string[]) {
  const deps = geminiDeps(env)
  return (parts: GeminiPart[], opts: { deadline: number; perCallMs: number }) =>
    gradeJson(deps, { models, parts, deadline: opts.deadline, perCallMs: opts.perCallMs })
}

export const productionCandidateDeps = (env: NodeJS.ProcessEnv = process.env): CandidateDeps => ({
  async findOwnOutput(outputId, ownerId) {
    const row = await prisma.output.findUnique({
      where: { id: outputId },
      select: { fileUrl: true, generation: { select: { userId: true, parameters: true } } },
    })
    if (!row || row.generation.userId !== ownerId) return null
    return { fileUrl: row.fileUrl, parameters: row.generation.parameters }
  },
  async fetchUrl(url) {
    const got = await fetchAllowlisted(url, { maxBytes: CANDIDATE_MAX_BYTES, timeoutMs: 60_000, contentTypes: ['image/'] })
    return { bytes: got.buffer, contentType: got.contentType }
  },
  async fetchFrontify(assetId) {
    const got = await fetchFrontifyOriginal(assetId, env)
    return got ? { bytes: got.bytes, contentType: got.contentType } : null
  },
})

/**
 * The draw function for a plan: Gemini directly (the kit's model id, the pins
 * by their Files API URIs), or GPT Image 2 through Vesper's OpenAI adapter
 * (the pins as bytes; one over 50 MiB is left out and named). Never sends
 * `input_fidelity`.
 */
export async function prepareDrawOne(
  plan: DrawPlan,
  env: NodeJS.ProcessEnv,
  inlineLimit: number
): Promise<{ drawOne: (plan: DrawPlan, index: number, deadline: number) => Promise<DrawnImage>; skipped: string[] }> {
  const skipped: string[] = []
  if (plan.model === 'gpt-image-2') {
    const storage = pinStorage(env)
    const dataUrls: string[] = []
    for (const ref of plan.references) {
      const copy = await pinModelCopy(ref.row, ref.spec, storage)
      if (copy.bytes.length > GPT_MAX_REFERENCE_BYTES) {
        skipped.push(`${ref.title ?? ref.pin_id}: over GPT Image 2's 50 MiB limit, left out rather than resized`)
        continue
      }
      dataUrls.push(`data:${copy.mimeType};base64,${copy.bytes.toString('base64')}`)
    }
    const adapter = getModel('openai-gpt-image-2')
    if (!adapter) throw new Error('Vesper has no GPT Image 2 adapter configured.')
    return {
      skipped,
      drawOne: async (p) => {
        const res = await adapter.generate({
          prompt: p.prompt,
          referenceImages: dataUrls,
          aspectRatio: p.aspect,
          resolution: p.image_size === '4K' ? 4096 : p.image_size === '1K' ? 1024 : 2048,
          quality: 'high',
          numOutputs: 1,
        })
        const url = res.outputs?.[0]?.url
        if (res.status !== 'completed' || !url) throw new Error(res.error || 'GPT Image 2 returned no image')
        const m = url.match(/^data:([^;,]+);base64,(.+)$/)
        if (!m) throw new Error('GPT Image 2 returned an image Vesper cannot read')
        return { bytes: Buffer.from(m[2], 'base64'), mimeType: m[1], model: 'gpt-image-2', settings: { quality: 'high', aspectRatio: p.aspect, resolution: p.image_size } }
      },
    }
  }
  const deps = geminiDeps(env)
  const partDeps = pinPartDeps(env, inlineLimit)
  const parts: GeminiPart[] = []
  for (const ref of plan.references) parts.push(await pinPart(ref.row, ref.spec, partDeps))
  return {
    skipped,
    drawOne: async (p, _index, deadline) => {
      const img = await drawImage(deps, { model: p.model, prompt: p.prompt, references: parts, aspect: p.aspect, size: p.image_size, deadline })
      return { ...img, model: p.model, settings: { aspectRatio: p.aspect, imageSize: p.image_size } }
    },
  }
}

export async function imageSize(bytes: Buffer): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(bytes).metadata()
    return { width: meta.width ?? 0, height: meta.height ?? 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

/** A drawn image into Vesper's generated-images bucket; returns its URL. */
export async function storeDrawn(bytes: Buffer, mimeType: string, path: string): Promise<string> {
  return uploadBase64ToStorage(`data:${mimeType};base64,${bytes.toString('base64')}`, GENERATED_BUCKET, path)
}

let admin: SupabaseClient | null = null
function supabaseAdmin(env: NodeJS.ProcessEnv): SupabaseClient {
  if (!admin) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL
    const key = env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
    admin = createClient(url, key, { auth: { persistSession: false } })
  }
  return admin
}

/**
 * A long-lived signed URL to a pinned render, for `parameters.anchor`: when
 * someone iterates on the draw in the web app, the worker re-attaches the
 * render from it (src/lib/generation/anchor.ts), never the previous draw.
 */
export async function anchorUrl(storagePath: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const { data, error } = await supabaseAdmin(env).storage.from(pinBucket(env)).createSignedUrl(storagePath, ANCHOR_URL_SECONDS)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
