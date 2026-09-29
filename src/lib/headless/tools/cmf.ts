/**
 * CMF files through Claude, from the sheet row and the clown: `cmf_list`, `cmf_prompt`,
 * `cmf_render`, `cmf_check_pdf`. The judgement stays with Damien, the lead CMF designer; the data is
 * code's (Damien's brief: "Use AI for judgement, use code for data").
 *
 *   cmf_list       tabs, SKUs, clown keys, and which tab × column × key has a prompt ready
 *   cmf_prompt     the payload the repository's `prompt_build.py` wrote, verbatim, or its refusal
 *   cmf_render     that payload sent the way `render.py` sends it, after the same refusals
 *   cmf_check_pdf  every value on a CMF PDF against its sheet cell (`spec_diff.py`'s rows)
 *
 * All four need CMF access (the profile's `cmf_access`, or an admin): the registry gates them
 * (`needs: 'cmf'`) and each handler checks again, because a static token carries its tool list as
 * issued. The creative kit supplies everything; Vesper holds no CMF wording or rule of its own.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCreativeKit, readKitFile } from '@/lib/creative/kit-runtime'
import type { LoadedKit } from '@/lib/creative/kit'
import { kitHeader } from '@/lib/creative/tool-views'
import { kitPins, usablePin, type PinRow, type PinSpec } from '@/lib/creative/pins'
import { pinStorage, prismaPinStore } from '@/lib/creative/pins-runtime'
import { pinPart } from '@/lib/creative/pin-parts'
import { drawImage, type GeminiPart } from '@/lib/creative/gemini'
import { anchorUrl, drawPriceUsd, geminiDeps, imageSize, pinPartDeps, storeDrawn, vesperModelId } from '@/lib/creative/work-runtime'
import { fetchAllowlisted } from '@/lib/net/fetch-allowlisted'
import {
  CmfError,
  cmfKit,
  inScopeColumns,
  keysForTab,
  payloadFor,
  payloadId,
  resolveKey,
  resolveTab,
  type CmfGradingParts,
  type CmfKit,
} from '@/lib/creative/cmf/kit-cmf'
import { checkClownBytes, cmfDrawRequest, cmfManifestLine, executeCmfDraws, planCmfRender, type CmfDrawn, type CmfPayload, type CmfRenderPlan } from '@/lib/creative/cmf/render'
import { checkPdfInVesper, checkPdfOnWorker, sha256Hex, specCheckText, type SpecCheckResult } from '@/lib/creative/cmf/check-pdf'
import { workerConfigFromEnv, type WorkerConfig } from '@/lib/creative/cmf/worker-client'
import type { ClownKey, Spec } from '@/lib/creative/cmf/spec-diff'
import { recordMcpGeneration, STREAM_SESSIONS } from '../record-generation'
import { imageResultContent } from '../generate-asset'
import type { JobPayload } from '../jobs'
import { runLongCall } from './long-call'
import { assertModelAllowed, invalidArguments, type ToolContext, type ToolHandler } from './types'

// ------------------------------------------------------------------ what the handlers reach

export interface CmfToolDeps {
  loadKit(env: NodeJS.ProcessEnv): Promise<LoadedKit>
  readKitFile(loaded: LoadedKit, file: { path: string; sha256: string }): Promise<Buffer>
  ownerAccess(ownerId: string): Promise<{ admin: boolean; cmf: boolean }>
  pinRows(product: string): Promise<PinRow[]>
  pinBytes(path: string, env: NodeJS.ProcessEnv): Promise<Buffer | null>
  fetchPdf(url: string): Promise<Buffer>
  /** A CMF packet's exported PDF, when the caller may see the packet. */
  packetPdf(packetId: string, ownerId: string): Promise<{ url: string; name: string | null } | null>
  worker(env: NodeJS.ProcessEnv): WorkerConfig | null
}

