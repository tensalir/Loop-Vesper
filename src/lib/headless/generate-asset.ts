/**
 * `generate_asset`: the work itself, separate from the MCP entry.
 *
 * `executeGenerateAsset` draws, stores the files and records the draw as a
 * generation in the caller's "Claude" project. It never queues anything: the
 * entry in `./tools/generate-asset.ts` decides whether the caller waits for it
 * or collects it later as a job, and a job runs this function directly, so a
 * stored request can never queue itself again.
 *
 * Results carry JPEG previews and links to the full-resolution files. Each preview goes out twice
 * (`imageBlocks`): once marked for the user alone, which claude.ai draws inline, and once for the
 * assistant, which Claude reads.
 */

import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { HeadlessGenerateAssetSchema } from '@/lib/api/validation'
import { getModel, getModelConfig } from '@/lib/models/registry'
import type { GenerationRequest } from '@/lib/models/base'
import { uploadBase64ToStorage, uploadUrlToStorage } from '@/lib/supabase/storage'
import { referenceToDataUrl } from '@/lib/net/fetch-allowlisted'
import { makeImagePreview } from '@/lib/images/preview'
import { resolveProductRenders } from './list-product-renders'
import { getMcpGenerationTimeoutMs } from './mcp-timeout'
import type { McpProgressReporter } from './mcp-progress'
import { estimateGenerationCostUsd } from './estimate-cost'
import { PHASE_1_MODEL_IDS } from './model-allowlists'
import type { JobPayload } from './jobs'
import { recordMcpGeneration, STREAM_SESSIONS, type McpStream } from './record-generation'
import type { GenerationAnchor } from '@/lib/generation/anchor'

export { PHASE_1_MODEL_IDS, type Phase1ModelId } from './model-allowlists'

type McpContentAnnotations = {
  audience?: Array<'user' | 'assistant'>
  priority?: number
}

type McpTextContent = {
  type: 'text'
  text: string
  annotations?: McpContentAnnotations
}
type McpImageContent = {
  type: 'image'
  data: string
  mimeType: string
  annotations?: McpContentAnnotations
}
type McpResourceLinkContent = {
  type: 'resource_link'
  uri: string
  name: string
  mimeType?: string
  description?: string
  annotations?: McpContentAnnotations
}
export type McpContent = McpTextContent | McpImageContent | McpResourceLinkContent

/**
 * Who a picture is for. claude.ai draws an image inline in the chat only when it is marked for the
 * user; before 2026-09-24 every preview was marked `['user']`, so the person saw it and Claude did
 * not. The jobs fix (#9) removed the mark so Claude could read its draws, and the pictures fell back
 * into the folded tool result. Marking each preview for both (#18) did not bring it back: tested
 * in claude.ai on 2026-09-24, a picture marked `['user', 'assistant']` is handed to Claude and not
 * drawn. What claude.ai draws is a picture marked for the user alone. So the default sends each
 * preview twice: one block marked `['user']`, exactly as before #9, and one marked `['assistant']`.
 *
 * `MCP_IMAGE_AUDIENCE` changes it without a code change: `split` (default), `user` (the mark from
 * before #9 alone: inline, and Claude may not see it), or `both` (one block for both audiences).
 */
export type ImageAudienceMode = 'split' | 'user' | 'both'

export function imageAudienceMode(): ImageAudienceMode {
  const v = (process.env.MCP_IMAGE_AUDIENCE || '').trim().toLowerCase()
  return v === 'user' || v === 'both' ? v : 'split'
}

export function imageBlocks(data: string, mimeType: string, mode: ImageAudienceMode = imageAudienceMode()): McpImageContent[] {
  if (mode === 'split') {
    return [
      { type: 'image', data, mimeType, annotations: { audience: ['user'], priority: 0.95 } },
      { type: 'image', data, mimeType, annotations: { audience: ['assistant'], priority: 0.95 } },
    ]
  }
  const audience: Array<'user' | 'assistant'> = mode === 'user' ? ['user'] : ['user', 'assistant']
  return [{ type: 'image', data, mimeType, annotations: { audience, priority: 0.95 } }]
}

function linkAudience(mode: ImageAudienceMode): McpContentAnnotations {
  return { audience: mode === 'user' ? ['user'] : ['user', 'assistant'], priority: 0.85 }
}

export type GenerateAssetArgs = z.infer<typeof HeadlessGenerateAssetSchema>

