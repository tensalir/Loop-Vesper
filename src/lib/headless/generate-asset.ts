/**
 * `generate_asset` MCP tool.
 *
 * Synchronous, fast image models only. Calls Vesper's existing image
 * pipeline through `getModel(modelId).generate(...)`, persists the
 * resulting image to Supabase Storage (`generated-images` bucket),
 * and returns a small JSON response with a `text` summary and one
 * `resource_link` per output pointing at the stored image.
 *
 * Why URLs, not inline base64 (default):
 *   - Cowork's CoworkArtifactBridge validates IPC payloads when an
 *     artifact calls back into MCP. Large `image` content blocks
 *     (~500 KB base64) trigger validation failures and the artifact
 *     never receives the response.
 *   - claude.ai web's renderer collapses inline `image` content blocks
 *     into the tool-use accordion instead of inlining them in the
 *     reply. URLs let Claude embed `<img src>` in artifacts and let
 *     users click through to the image directly.
 *   - Smaller payload = faster tool roundtrip and less token cost.
 *
 * Callers that explicitly want inline bytes (e.g. Anthropic API direct
 * callers without an artifact bridge) can pass `inlineBase64: true` to
 * also receive the legacy `image` content block alongside the URL.
 *
 * What this is NOT (yet):
 *   - Async / poll for slow video models. Veo, Kling, etc. are
 *     explicitly rejected with a "use the web app" hint. Future work.
 *   - Wired into the `Generation` table the Studio gallery reads from.
 *     Future work — needs a per-user MCP Project + Session provisioner.
 *
 * The 25s hard cap wraps `adapter.generate` only; storage uploads
 * happen after the model returns and run within the standard Vercel
 * function timeout for the route.
 */

import { randomUUID } from 'node:crypto'
import { HeadlessGenerateAssetSchema } from '@/lib/api/validation'
import { getModel, getModelConfig } from '@/lib/models/registry'
import type { GenerationRequest } from '@/lib/models/base'
import { uploadUrlToStorage } from '@/lib/supabase/storage'
import { resolveProductRenders } from './list-product-renders'

/**
 * Image models that respond synchronously and typically complete in
 * under 25s. Anything outside this list is rejected with a clear
 * "Phase 2" message even if the credential is otherwise allowed it.
 */
export const PHASE_1_MODEL_IDS = [
  'gemini-nano-banana-pro',
  'gemini-nano-banana-2',
  'openai-gpt-image-2',
  'replicate-seedream-4',
  'replicate-reve',
  'replicate-nano-banana-pro',
] as const

export type Phase1ModelId = (typeof PHASE_1_MODEL_IDS)[number]

const MCP_TOOL_TIMEOUT_MS = 25_000

/** Standard MCP content block shapes we emit. */
type McpTextContent = { type: 'text'; text: string }
type McpImageContent = { type: 'image'; data: string; mimeType: string }
type McpResourceLinkContent = {
  type: 'resource_link'
  uri: string
  name: string
  mimeType?: string
  description?: string
}
export type McpContent =
  | McpTextContent
  | McpImageContent
  | McpResourceLinkContent

export interface GenerateAssetResult {
  content: McpContent[]
  structuredContent: {
    modelId: string
    outputs: Array<{
      url: string
      width: number
      height: number
      mimeType: string
    }>
    durationMs: number
    estimatedCostUsd: number | null
  }
  /** Pipe back to the dispatcher so `recordHeadlessUsage` gets the right
   *  `costUsd`. `null` when the model has no published per-image price. */
  costUsd: number | null
}

interface CallerPrincipal {
  allowedModels: string[]
  /** Used to namespace storage paths so each credential's outputs live
   *  under their own folder (and so leaks of one URL don't leak another's). */
  credentialId: string
}

/** Storage bucket reused from the web app's image pipeline — see
 *  src/app/api/generate/process/route.ts. Same RLS / public-read posture. */
const STORAGE_BUCKET = 'generated-images'

/** Map a normalised image MIME type to a sensible file extension. PNG is the
 *  conservative fallback when the upstream provider sends nothing useful. */
function extensionForMime(mimeType: string | null | undefined): string {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/png':
      return 'png'
    default:
      return 'png'
  }
}

/** Probe an upstream URL with HEAD to learn its content-type without
 *  downloading bytes. Falls back to extension sniffing on the URL itself,
 *  then to PNG as the conservative default. */