export const productionCmfDeps: CmfToolDeps = {
  loadKit: (env) => getCreativeKit({ env }),
  readKitFile: (loaded, file) => readKitFile(loaded, file),
  async ownerAccess(ownerId) {
    const p = await prisma.profile.findUnique({ where: { id: ownerId }, select: { role: true, cmfAccess: true, pausedAt: true, deletedAt: true } })
    if (!p || p.pausedAt || p.deletedAt) return { admin: false, cmf: false }
    const admin = p.role === 'admin'
    return { admin, cmf: admin || p.cmfAccess === true }
  },
  pinRows: (product) => prismaPinStore.list(product),
  pinBytes: (path, env) => pinStorage(env).get(path),
  async fetchPdf(url) {
    const got = await fetchAllowlisted(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000, contentTypes: ['application/pdf', 'application/octet-stream'] })
    return got.buffer
  },
  async packetPdf(packetId, ownerId) {
    // The web app's own rule for who may see a packet; loaded here only, because the module
    // reads the request's cookies at import time.
    const { getPacketRole } = await import('@/lib/cmf/service')
    const role = await getPacketRole(packetId, ownerId)
    if (!role) return null
    const packet = await prisma.cmfPacket.findUnique({ where: { id: packetId }, select: { pdfUrl: true, name: true } })
    if (!packet?.pdfUrl) return null
    return { url: packet.pdfUrl, name: packet.name ?? null }
  },
  worker: (env) => workerConfigFromEnv(env),
}

let deps: CmfToolDeps = productionCmfDeps

/** Tests swap the handlers' reach for fixtures. */
export function setCmfToolDeps(next: Partial<CmfToolDeps> | null): void {
  deps = next ? { ...productionCmfDeps, ...next } : productionCmfDeps
}

export class CmfAccessError extends Error {
  constructor() {
    super('CMF files need CMF access on your Vesper profile (an admin turns it on under Users). Nothing was read.')
    this.name = 'CmfAccessError'
  }
}

async function requireCmf(ctx: ToolContext): Promise<{ admin: boolean }> {
  const access = await deps.ownerAccess(ctx.principal.ownerId)
  if (!access.cmf) throw new CmfAccessError()
  return { admin: access.admin }
}

/** Throws when the caller has no CMF access; exported for grade_image's CMF path. */
export async function assertCmfAccess(ownerId: string): Promise<void> {
  const access = await deps.ownerAccess(ownerId)
  if (!access.cmf) throw new CmfAccessError()
}

async function loadCmf(ctx: ToolContext): Promise<{ loaded: LoadedKit; cmf: CmfKit }> {
  const loaded = await deps.loadKit(ctx.env)
  return { loaded, cmf: cmfKit(loaded.kit) }
}

const parsedParts = new Map<string, CmfGradingParts>()

/** `kit/cmf-grading.json` at the kit's commit, checked by sha256; kept per sha. */
export async function cmfGradingParts(loaded: LoadedKit, cmf: CmfKit, read: CmfToolDeps['readKitFile'] = deps.readKitFile): Promise<CmfGradingParts> {
  const file = cmf.product.grading_prompt?.parts_file
  if (!file) throw new CmfError(`the creative kit ${loaded.kit.version} carries no CMF grading parts`)
  const hit = parsedParts.get(file.sha256)
  if (hit) return hit
  const parts = JSON.parse((await read(loaded, file)).toString('utf8')) as CmfGradingParts
  parsedParts.set(file.sha256, parts)
  return parts
}

// ------------------------------------------------------------------ cmf_list

export const CmfListArgs = z.object({ tab: z.string().min(1).max(80).optional() }).strict()

