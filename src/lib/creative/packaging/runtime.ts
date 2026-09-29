/**
 * The production wiring of the packaging flow: Supabase storage with signed URLs (the worker reads
 * and writes only through them), and the model call in Vesper, which holds the keys.
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CREATIVE_PINS_BUCKET, GEMINI_API_KEY,
 * OPENAI_API_KEY (through Vesper's adapter), CREATIVE_WORKER_URL, CREATIVE_WORKER_SECRET.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getModel } from '@/lib/models/registry'
import { adapterSizeFor } from '@/lib/models/adapters/openai'
import { drawImage, type GeminiPart } from '../gemini'
import { pinPart } from '../pin-parts'
import { candidatePartFor, geminiDeps, pinPartDeps } from '../work-runtime'
import type { DrawCall, FlowStorage, StoreTarget } from './flow'
import { PackagingError } from './kit-packaging'

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

export function supabaseFlowStorage(env: NodeJS.ProcessEnv = process.env): FlowStorage {
  const from = (t: StoreTarget) => supabaseAdmin(env).storage.from(t.bucket)
  return {
    async signedGet(t, seconds) {
      const { data, error } = await from(t).createSignedUrl(t.path, seconds)
      if (error || !data?.signedUrl) throw new Error(`could not sign ${t.bucket}/${t.path}: ${error?.message ?? 'no URL'}`)
      return data.signedUrl
    },
    async signedPut(t) {
      const { data, error } = await from(t).createSignedUploadUrl(t.path, { upsert: true })
      if (error || !data?.signedUrl) throw new Error(`could not sign an upload to ${t.bucket}/${t.path}: ${error?.message ?? 'no URL'}`)
      return { upload_url: data.signedUrl, content_type: 'image/png' }
    },
    async read(t) {
      const { data, error } = await from(t).download(t.path)
      if (error || !data) return null
      return Buffer.from(await data.arrayBuffer())
    },
    async write(t, bytes, contentType) {
      const { error } = await from(t).upload(t.path, bytes, { contentType, upsert: true })
      if (error) throw new Error(`storing ${t.bucket}/${t.path} failed: ${error.message}`)
    },
    publicUrl(t) {
      return from(t).getPublicUrl(t.path).data.publicUrl
    },
  }
}

/**
 * One finishing call. Gemini: the pinned render by its Files API copy (never re-encoded), the
 * padded composite and the dieline half inline or uploaded, then the prompt, with the lane's
 * aspect and size. GPT Image 2: the three as data URLs in binding order (image 1, the padded
 * composite, is the edit target), the lane's exact size through the adapter, never
 * `input_fidelity`.
 */
export function packagingDraw(env: NodeJS.ProcessEnv, inlineLimit: number) {
  return async (call: DrawCall): Promise<{ bytes: Buffer; mimeType: string }> => {
    if (call.provider === 'openai') {
      const size = String(call.request.size ?? '')
      const at = adapterSizeFor(size)
      if (!at) throw new PackagingError(`Vesper's GPT Image 2 adapter cannot send the size ${size} the lane asks for`)
      const adapter = getModel('openai-gpt-image-2')
      if (!adapter) throw new Error('Vesper has no GPT Image 2 adapter configured.')
      const res = await adapter.generate({
        prompt: call.prompt,
        referenceImages: call.references.map((r) => `data:${r.mimeType};base64,${r.bytes.toString('base64')}`),
        aspectRatio: at.aspectRatio,
        resolution: at.resolution,
        quality: typeof call.request.quality === 'string' ? call.request.quality : 'high',
        numOutputs: 1,
      })
      const url = res.outputs?.[0]?.url
      if (res.status !== 'completed' || !url) throw new Error(res.error || 'GPT Image 2 returned no image')
      const m = url.match(/^data:([^;,]+);base64,(.+)$/)
      if (!m) throw new Error('GPT Image 2 returned an image Vesper cannot read')
      return { bytes: Buffer.from(m[2], 'base64'), mimeType: m[1] }
    }
    const parts: GeminiPart[] = []
    const partDeps = pinPartDeps(env, inlineLimit)
    for (const ref of call.references) {
      parts.push(ref.pin ? await pinPart(ref.pin.row, ref.pin.spec, partDeps) : await candidatePartFor(env, inlineLimit, ref))
    }
    return drawImage(geminiDeps(env), {
      model: call.model,
      prompt: call.prompt,
      references: parts,
      aspect: String(call.request.aspectRatio ?? '16:9'),
      size: String(call.request.imageSize ?? '2K'),
      deadline: call.deadline,
    })
  }
}
