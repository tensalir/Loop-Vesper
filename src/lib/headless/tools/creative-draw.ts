/**
 * `generate_product_image`: a Loop product drawn from Claude the way the product's own scripts
 * draw it. The references are the kit's (the product render first), the prompt is the product's
 * skeleton filled by code, one model call per image, and every draw is recorded in the caller's
 * project "Claude" with the full prompt and the references in order (`src/lib/creative/draw.ts`).
 *
 * The arguments are strict: there is no reference parameter, and naming one is refused, because
 * a draw is never the next draw's reference.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getCreativeKit } from '@/lib/creative/kit-runtime'
import { kitHeader } from '@/lib/creative/tool-views'
import { resolveProduct } from '@/lib/creative/products'
import { prismaPinStore } from '@/lib/creative/pins-runtime'
import { executeDraws, manifestLine, planDraw, type DrawPlan } from '@/lib/creative/draw'
import {
  anchorUrl,
  drawPriceUsd,
  imageSize,
  laneEstimateUsd,
  prepareDrawOne,
  storeDrawn,
  vesperModelId,
} from '@/lib/creative/work-runtime'
import { recordMcpGeneration, STREAM_SESSIONS, type McpStream } from '../record-generation'
import { imageResultContent } from '../generate-asset'
import type { JobPayload } from '../jobs'
import { runLongCall } from './long-call'
import { ownerIsAdmin } from './creative-read'
import { assertModelAllowed, invalidArguments, type ToolContext, type ToolHandler } from './types'

const STREAMS: Record<string, McpStream> = { eclipse: 'eclipse', packaging: 'packaging', cmf: 'cmf' }

export const GenerateProductImageArgs = z
  .object({
    product: z.string().min(1).max(80),
    colourway: z.string().max(40).optional(),
    view: z.string().max(40).optional(),
    scene: z.string().min(3).max(600),
    light: z.string().min(3).max(300),
    format: z.string().max(60).optional(),
    lane: z.enum(['final', 'second', 'draft']).optional(),
    n: z.number().int().min(1).max(4).optional(),
    aspect: z.string().regex(/^\d{1,2}:\d{1,2}$/).optional(),
    image_size: z.enum(['1K', '2K', '4K']).optional(),
    async: z.boolean().optional().default(false),
  })
  .strict()

const REFERENCE_KEYS = /^(reference|referenceImage|referenceImages|references|image|images|image_url|output_id|init_image|base_image)$/i

export function parseDrawArgs(args: Record<string, unknown>) {
  const parsed = GenerateProductImageArgs.safeParse(args)
  if (parsed.success) return parsed.data
  const extra = Object.keys(args).filter((k) => REFERENCE_KEYS.test(k))
  if (extra.length) {
    throw new Error(
      `generate_product_image takes no reference (${extra.join(', ')}): the product render is attached from the kit, and a draw is never the next draw's reference.`
    )
  }
  throw invalidArguments(parsed.error.issues)
}

interface DrawExecution {
  header: ReturnType<typeof kitHeader>
  plan: DrawPlan
  generationId: string
  outputs: Array<{ url: string; width: number; height: number; mimeType: string; outputId: string | null }>
  previewSources: string[]
  manifest: Record<string, unknown>[]
  failures: string[]
  skipped: string[]
  recorded: { projectId: string; sessionId: string; stream: McpStream } | null
  recordError: string | null
  costUsd: number | null
  durationMs: number
}

function summary(x: DrawExecution): string {
  const p = x.plan
  const lines = [
    `Drew ${x.outputs.length} ${p.product} image${x.outputs.length === 1 ? '' : 's'}: ${p.colourway}, ${p.view}, ${p.model_name} (${p.model}, the ${p.lane} lane), ${p.aspect} at ${p.image_size}.`,
    `References, in binding order: ${p.references.map((r) => `${r.n}. ${r.title ?? r.pin_id} (${r.role})`).join('; ')}.`,
    `Prompt: skeleton ${p.skeleton_version ?? '?'} filled by code (sha256 ${p.prompt_sha256.slice(0, 12)}), not rewritten.`,
  ]
  if (p.left_out.length || x.skipped.length) lines.push(`Left out: ${[...p.left_out, ...x.skipped].join('; ')}.`)
  if (x.failures.length) lines.push(`Not drawn: ${x.failures.join('; ')}.`)
  lines.push(
    x.recorded
      ? `Saved in Vesper under Claude / ${STREAM_SESSIONS[x.recorded.stream].name}.`
      : `Not recorded in Vesper's web app (${x.recordError ?? 'unknown'}); the files are safe at the links.`
  )
  lines.push(`Next: grade each draw with grade_image (output_id), before anyone reads it as right. Creative kit ${x.header.kit_version}${x.header.kit_stale ? ' (stale)' : ''}.`)
  x.outputs.forEach((o, i) => lines.push(`${i + 1}. output ${o.outputId ?? '(not recorded)'}: ${o.url}`))
  return lines.join('\n')
}

function structured(x: DrawExecution): Record<string, unknown> {
  const p = x.plan
  return {
    ...x.header,
    product: p.product,
    colourway: p.colourway,
    view: p.view,
    lane: p.lane,
    modelId: p.model,
    model: p.model,
    skeleton_version: p.skeleton_version,
    prompt: p.prompt,
    prompt_sha256: p.prompt_sha256,
    references: p.references.map((r) => ({ n: r.n, pin_id: r.pin_id, title: r.title, role: r.role, sha256: r.sha256 })),
    left_out: [...p.left_out, ...x.skipped],
    generationId: x.generationId,
    outputs: x.outputs,
    manifest: x.manifest,
    failures: x.failures,
    recorded: x.recorded,
    estimatedCostUsd: x.costUsd,
    durationMs: x.durationMs,
    next: 'grade_image',
  }
}

function payload(x: DrawExecution): JobPayload {
  return {
    summary: summary(x),
    structuredContent: structured(x),
    outputIds: x.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string'),
    costUsd: x.costUsd,
  }
}

async function execute(ctx: ToolContext, plan: DrawPlan, header: DrawExecution['header'], inlineLimit: number, jobId: string | null): Promise<DrawExecution> {
  const started = Date.now()
  const { drawOne, skipped } = await prepareDrawOne(plan, ctx.env, inlineLimit)
  const { images, failures } = await executeDraws(plan, { drawOne })
  const generationId = randomUUID()
  const stored = await Promise.all(
    images.map(async (img) => {
      const ext = img.mimeType === 'image/jpeg' ? 'jpg' : img.mimeType === 'image/webp' ? 'webp' : 'png'
      const url = await storeDrawn(img.bytes, img.mimeType, `mcp/${ctx.principal.credentialId}/${generationId}/${img.index - 1}.${ext}`)
      const size = await imageSize(img.bytes)
      return { img, url, ...size }
    })
  )
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const manifest = stored.map((s) =>
    manifestLine(plan, { index: s.img.index, file: s.url, model: s.img.model, settings: s.img.settings, timestamp })
  )
  const perImage = drawPriceUsd(plan.model, plan.image_size)
  const costUsd = perImage === null ? null : perImage * stored.length
  const render = plan.references[0]
  const renderUrl = render?.row.storagePath ? await anchorUrl(render.row.storagePath, ctx.env).catch(() => null) : null

  const stream = STREAMS[plan.product] ?? 'free'
  let outputIds: Array<string | null> = stored.map(() => null)
  let recorded: DrawExecution['recorded'] = null
  let recordError: string | null = null
  try {
    const result = await recordMcpGeneration({
      ownerId: ctx.principal.ownerId,
      generationId,
      stream,
      modelId: vesperModelId(plan.model),
      prompt: plan.prompt,
      costUsd,
      outputs: stored.map((s) => ({ url: s.url, width: s.width || null, height: s.height || null })),
      parameters: {
        toolName: 'generate_product_image',
        source: 'mcp',
        credentialId: ctx.principal.credentialId,
        mcpJobId: jobId,
        creative: {
          product: plan.product,
          colourway: plan.colourway,
          view: plan.view,
          lane: plan.lane,
          model: plan.model,
          kit_version: header.kit_version,
          kit_tag: header.kit_tag,
          kit_commit: header.kit_commit,
          skeleton_version: plan.skeleton_version,
          prompt_sha256: plan.prompt_sha256,
          references: plan.references.map((r) => ({ pin_id: r.pin_id, title: r.title, role: r.role, sha256: r.sha256 })),
          colourway_source: 'prompt',
        },
        manifest,
        aspectRatio: plan.aspect,
        imageSize: plan.image_size,
        numOutputs: stored.length,
        ...(render && renderUrl ? { anchor: { kind: 'product-render', id: render.pin_id, url: renderUrl, sha256: render.sha256 } } : {}),
        estimatedCostUsd: costUsd,
      },
    })
    outputIds = result.outputIds
    recorded = { projectId: result.projectId, sessionId: result.sessionId, stream }
  } catch (err) {
    recordError = (err as Error)?.message || 'unknown error'
  }
  return {
    header,
    plan,
    generationId,
    outputs: stored.map((s, i) => ({ url: s.url, width: s.width, height: s.height, mimeType: s.img.mimeType, outputId: outputIds[i] ?? null })),
    previewSources: stored.map((s) => `data:${s.img.mimeType};base64,${s.img.bytes.toString('base64')}`),
    manifest,
    failures,
    skipped,
    recorded,
    recordError,
    costUsd,
    durationMs: Date.now() - started,
  }
}

export const generateProductImageHandler: ToolHandler = {
  estimateCostUsd(args) {
    const lane = typeof args.lane === 'string' ? (args.lane as 'final' | 'second' | 'draft') : undefined
    const n = typeof args.n === 'number' ? args.n : 1
    return laneEstimateUsd(lane, n, typeof args.image_size === 'string' ? args.image_size : undefined)
  },
  async run(args, ctx) {
    const a = parseDrawArgs(args)
    const loaded = await getCreativeKit({ env: ctx.env })
    const isAdmin = await ownerIsAdmin(ctx.principal.ownerId)
    const { slug, product } = resolveProduct(loaded.kit, a.product, { isAdmin })
    const rows = await prismaPinStore.list(slug)
    const plan = planDraw(loaded.kit, slug, product, a, rows, { isAdmin })
    assertModelAllowed(ctx.principal.allowedModels, vesperModelId(plan.model))
    const header = kitHeader(loaded)
    const inlineLimit = product.grading?.inline_limit_bytes ?? 3_500_000
    return runLongCall<DrawExecution>({
      ctx,
      toolName: 'generate_product_image',
      modelId: plan.model,
      request: { ...a },
      runAsync: a.async,
      what: `the ${plan.product} draw`,
      execute: (jobId) => execute(ctx, plan, header, inlineLimit, jobId),
      toPayload: payload,
      toWire: async (x) => ({
        content: await imageResultContent({
          summary: summary(x),
          outputs: x.outputs,
          modelId: x.plan.model,
          previewSources: x.previewSources,
          inline: true,
        }),
        structuredContent: structured(x),
      }),
    })
  },
}