export interface GenerateAssetOutput {
  url: string
  width: number
  height: number
  mimeType: string
  /** The `outputs` row in the web app; null when recording failed. */
  outputId: string | null
  /** A small public JPEG of the same picture, for showing in a reply; null when it could not be made. */
  previewUrl: string | null
  /** The name to save the preview as in a connected folder, so the file card reads as the draw. */
  filename: string
}

/** A product render or clown the draw was anchored on; iterating in the web app re-attaches it. */
export type { GenerationAnchor }

export interface GenerateAssetExecution {
  generationId: string
  modelId: string
  effectiveModelId: string
  provider: string | undefined
  isFallback: boolean
  routeReason: string | null
  outputs: GenerateAssetOutput[]
  /** Where each image's bytes can be read for a preview (a data URL when we still hold it). */
  previewSources: string[]
  durationMs: number
  estimatedCostUsd: number | null
  recorded: { projectId: string; sessionId: string; stream: McpStream } | null
  recordError: string | null
  progressTrail: string | null
}

export interface ExecuteContext {
  allowedModels: string[]
  credentialId: string
  ownerId: string
  progress?: McpProgressReporter
  jobId?: string | null
  /** Injected for tests. */
  record?: typeof recordMcpGeneration
}

const STORAGE_BUCKET = 'generated-images'

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
    // fall through
  }
  const m = url.toLowerCase().match(/\.(png|jpe?g|webp|gif)(?:[?#]|$)/)
  if (m) {
    return m[1] === 'jpg' || m[1] === 'jpeg' ? 'image/jpeg' : `image/${m[1]}`
  }
  return 'image/png'
}

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

/** Read bytes from a data URL or from one of our own storage / provider URLs. */
async function readImageBytes(source: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',')
    if (comma < 0) throw new Error('Malformed data URL from upstream')
    const mimeType = source.slice(5, comma).split(';')[0] || 'image/png'
    return { buffer: Buffer.from(source.slice(comma + 1), 'base64'), mimeType }
  }
  const res = await fetch(source)
  if (!res.ok) throw new Error(`Failed to fetch image (HTTP ${res.status}).`)
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png'
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType }
}