export const cmfListHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = CmfListArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    await requireCmf(ctx)
    const { loaded, cmf } = await loadCmf(ctx)
    const parts = await cmfGradingParts(loaded, cmf)
    const tabs = parsed.data.tab ? [resolveTab(cmf, parsed.data.tab)] : Object.entries(cmf.specs).map(([slug, spec]) => ({ slug, spec }))
    const out = []
    const lines: string[] = [
      `CMF in creative kit ${loaded.kit.version}: rubric ${cmf.product.rubric.version ?? '?'}${cmf.product.rubric.reporting_only ? ' (reporting only)' : ''}. Damien decides every render and every PDF.`,
    ]
    for (const { slug, spec } of tabs) {
      const keys = keysForTab(cmf, spec).map(([id, k]) => ({ id, clown: k.clown?.id ?? null, draft: k.draft, confirmed: k.confirmed }))
      const payloads = Object.entries(cmf.payloads)
        .filter(([, p]) => p.spec === slug)
        .map(([id, p]) => ({ id, column: p.column, sku_name: p.sku_name, key: p.key, status: p.status, key_confirmed: p.key_confirmed ?? null, reasons: p.reasons ?? [] }))
      let skus: Array<{ column: string; header?: string | null; name?: string | null; in_scope: boolean; scope_reason?: string | null }> = inScopeColumns(parts, slug).map((c) => ({
        column: c.column,
        name: c.sku_name,
        in_scope: true,
      }))
      if (parsed.data.tab) {
        const specJson = JSON.parse((await deps.readKitFile(loaded, spec)).toString('utf8')) as Spec
        skus = specJson.skus.map((s) => ({ column: s.column, header: s.header ?? null, name: s.name ?? null, in_scope: s.in_scope === true, scope_reason: (s.scope_reason as string | undefined) ?? null }))
      }
      out.push({ tab: spec.tab, slug, vesper_product: spec.vesper_product, skus, keys, payloads })
      const ready = payloads.filter((p) => p.status === 'ready')
      lines.push(
        `- ${spec.tab} (${slug}): in scope ${skus.filter((s) => s.in_scope).map((s) => `${s.column}${s.name ? ` ${s.name}` : ''}`).join(', ') || 'none'}; ` +
          `keys ${keys.map((k) => `${k.id}${k.draft ? ' (draft)' : k.confirmed ? ' (confirmed)' : ' (named, not confirmed)'}`).join(', ') || 'none'}; ` +
          `prompts ready ${ready.map((p) => `${p.column} through ${p.key}`).join(', ') || 'none'}` +
          (payloads.some((p) => p.status !== 'ready') ? `; refused ${payloads.filter((p) => p.status !== 'ready').map((p) => `${p.column} (${p.reasons[0] ?? 'refused'})`).join('; ')}` : '')
      )
    }
    lines.push('A draft key cannot make a prompt: Damien names its zones first. cmf_prompt shows a ready prompt; cmf_render draws it.')
    return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: { ...kitHeader(loaded), tabs: out } }
  },
}

// ------------------------------------------------------------------ cmf_prompt

export const CmfTargetArgs = {
  tab: z.string().min(1).max(80),
  column: z.string().regex(/^[A-Za-z]{1,2}$/, 'a column letter'),
  clown: z.string().min(1).max(120),
}

export const CmfPromptArgs = z.object(CmfTargetArgs).strict()

async function readPayload(loaded: LoadedKit, cmf: CmfKit, tab: string, column: string, clown: string) {
  const { slug, spec } = resolveTab(cmf, tab)
  resolveKey(cmf, spec, clown)
  const entry = payloadFor(cmf, slug, column.toUpperCase(), clown)
  if (entry.status !== 'ready' || !entry.path || !entry.sha256) return { slug, spec, entry, payload: null as CmfPayload | null, bytes: null as Buffer | null }
  const bytes = await deps.readKitFile(loaded, { path: entry.path, sha256: entry.sha256 })
  return { slug, spec, entry, payload: JSON.parse(bytes.toString('utf8')) as CmfPayload, bytes }
}