async function probeMimeType(url: string): Promise<string> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)/)
    if (match) return match[1]
    return 'image/png'
  }
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const ct = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
    if (ct.startsWith('image/')) return ct
  } catch {
    // Fall through to extension sniffing.
  }
  const m = url.toLowerCase().match(/\.(png|jpe?g|webp|gif)(?:[?#]|$)/)
  if (m) {
    return m[1] === 'jpg' || m[1] === 'jpeg' ? 'image/jpeg' : `image/${m[1]}`
  }
  return 'image/png'
}

/**
 * Race a promise against a hard deadline. Used so a slow upstream
 * provider can not stall the MCP connection beyond 25 seconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Convert a generated image URL (or already-base64 `data:` URL) into the
 * `{ data, mimeType }` pair MCP expects. Adapter outputs are usually
 * provider URLs (Gemini, Replicate, OpenAI) backed by short-lived
 * signed links; we fetch them here so the caller never has to.
 */
async function inlineImageFromUrl(
  url: string
): Promise<{ data: string; mimeType: string; bytes: number }> {
  if (url.startsWith('data:')) {
    const commaIndex = url.indexOf(',')
    if (commaIndex < 0) throw new Error('Malformed data URL from upstream')
    const meta = url.slice(0, commaIndex)
    const data = url.slice(commaIndex + 1)
    const mimeMatch = meta.match(/^data:([^;]+)/)
    const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
    return {
      data,
      mimeType,
      bytes: Math.floor((data.length * 3) / 4),
    }
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch generated image from upstream (HTTP ${res.status}).`
    )
  }
  const buf = await res.arrayBuffer()
  const data = Buffer.from(buf).toString('base64')

  // Prefer the response Content-Type; fall back to URL extension; then
  // PNG as the conservative default for image generation.
  let mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || ''
  if (!mimeType.startsWith('image/')) {
    const m = url.toLowerCase().match(/\.(png|jpe?g|webp|gif)(?:[?#]|$)/)
    if (m) {
      mimeType = m[1] === 'jpg' || m[1] === 'jpeg' ? 'image/jpeg' : `image/${m[1]}`
    } else {
      mimeType = 'image/png'
    }
  }
  return { data, mimeType, bytes: buf.byteLength }
}

/**
 * Phase 1 implementation of the `generate_asset` MCP tool.
 *
 * Throws on any validation, allowlist, timeout, or upstream failure.
 * The dispatcher in `/api/mcp/route.ts` translates thrown errors into
 * MCP `isError: true` content blocks so calling agents can see + react.
 */
export async function generateAssetTool(
  args: Record<string, unknown>,
  principal: CallerPrincipal
): Promise<GenerateAssetResult> {
  const startedAt = Date.now()

  const parsed = HeadlessGenerateAssetSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(
      `Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`
    )
  }
  const {
    prompt,
    modelId,
    aspectRatio,
    referenceImage,
    productRenderIds,
    numOutputs,
    seed,
    inlineBase64,
  } = parsed.data
  const generationId = randomUUID()

  // Phase 1 allowlist — applied before the credential allowlist so we
  // can give callers the most useful error message ("video models are
  // Phase 2") rather than a generic "not permitted".
  if (!(PHASE_1_MODEL_IDS as readonly string[]).includes(modelId)) {
    const config = getModelConfig(modelId)
    if (config?.type === 'video') {
      throw new Error(
        `Video model '${modelId}' is not yet available via the MCP connector. Use the Vesper web app for video generation; async support is on the Phase 2 roadmap.`
      )
    }
    throw new Error(
      `Model '${modelId}' is not yet available via the MCP connector. Allowed today: ${PHASE_1_MODEL_IDS.join(', ')}.`
    )
  }

  // Per-credential allowlist — same shape as enhance_prompt / iterate_prompt.
  if (
    principal.allowedModels.length > 0 &&
    !principal.allowedModels.includes('*') &&
    !principal.allowedModels.includes(modelId)
  ) {
    throw new Error(`This token is not permitted to use model '${modelId}'.`)
  }

  const adapter = getModel(modelId)
  if (!adapter) {
    throw new Error(`Unknown model '${modelId}'.`)
  }

  // Resolve productRenderIds (if any) into base64 data URLs so the same
  // model adapters that power the web app's prompt bar see them as
  // ordinary reference images. We base64-inline rather than passing raw
  // Supabase URLs so adapters do not need to make outbound fetches and
  // we avoid SSRF surface area through the model layer.
  const renderRefs: string[] = []
  if (productRenderIds && productRenderIds.length > 0) {
    const rows = await resolveProductRenders(productRenderIds)
    const inlinedRefs = await Promise.all(
      rows.map(async (row) => {
        const inlined = await inlineImageFromUrl(row.imageUrl)
        return `data:${inlined.mimeType};base64,${inlined.data}`
      })
    )
    renderRefs.push(...inlinedRefs)
  }

  // Stitch caller-supplied referenceImage and any productRender data URLs
  // into one ordered list. Caller's own image first; then renders in the
  // order they were passed (resolveProductRenders preserves caller order).
  const allRefs: string[] = []
  if (referenceImage) allRefs.push(referenceImage)
  allRefs.push(...renderRefs)

  if (allRefs.length > 4) {
    throw new Error(
      `Too many reference images (${allRefs.length}). Cap is 4 across referenceImage + productRenderIds.`
    )
  }

  // Multi-image dispatch: only models advertising multiImageEditing get
  // the array shape. Anything else with >1 reference is an error rather
  // than a silent drop, so the caller can correct course.
  const config = getModelConfig(modelId)
  const supportsMulti = !!config?.capabilities?.multiImageEditing
  let referenceImagePayload: string | undefined
  let referenceImagesPayload: string[] | undefined
  if (allRefs.length === 1) {
    referenceImagePayload = allRefs[0]
  } else if (allRefs.length > 1) {
    if (!supportsMulti) {
      throw new Error(
        `Model '${modelId}' only supports one reference image. Drop one of the productRenderIds (or the referenceImage), or pick a multi-image model like gemini-nano-banana-pro.`
      )
    }
    referenceImagesPayload = allRefs
  }

  const request: GenerationRequest = {
    prompt,
    numOutputs,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(referenceImagePayload ? { referenceImage: referenceImagePayload } : {}),
    ...(referenceImagesPayload ? { referenceImages: referenceImagesPayload } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
  }

  const generation = await withTimeout(
    adapter.generate(request),
    MCP_TOOL_TIMEOUT_MS,
    `Generation timed out after ${Math.floor(MCP_TOOL_TIMEOUT_MS / 1000)}s. Try a faster model or a shorter prompt.`
  )

  if (generation.status !== 'completed' || !generation.outputs?.length) {
    const reason = generation.error || 'no outputs returned'
    throw new Error(`Generation did not complete: ${reason}`)
  }

  // Persist each output to Supabase Storage in parallel. We probe the
  // upstream MIME first so the storage path's extension matches the
  // actual bytes (no .png pretending to be jpg). uploadUrlToStorage
  // streams source -> bucket without holding the full image in memory
  // here, which keeps the MCP route's memory footprint small.
  const persisted = await Promise.all(
    generation.outputs.map(async (output, idx) => {
      const mimeType = await probeMimeType(output.url)
      const ext = extensionForMime(mimeType)
      const path = `mcp/${principal.credentialId}/${generationId}/${idx}.${ext}`
      const storedUrl = await uploadUrlToStorage(
        output.url,
        STORAGE_BUCKET,
        path
      )
      return {
        url: storedUrl,
        width: output.width,
        height: output.height,
        mimeType,
        path,
      }
    })
  )

  const perImage = config?.pricing?.perImage ?? null
  const estimatedCostUsd =
    perImage !== null ? perImage * persisted.length : null

  const dimensionsSummary = persisted.map((o) => `${o.width}x${o.height}`).join(', ')
  const urlsLine =
    persisted.length === 1
      ? `View: ${persisted[0].url}`
      : `View:\n${persisted.map((o, idx) => `${idx + 1}. ${o.url}`).join('\n')}`
  const summary = `Generated ${persisted.length} image${persisted.length === 1 ? '' : 's'} with ${modelId} (${dimensionsSummary}). ${urlsLine}`

  const content: McpContent[] = [{ type: 'text', text: summary }]

  // Always emit one resource_link per output. MCP-aware clients render
  // these as typed asset references; clients that don't recognise the
  // type still get the URL via the text block above.
  for (let idx = 0; idx < persisted.length; idx++) {
    const out = persisted[idx]
    content.push({
      type: 'resource_link',
      uri: out.url,
      name: `${modelId}-${out.width}x${out.height}-${idx}.${extensionForMime(out.mimeType)}`,
      mimeType: out.mimeType,
      description: `Image ${idx + 1} of ${persisted.length} from ${modelId}`,
    })
  }

  // Opt-in: also include legacy inline base64 image content blocks. Off
  // by default to keep the response payload small and to dodge bridge-
  // validation issues in clients like Cowork's CoworkArtifactBridge.
  if (inlineBase64) {
    const inlined = await Promise.all(
      persisted.map((out) => inlineImageFromUrl(out.url))
    )
    for (const img of inlined) {
      content.push({
        type: 'image',
        data: img.data,
        mimeType: img.mimeType,
      })
    }
  }

  return {
    content,
    structuredContent: {
      modelId,
      outputs: persisted.map((o) => ({
        url: o.url,
        width: o.width,
        height: o.height,
        mimeType: o.mimeType,
      })),
      durationMs: Date.now() - startedAt,
      estimatedCostUsd,
    },
    costUsd: estimatedCostUsd,
  }
}