export function parseGenerateAssetArgs(args: Record<string, unknown>): GenerateAssetArgs {
  const parsed = HeadlessGenerateAssetSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments: ${parsed.error.issues.map((i) => i.message).join('; ')}`)
  }
  return parsed.data
}

/** The checks that must fail before a job exists, so a bad call never becomes a job. */
export function assertGenerateAssetAllowed(args: GenerateAssetArgs, allowedModels: string[]): void {
  const { modelId } = args
  if (!(PHASE_1_MODEL_IDS as readonly string[]).includes(modelId)) {
    const config = getModelConfig(modelId)
    if (config?.type === 'video') {
      throw new Error(
        `Video model '${modelId}' requires generate_video with async polling, not generate_asset.`
      )
    }
    throw new Error(
      `Model '${modelId}' is not yet available via generate_asset. Allowed: ${PHASE_1_MODEL_IDS.join(', ')}.`
    )
  }
  if (allowedModels.length > 0 && !allowedModels.includes('*') && !allowedModels.includes(modelId)) {
    throw new Error(`This token is not permitted to use model '${modelId}'.`)
  }
}

export async function executeGenerateAsset(
  args: GenerateAssetArgs,
  ctx: ExecuteContext
): Promise<GenerateAssetExecution> {
  const startedAt = Date.now()
  const progress = ctx.progress
  assertGenerateAssetAllowed(args, ctx.allowedModels)

  const { prompt, modelId, aspectRatio, referenceImage, productRenderIds, numOutputs, seed, allowFallback } = args
  const adapter = getModel(modelId)
  if (!adapter) throw new Error(`Unknown model '${modelId}'.`)

  progress?.step('Resolving references')

  // Product renders come from our own table, so their URLs are trusted.
  let anchor: GenerationAnchor | null = null
  const renderRefs: string[] = []
  if (productRenderIds && productRenderIds.length > 0) {
    const rows = await resolveProductRenders(productRenderIds)
    const read = await Promise.all(rows.map((row) => readImageBytes(row.imageUrl)))
    read.forEach(({ buffer, mimeType }) => {
      renderRefs.push(`data:${mimeType};base64,${buffer.toString('base64')}`)
    })
    anchor = {
      kind: 'product-render',
      id: rows[0].id,
      url: rows[0].imageUrl,
      sha256: createHash('sha256').update(read[0].buffer).digest('hex'),
    }
  }

  // A caller-supplied reference goes through the fetch allowlist.
  const normalizedRef = referenceImage ? await referenceToDataUrl(referenceImage) : undefined
  const allRefs: string[] = []
  if (normalizedRef) allRefs.push(normalizedRef)
  allRefs.push(...renderRefs)

  if (allRefs.length > 4) {
    throw new Error(
      `Too many reference images (${allRefs.length}). Cap is 4 across referenceImage + productRenderIds.`
    )
  }

  const config = getModelConfig(modelId)
  const supportsMulti = !!config?.capabilities?.multiImageEditing
  let referenceImagePayload: string | undefined
  let referenceImagesPayload: string[] | undefined
  if (allRefs.length === 1) {
    referenceImagePayload = allRefs[0]
  } else if (allRefs.length > 1) {
    if (!supportsMulti) {
      throw new Error(
        `Model '${modelId}' only supports one reference image. Pick gemini-nano-banana-pro for multi-image.`
      )
    }
    referenceImagesPayload = allRefs
  }

  const request: GenerationRequest = {
    prompt,
    numOutputs,
    allowFallback: allowFallback !== false,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(referenceImagePayload ? { referenceImage: referenceImagePayload } : {}),
    ...(referenceImagesPayload ? { referenceImages: referenceImagesPayload } : {}),
    ...(typeof seed === 'number' ? { seed } : {}),
  }

  progress?.step('Generating image')

  const timeoutMs = getMcpGenerationTimeoutMs(modelId)
  const generation = await withTimeout(
    adapter.generate(request),
    timeoutMs,
    `Generation timed out after ${Math.floor(timeoutMs / 1000)}s. Try again, or try a faster model.`
  )

  if (generation.status !== 'completed' || !generation.outputs?.length) {
    throw new Error(generation.error || 'Generation did not complete')
  }

  progress?.step('Uploading to Storage')

  const generationId = randomUUID()
  const persisted = await Promise.all(
    generation.outputs.map(async (output, idx) => {
      const mimeType = await probeMimeType(output.url)
      const ext = extensionForMime(mimeType)
      const path = `mcp/${ctx.credentialId}/${generationId}/${idx}.${ext}`
      const storedUrl = output.url.startsWith('data:')
        ? await uploadBase64ToStorage(output.url, STORAGE_BUCKET, path)
        : await uploadUrlToStorage(output.url, STORAGE_BUCKET, path)
      const previewSource = output.url.startsWith('data:') ? output.url : storedUrl
      // A small public JPEG beside the original: what a reply shows (claude.ai draws a picture the
      // reply carries as a markdown image, never one inside the tool result), and what a poll
      // sends as the preview without re-reading a multi-megabyte original.
      let previewUrl: string | null = null
      try {
        const { buffer } = await readImageBytes(previewSource)
        const preview = await makeImagePreview(buffer)
        previewUrl = await uploadBase64ToStorage(
          `data:${preview.mimeType};base64,${preview.data}`,
          STORAGE_BUCKET,
          `mcp/${ctx.credentialId}/${generationId}/${idx}-preview.jpg`
        )
      } catch (err) {
        console.warn('[mcp/generate_asset] preview upload failed', (err as Error)?.message)
      }
      return {
        url: storedUrl,
        width: output.width,
        height: output.height,
        mimeType,
        previewSource,
        previewUrl,
      }
    })
  )

  const meta = generation.metadata ?? {}
  const provider =
    typeof meta.backend === 'string'
      ? meta.backend
      : typeof meta.provider === 'string'
        ? meta.provider
        : config?.provider?.toLowerCase()
  const isFallback = Boolean(meta.isFallback)
  const routeReason = typeof meta.routeReason === 'string' ? meta.routeReason : null
  const effectiveModelId = typeof meta.effectiveModelId === 'string' ? meta.effectiveModelId : modelId
  const estimatedCostUsd = estimateGenerationCostUsd({ modelId, numOutputs: persisted.length })

  progress?.step('Recording in Vesper')

  const stream: McpStream = 'free'
  let outputIds: Array<string | null> = persisted.map(() => null)
  let recorded: GenerateAssetExecution['recorded'] = null
  let recordError: string | null = null
  try {
    const result = await (ctx.record ?? recordMcpGeneration)({
      ownerId: ctx.ownerId,
      generationId,
      stream,
      modelId,
      prompt,
      costUsd: estimatedCostUsd,
      outputs: persisted.map((p) => ({ url: p.url, width: p.width, height: p.height })),
      parameters: {
        toolName: 'generate_asset',
        credentialId: ctx.credentialId,
        mcpJobId: ctx.jobId ?? null,
        numOutputs,
        ...(aspectRatio ? { aspectRatio } : {}),
        ...(typeof seed === 'number' ? { seed } : {}),
        allowFallback: allowFallback !== false,
        ...(productRenderIds?.length ? { productRenderIds } : {}),
        ...(referenceImage && /^https:\/\//i.test(referenceImage) ? { referenceImageUrl: referenceImage } : {}),
        ...(anchor ? { anchor } : {}),
        provider,
        effectiveModelId,
        isFallback,
        routeReason,
        estimatedCostUsd,
      },
    })
    outputIds = result.outputIds
    recorded = { projectId: result.projectId, sessionId: result.sessionId, stream }
  } catch (err) {
    // The images exist and were paid for; hand them back and say they were not recorded.
    recordError = (err as Error)?.message || 'unknown error'
    console.warn('[mcp/generate_asset] recording failed', recordError)
  }

  return {
    generationId,
    modelId,
    effectiveModelId,
    provider,
    isFallback,
    routeReason,
    outputs: persisted.map((p, idx) => ({
      url: p.url,
      width: p.width,
      height: p.height,
      mimeType: p.mimeType,
      outputId: outputIds[idx] ?? null,
      previewUrl: p.previewUrl,
      filename: previewFilename(modelId, generationId, idx),
    })),
    previewSources: persisted.map((p) => p.previewSource),
    durationMs: Date.now() - startedAt,
    estimatedCostUsd,
    recorded,
    recordError,
    progressTrail: progress?.appendToSummary('')?.trim() || null,
  }
}

function describeRecording(exec: Pick<GenerateAssetExecution, 'recorded' | 'recordError'>): string {
  if (exec.recorded) {
    return `Saved in Vesper under Claude / ${STREAM_SESSIONS[exec.recorded.stream].name}.`
  }
  if (exec.recordError) return `Not recorded in Vesper's web app (${exec.recordError}); the files are safe at the links.`
  return ''
}