export const cmfPromptHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = CmfPromptArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    await requireCmf(ctx)
    const a = parsed.data
    const { loaded, cmf } = await loadCmf(ctx)
    const { entry, payload } = await readPayload(loaded, cmf, a.tab, a.column, a.clown)
    const header = kitHeader(loaded)
    if (!payload) {
      const reasons = entry.reasons ?? []
      return {
        content: [
          {
            type: 'text',
            text: [`No prompt for ${entry.tab} column ${entry.column} through ${entry.key}: prompt_build.py refused it.`, ...reasons.map((r) => `- ${r}`), 'Nothing is sent until the row or the key is fixed.'].join('\n'),
          },
        ],
        structuredContent: { ...header, refused: true, tab: entry.tab, column: entry.column, key: entry.key, reasons },
      }
    }
    const lines = (payload.lines ?? []) as Array<Record<string, unknown>>
    const table = [
      '| # | Zone | Component | Material | Finish | Colour | Code |',
      '|---|---|---|---|---|---|---|',
      ...lines.map((l) => `| ${l.n ?? ''} | ${l.zone_hex ?? ''} | ${l.component ?? ''} | ${l.material ?? ''} | ${l.finish ?? ''} | ${l.colour_name ?? ''} | ${l.colour_code ?? ''} |`),
    ]
    const text = [
      `Damien's template, filled by code from ${payload.tab} column ${payload.column}${payload.sku_name ? ` (${payload.sku_name})` : ''} through the clown key ${payload.key.id}${payload.key_confirmed ? '' : ' (named, not yet confirmed by Damien)'}. Send it exactly as it is:`,
      '',
      payload.prompt,
      '',
      ...table,
      ...(payload.omitted?.length ? ['', `Left out: ${payload.omitted.map((o) => `${o.component} (${o.why})`).join('; ')}.`] : []),
      ...(payload.warnings?.length ? ['', ...payload.warnings.map((w) => `Warning: ${w}`)] : []),
      '',
      `prompt sha256 ${payload.prompt_sha256.slice(0, 12)}; template ${payload.template_sha256.slice(0, 12)}; clown ${payload.clown.id} ${payload.clown.sha256.slice(0, 12)}, ${payload.clown.aspect ?? '?'}. The clown is the only image. cmf_render draws it.`,
    ].join('\n')
    return {
      content: [{ type: 'text', text }],
      structuredContent: {
        ...header,
        refused: false,
        payload_id: payloadId(entry.spec, entry.column, entry.key),
        tab: payload.tab,
        column: payload.column,
        sku_name: payload.sku_name ?? null,
        key: payload.key,
        key_confirmed: payload.key_confirmed === true,
        clown: payload.clown,
        prompt: payload.prompt,
        prompt_sha256: payload.prompt_sha256,
        template_sha256: payload.template_sha256,
        lines: payload.lines ?? [],
        omitted: payload.omitted ?? [],
        warnings: payload.warnings ?? [],
      },
    }
  },
}

// ------------------------------------------------------------------ cmf_render

export const CmfRenderArgs = z
  .object({
    ...CmfTargetArgs,
    lane: z.enum(['final', 'draft']).optional(),
    n: z.number().int().min(1).max(4).optional(),
    image_size: z.enum(['1K', '2K', '4K']).optional(),
    async: z.boolean().optional().default(false),
  })
  .strict()

interface CmfRenderExecution {
  header: ReturnType<typeof kitHeader>
  plan: CmfRenderPlan
  generationId: string
  outputs: Array<{ url: string; width: number; height: number; mimeType: string; outputId: string | null }>
  previewSources: string[]
  manifest: Record<string, unknown>[]
  failures: string[]
  recorded: boolean
  recordError: string | null
  costUsd: number | null
}