export function generateAssetSummary(exec: GenerateAssetExecution): string {
  const n = exec.outputs.length
  const dims = exec.outputs.map((o) => `${o.width}x${o.height}`).join(', ')
  const links =
    n === 1
      ? `Full resolution: ${exec.outputs[0].url}`
      : `Full resolution:\n${exec.outputs.map((o, i) => `${i + 1}. ${o.url}`).join('\n')}`
  const lines = [`Generated ${n} image${n === 1 ? '' : 's'} with ${exec.modelId} (${dims}). ${links}`]
  if (exec.isFallback && exec.provider) {
    lines.push(
      `Note: routed via ${exec.provider} fallback${exec.routeReason ? ` (${exec.routeReason})` : ''}. Pass allowFallback: false to require the primary provider.`
    )
  }
  const recording = describeRecording(exec)
  if (recording) lines.push(recording)
  if (exec.progressTrail) lines.push(exec.progressTrail)
  return lines.join('\n')
}

export function generateAssetStructured(exec: GenerateAssetExecution): Record<string, unknown> {
  return {
    modelId: exec.modelId,
    requestedModelId: exec.modelId,
    effectiveModelId: exec.effectiveModelId,
    provider: exec.provider,
    isFallback: exec.isFallback,
    routeReason: exec.routeReason,
    generationId: exec.generationId,
    status: 'completed',
    outputs: exec.outputs,
    durationMs: exec.durationMs,
    estimatedCostUsd: exec.estimatedCostUsd,
    recorded: exec.recorded,
  }
}

/** What the job row keeps: structured data and output ids, never bytes. */
export function generateAssetPayload(exec: GenerateAssetExecution): JobPayload {
  return {
    summary: generateAssetSummary(exec),
    structuredContent: generateAssetStructured(exec),
    outputIds: exec.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string'),
    costUsd: exec.estimatedCostUsd,
  }
}

const PREVIEW_NOTE =
  'The images below are JPEG previews (long edge at most 1568 px) for reading; open the links for the originals.'

/**
 * The lines a reply carries so the person sees the pictures. claude.ai draws a picture only when the
 * assistant's own text holds it as a markdown image; a picture inside the tool result stays folded
 * behind the "used the tool" line, whatever it is annotated with (tested 2026-09-24). The small
 * preview is what goes in the reply; the original stays behind its link.
 */