function renderSummary(x: CmfRenderExecution): string {
  const p = x.plan
  const lines = [
    `Rendered ${x.outputs.length} CMF image${x.outputs.length === 1 ? '' : 's'}: ${p.tab} column ${p.column}${p.skuName ? ` (${p.skuName})` : ''}, through ${p.key}${p.keyConfirmed ? '' : ' (key named, not confirmed)'}, ${p.model} (${p.lane}), ${p.aspect} at ${p.imageSize}.`,
    `The clown ${p.clown.id} was the only image; the prompt was the payload's, byte for byte (sha256 ${p.promptSha256.slice(0, 12)}), no rewrite, no lighting clause.`,
  ]
  if (x.failures.length) lines.push(`Not rendered: ${x.failures.join('; ')}.`)
  lines.push(x.recorded ? `Saved in Vesper under Claude / ${STREAM_SESSIONS.cmf.name}.` : `Not recorded in Vesper's web app (${x.recordError ?? 'unknown'}); the files are safe at the links.`)
  lines.push('Next: grade each render with grade_image (product cmf, the same tab, column and clown). Damien decides.')
  x.outputs.forEach((o, i) => lines.push(`${i + 1}. output ${o.outputId ?? '(not recorded)'}: ${o.url}`))
  return lines.join('\n')
}

function renderStructured(x: CmfRenderExecution): Record<string, unknown> {
  const p = x.plan
  return {
    ...x.header,
    product: 'cmf',
    payload_id: p.payloadId,
    tab: p.tab,
    column: p.column,
    sku_name: p.skuName,
    key: p.key,
    key_confirmed: p.keyConfirmed,
    clown: p.clown,
    lane: p.lane,
    model: p.model,
    modelId: p.model,
    prompt: p.prompt,
    prompt_sha256: p.promptSha256,
    aspect: p.aspect,
    image_size: p.imageSize,
    generationId: x.generationId,
    outputs: x.outputs,
    manifest: x.manifest,
    failures: x.failures,
    estimatedCostUsd: x.costUsd,
    next: 'grade_image',
  }
}

function renderPayload(x: CmfRenderExecution): JobPayload {
  return {
    summary: renderSummary(x),
    structuredContent: renderStructured(x),
    outputIds: x.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string'),
    costUsd: x.costUsd,
  }
}

/** The clown's pin for a plan, its bytes checked against the payload before anything is paid for. */
async function clownForRender(ctx: ToolContext, loaded: LoadedKit, cmf: CmfKit, plan: CmfRenderPlan): Promise<{ row: PinRow; spec: PinSpec }> {
  const spec = kitPins(loaded.kit).find((s) => s.product === cmf.slug && s.pinId === plan.clown.id && s.sha256 === plan.clown.sha256)
  if (!spec) throw new CmfError(`the clown ${plan.clown.id} with the payload's sha256 is not a pin in the kit: the clown changed; its key must be sampled again`)
  const row = (await deps.pinRows(cmf.slug)).find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256)
  if (!row || !usablePin(row, spec) || !row.storagePath) {
    throw new CmfError(`the clown ${plan.clown.id} is not pinned in Vesper yet (an admin syncs the pins). Nothing was paid for.`)
  }
  const bytes = await deps.pinBytes(row.storagePath, ctx.env)
  if (!bytes) throw new CmfError(`the clown ${plan.clown.id}'s pinned copy could not be read. Nothing was paid for.`)
  checkClownBytes(plan, bytes)
  return { row, spec }
}