/** `<model>-<draw>-<n>-preview.jpg`: one name per picture that reads as the draw in a folder. */
export function previewFilename(modelId: string, generationId: string, idx: number): string {
  const model = modelId.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'draw'
  return `${model}-${generationId.slice(0, 8)}-${idx + 1}-preview.jpg`
}

/**
 * Where files can be written (Cowork with a folder connected, Claude Code), the previews saved
 * there show as file cards with a preview panel in the desktop app, and open in full in Claude
 * Code. That is the only way a picture shows large beside the conversation; a picture in a tool
 * result never does, and a picture in the reply is a click-to-load frame. Vesper cannot write to
 * anyone's disk, so it names the files and Claude saves them.
 */
export function saveToFolderText(
  outputs: Array<{ url: string; previewUrl?: string | null; filename?: string }>,
  modelId: string
): string {
  const day = new Date().toISOString().slice(0, 10)
  const names = outputs.map((out, idx) => out.filename ?? `${modelId}-${idx + 1}-preview.jpg`)
  const one = outputs.length === 1
  return [
    `Where a folder is connected (Cowork, Claude Code): save ${one ? 'the preview' : 'each preview'} into it as vesper/${day}/<name>, then open ${one ? 'it' : 'them'}; the app shows ${one ? 'it' : 'them'} as ${one ? 'a file card' : 'file cards'} with a preview. ${one ? 'Name' : 'Names'}, in order: ${names.join(', ')}. Save the preview URL${one ? '' : 's'} above as ${one ? 'it is' : 'they are'} (no re-encoding); the full-resolution link${one ? '' : 's'} stay${one ? 's' : ''} in the manifest line beside ${one ? 'it' : 'them'}.`,
  ].join('
')
}

export function showInReplyLines(
  outputs: Array<{ url: string; previewUrl?: string | null }>,
  modelId: string
): string[] {
  return outputs.map((out, idx) => `![Image ${idx + 1} from ${modelId}](${out.previewUrl ?? out.url})`)
}

export function showInReplyText(outputs: Array<{ url: string; previewUrl?: string | null }>, modelId: string): string {
  const n = outputs.length
  return [
    n === 1
      ? 'To show the person the picture, put this line in your reply exactly as it is (claude.ai draws it there and nowhere else):'
      : 'To show the person the pictures, put these lines in your reply exactly as they are (claude.ai draws them there and nowhere else):',
    ...showInReplyLines(outputs, modelId),
    saveToFolderText(outputs, modelId),
  ].join('\n')
}

/**
 * Build the MCP content for image results: the summary, the lines a reply shows the pictures with,
 * then for each image a link to the original and, when `inline`, a preview Claude can read.
 */
export async function imageResultContent(input: {
  summary: string
  outputs: Array<{ url: string; width: number; height: number; mimeType: string; previewUrl?: string | null; filename?: string }>
  modelId: string
  previewSources?: string[]
  inline: boolean
}): Promise<McpContent[]> {
  const content: McpContent[] = [{ type: 'text', text: input.summary }]
  const n = input.outputs.length
  const mode = imageAudienceMode()
  if (n > 0) content.push({ type: 'text', text: showInReplyText(input.outputs, input.modelId) })
  input.outputs.forEach((out, idx) => {
    content.push({
      type: 'resource_link',
      uri: out.url,
      name: `${input.modelId}-${out.width}x${out.height}-${idx}.${extensionForMime(out.mimeType)}`,
      mimeType: out.mimeType,
      description: `Image ${idx + 1} of ${n} from ${input.modelId}, full resolution`,
      annotations: linkAudience(mode),
    })
  })
  if (!input.inline || n === 0) return content

  const previews = await Promise.all(
    input.outputs.map(async (out, idx) => {
      try {
        if (out.previewUrl) {
          // Already the small JPEG; no second resize.
          const { buffer } = await readImageBytes(out.previewUrl)
          return { data: buffer.toString('base64'), mimeType: 'image/jpeg' }
        }
        const { buffer } = await readImageBytes(input.previewSources?.[idx] ?? out.url)
        return await makeImagePreview(buffer)
      } catch (err) {
        console.warn('[mcp] preview failed', (err as Error)?.message)
        return null
      }
    })
  )
  content.push({ type: 'text', text: PREVIEW_NOTE })
  previews.forEach((preview, idx) => {
    if (!preview) {
      content.push({ type: 'text', text: `No preview for image ${idx + 1}; use its link.` })
      return
    }
    content.push(...imageBlocks(preview.data, preview.mimeType, mode))
  })
  return content
}