async function executeRender(ctx: ToolContext, loaded: LoadedKit, cmf: CmfKit, plan: CmfRenderPlan, clown: { row: PinRow; spec: PinSpec }, jobId: string | null): Promise<CmfRenderExecution> {
  const header = kitHeader(loaded)
  const inlineLimit = cmf.product.grading?.inline_limit_bytes ?? 3_500_000
  const part: GeminiPart = await pinPart(clown.row, clown.spec, pinPartDeps(ctx.env, inlineLimit))
  const gem = geminiDeps(ctx.env)
  const { images, failures } = await executeCmfDraws(plan, async (_index, deadline) => {
    const img = await drawImage(gem, { ...cmfDrawRequest(plan, part), deadline })
    return { ...img, model: plan.model, settings: { aspectRatio: plan.aspect, imageSize: plan.imageSize } } as Omit<CmfDrawn, 'index'>
  })
  const generationId = randomUUID()
  const stored = await Promise.all(
    images.map(async (img) => {
      const ext = img.mimeType === 'image/jpeg' ? 'jpg' : img.mimeType === 'image/webp' ? 'webp' : 'png'
      const url = await storeDrawn(img.bytes, img.mimeType, `mcp/${ctx.principal.credentialId}/${generationId}/${img.index - 1}.${ext}`)
      return { img, url, ...(await imageSize(img.bytes)) }
    })
  )
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const manifest = stored.map((s) => cmfManifestLine(plan, { index: s.img.index, file: s.url, model: s.img.model, settings: s.img.settings, timestamp }))
  const perImage = drawPriceUsd(plan.model, plan.imageSize)
  const costUsd = perImage === null ? null : perImage * stored.length
  const clownUrl = clown.row.storagePath ? await anchorUrl(clown.row.storagePath, ctx.env).catch(() => null) : null
  let outputIds: Array<string | null> = stored.map(() => null)
  let recorded = false
  let recordError: string | null = null
  try {
    const result = await recordMcpGeneration({
      ownerId: ctx.principal.ownerId,
      generationId,
      stream: 'cmf',
      modelId: vesperModelId(plan.model),
      prompt: plan.prompt,
      costUsd,
      outputs: stored.map((s) => ({ url: s.url, width: s.width || null, height: s.height || null })),
      parameters: {
        toolName: 'cmf_render',
        source: 'mcp',
        credentialId: ctx.principal.credentialId,
        mcpJobId: jobId,
        creative: {
          product: 'cmf',
          tab: plan.tab,
          column: plan.column,
          sku_name: plan.skuName,
          key: plan.key,
          key_confirmed: plan.keyConfirmed,
          lane: plan.lane,
          model: plan.model,
          kit_version: header.kit_version,
          kit_tag: header.kit_tag,
          kit_commit: header.kit_commit,
          payload: { id: plan.payloadId, prompt_sha256: plan.promptSha256, clown: plan.clown },
        },
        manifest,
        aspectRatio: plan.aspect,
        imageSize: plan.imageSize,
        numOutputs: stored.length,
        ...(clownUrl ? { anchor: { kind: 'clown', id: plan.clown.id, url: clownUrl, sha256: plan.clown.sha256 } } : {}),
        estimatedCostUsd: costUsd,
      },
    })
    outputIds = result.outputIds
    recorded = true
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
    recorded,
    recordError,
    costUsd,
  }
}

export const cmfRenderHandler: ToolHandler = {
  estimateCostUsd(args) {
    const n = typeof args.n === 'number' ? args.n : 1
    const model = args.lane === 'draft' ? 'gemini-3.1-flash-image' : 'gemini-3-pro-image'
    return (drawPriceUsd(model, typeof args.image_size === 'string' ? args.image_size : '2K') ?? 0.134) * Math.max(1, n)
  },
  async run(args, ctx) {
    const parsed = CmfRenderArgs.safeParse(args)
    if (!parsed.success) {
      const extra = Object.keys(args).filter((k) => /^(reference|references|image|images|image_url|output_id|prompt)$/i.test(k))
      if (extra.length) throw new Error(`cmf_render takes no ${extra.join(', ')}: the clown is the only image and the prompt is the payload's, byte for byte.`)
      throw invalidArguments(parsed.error.issues)
    }
    await requireCmf(ctx)
    const a = parsed.data
    const { loaded, cmf } = await loadCmf(ctx)
    const { entry, bytes } = await readPayload(loaded, cmf, a.tab, a.column, a.clown)
    if (!bytes) throw new CmfError(`no prompt for ${entry.tab} column ${entry.column} through '${entry.key}': ${(entry.reasons ?? []).join('; ') || 'refused'}`)
    const plan = planCmfRender(cmf, entry, bytes, { lane: a.lane, n: a.n, image_size: a.image_size })
    assertModelAllowed(ctx.principal.allowedModels, vesperModelId(plan.model))
    const clown = await clownForRender(ctx, loaded, cmf, plan)
    return runLongCall<CmfRenderExecution>({
      ctx,
      toolName: 'cmf_render',
      modelId: plan.model,
      request: { ...a },
      runAsync: a.async,
      what: `the ${plan.tab} ${plan.column} render`,
      execute: (jobId) => executeRender(ctx, loaded, cmf, plan, clown, jobId),
      toPayload: renderPayload,
      toWire: async (x) => ({
        content: await imageResultContent({ summary: renderSummary(x), outputs: x.outputs, modelId: x.plan.model, previewSources: x.previewSources, inline: true }),
        structuredContent: renderStructured(x),
      }),
    })
  },
}

// ------------------------------------------------------------------ cmf_check_pdf

export const CmfCheckPdfArgs = z
  .object({
    pdf_url: z.string().url().max(2000).optional(),
    cmf_packet_id: z.string().uuid().optional(),
    tab: z.string().min(1).max(80),
    columns: z.array(z.string().min(1).max(80)).max(20).optional(),
    layout: z.enum(['vesper', 'ours']).optional().default('vesper'),
    clown: z.string().min(1).max(120).optional(),
    engine: z.enum(['vesper', 'worker']).optional().default('vesper'),
  })
  .strict()
  .refine((a) => !!a.pdf_url !== !!a.cmf_packet_id, 'name the PDF by pdf_url or by cmf_packet_id, one of them')

export async function runCmfCheckPdf(ctx: ToolContext, a: z.infer<typeof CmfCheckPdfArgs>): Promise<{ loaded: LoadedKit; result: SpecCheckResult }> {
  const { loaded, cmf } = await loadCmf(ctx)
  const { spec: specEntry } = resolveTab(cmf, a.tab)
  const specBytes = await deps.readKitFile(loaded, specEntry)
  const spec = JSON.parse(specBytes.toString('utf8')) as Spec
  let keyJson: { path: string; sha256: string; content: string } | null = null
  let key: ClownKey | null = null
  if (a.clown) {
    const k = resolveKey(cmf, specEntry, a.clown)
    const kb = await deps.readKitFile(loaded, { path: k.path, sha256: k.sha256 })
    key = JSON.parse(kb.toString('utf8')) as ClownKey
    keyJson = { path: k.path, sha256: k.sha256, content: kb.toString('utf8') }
  }
  let url = a.pdf_url ?? null
  if (a.cmf_packet_id) {
    const packet = await deps.packetPdf(a.cmf_packet_id, ctx.principal.ownerId)
    if (!packet) throw new CmfError('that CMF packet is not one you can see, or it has no exported PDF yet')
    url = packet.url
  }
  const pdf = await deps.fetchPdf(url!)
  if (a.engine === 'worker') {
    const cfg = deps.worker(ctx.env)
    if (!cfg) throw new CmfError('the creative worker is not configured on this Vesper (CREATIVE_WORKER_URL, CREATIVE_WORKER_SECRET); the check runs in Vesper without engine: "worker"')
    const result = await checkPdfOnWorker(cfg, {
      pdfUrl: url!,
      pdfSha256: sha256Hex(pdf),
      spec: { path: specEntry.path, sha256: specEntry.sha256, content: specBytes.toString('utf8') },
      tab: spec.tab,
      columns: a.columns,
      layout: a.layout,
      keyJson,
    })
    return { loaded, result }
  }
  const result = await checkPdfInVesper({ pdf, spec, columns: a.columns, layout: a.layout, key })
  return { loaded, result }
}

export const cmfCheckPdfHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = CmfCheckPdfArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    await requireCmf(ctx)
    const { loaded, result } = await runCmfCheckPdf(ctx, parsed.data)
    return {
      content: [{ type: 'text', text: specCheckText(result) }],
      structuredContent: { ...kitHeader(loaded), ...result, rows: result.rows },
    }
  },
}
