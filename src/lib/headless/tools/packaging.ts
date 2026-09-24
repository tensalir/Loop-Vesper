/**
 * Packaging looks through Claude: `packaging_list_looks`, `packaging_mockup`, `packaging_finish`,
 * and the packaging path of `grade_image` (`executePackagingGrade`).
 *
 *   packaging_list_looks  the looks, boxes, colourways and cells the kit carries, and which of
 *                         their pictures Vesper holds
 *   packaging_mockup      the cell's composite, built by the repository's own mockup code on the
 *                         creative worker: the artwork warped onto the white render's marked
 *                         panels, the render's shading kept. Recorded as the cell's control
 *   packaging_finish      the finishing model, in Vesper, sent exactly what the repository's
 *                         finish.py sends; the draw cut back to the render's frame and only its
 *                         paper grain laid onto the composite (surface.py). A draw that moved is
 *                         reported and not kept
 *
 * All need packaging access (the profile's `packaging_access`, or an admin): the registry gates them
 * and each handler checks again. Geometry, artwork, type and colour are code's; the model adds
 * paper, light, shadow and gloss. The head of design decides, and is not named yet.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCreativeKit, readKitFile } from '@/lib/creative/kit-runtime'
import type { LoadedKit } from '@/lib/creative/kit'
import { kitHeader } from '@/lib/creative/tool-views'
import { kitPins, usablePin, type PinRow } from '@/lib/creative/pins'
import { pinBucket, prismaPinStore } from '@/lib/creative/pins-runtime'
import { pinPart } from '@/lib/creative/pin-parts'
import { anchorUrl, candidatePartFor, drawPriceUsd, GENERATED_BUCKET, GRADE_READ_USD, gradeReader, pinPartDeps, productionCandidateDeps, vesperModelId } from '@/lib/creative/work-runtime'
import { loadCandidate, type LoadedCandidate } from '@/lib/creative/candidate'
import { prismaCreativeRecords } from '@/lib/creative/records'
import { callWorker, workerConfigFromEnv, workerHealth } from '@/lib/creative/cmf/worker-client'
import {
  allCells,
  cellKey,
  dielineFile,
  gradePlanFor,
  packagingKit,
  PackagingError,
  renderPin,
  resolveCell,
  type Cell,
  type PackagingKit,
} from '@/lib/creative/packaging/kit-packaging'
import {
  finishManifestLine,
  LANES,
  planMockup,
  runFinish,
  runMockup,
  workerFrom,
  type DrawCall,
  type FlowDeps,
  type FlowStorage,
  type FlowWorker,
  type MockupResult,
  type RecordedComposite,
  type FinishResult,
  type PackagingLane,
} from '@/lib/creative/packaging/flow'
import { gradePackagingCandidate, requireComposite, type CellComposite, type PackagingGradeOutcome } from '@/lib/creative/packaging/grading'
import { packagingDraw, supabaseFlowStorage } from '@/lib/creative/packaging/runtime'
import { recordMcpGeneration, STREAM_SESSIONS, type RecordMcpGenerationInput, type RecordMcpGenerationResult } from '../record-generation'
import { imageResultContent } from '../generate-asset'
import type { JobPayload } from '../jobs'
import { runLongCall } from './long-call'
import { assertModelAllowed, invalidArguments, type ToolContext, type ToolHandler } from './types'

// ------------------------------------------------------------------ what the handlers reach

export interface PackagingToolDeps {
  loadKit(env: NodeJS.ProcessEnv): Promise<LoadedKit>
  readKitFile(loaded: LoadedKit, file: { path: string; sha256: string }): Promise<Buffer>
  ownerAccess(ownerId: string): Promise<{ admin: boolean; packaging: boolean }>
  pinRows(product: string): Promise<PinRow[]>
  storage(env: NodeJS.ProcessEnv): FlowStorage
  worker(env: NodeJS.ProcessEnv): FlowWorker | null
  draw(env: NodeJS.ProcessEnv, inlineLimit: number): (call: DrawCall) => Promise<{ bytes: Buffer; mimeType: string }>
  buckets(env: NodeJS.ProcessEnv): { pins: string; outputs: string }
  /** The caller's newest recorded mockup of a cell, or the one named by output id. */
  findComposite(ownerId: string, cell: string, outputId?: string): Promise<RecordedComposite | null>
  /** An own output's generation parameters, when the owner may read it. */
  outputParameters(outputId: string, ownerId: string): Promise<Record<string, unknown> | null>
  record(input: RecordMcpGenerationInput): Promise<RecordMcpGenerationResult>
  anchorUrl(path: string, env: NodeJS.ProcessEnv): Promise<string | null>
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** A recorded mockup, read back from its generation's parameters. */
export function compositeFromParameters(generationId: string, output: { id: string; fileUrl: string }, parameters: unknown): RecordedComposite | null {
  const c = obj(obj(parameters).creative)
  const comp = obj(c.composite)
  const mask = obj(c.mask)
  const sha = str(comp.sha256)
  if (!sha || !str(mask.path) || !str(mask.bucket) || !str(mask.sha256)) return null
  const target = str(obj(comp.target).bucket) && str(obj(comp.target).path) ? { bucket: String(obj(comp.target).bucket), path: String(obj(comp.target).path) } : null
  const inputs = obj(c.inputs)
  return {
    outputId: output.id,
    generationId,
    url: output.fileUrl,
    sha256: sha,
    target,
    mask: { bucket: String(mask.bucket), path: String(mask.path), sha256: String(mask.sha256) },
    inputs: {
      render: str(inputs.render) ?? undefined,
      dieline: str(inputs.dieline) ?? undefined,
      dieline_json: str(inputs.dieline_json) ?? undefined,
      panels_json: str(inputs.panels_json) ?? undefined,
    },
  }
}

export const productionPackagingDeps: PackagingToolDeps = {
  loadKit: (env) => getCreativeKit({ env }),
  readKitFile: (loaded, file) => readKitFile(loaded, file),
  async ownerAccess(ownerId) {
    const p = await prisma.profile.findUnique({ where: { id: ownerId }, select: { role: true, packagingAccess: true, pausedAt: true, deletedAt: true } })
    if (!p || p.pausedAt || p.deletedAt) return { admin: false, packaging: false }
    const admin = p.role === 'admin'
    return { admin, packaging: admin || p.packagingAccess === true }
  },
  pinRows: (product) => prismaPinStore.list(product),
  storage: (env) => supabaseFlowStorage(env),
  worker(env) {
    const cfg = workerConfigFromEnv(env)
    return cfg ? workerFrom(cfg, (c, route, body) => callWorker(c, route, body), (c) => workerHealth(c)) : null
  },
  draw: (env, inlineLimit) => packagingDraw(env, inlineLimit),
  buckets: (env) => ({ pins: pinBucket(env), outputs: GENERATED_BUCKET }),
  async findComposite(ownerId, cell, outputId) {
    const g = await prisma.generation.findFirst({
      where: {
        userId: ownerId,
        AND: [{ parameters: { path: ['toolName'], equals: 'packaging_mockup' } }, { parameters: { path: ['creative', 'cell'], equals: cell } }],
        ...(outputId ? { outputs: { some: { id: outputId } } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, parameters: true, outputs: { select: { id: true, fileUrl: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
    })
    if (!g || !g.outputs[0]) return null
    return compositeFromParameters(g.id, g.outputs[0], g.parameters)
  },
  async outputParameters(outputId, ownerId) {
    const row = await prisma.output.findUnique({ where: { id: outputId }, select: { generation: { select: { userId: true, parameters: true } } } })
    if (!row || row.generation.userId !== ownerId) return null
    return obj(row.generation.parameters)
  },
  record: (input) => recordMcpGeneration(input),
  anchorUrl: (path, env) => anchorUrl(path, env),
}

let deps: PackagingToolDeps = productionPackagingDeps

/** Tests swap the handlers' reach for fixtures. */
export function setPackagingToolDeps(next: Partial<PackagingToolDeps> | null): void {
  deps = next ? { ...productionPackagingDeps, ...next } : productionPackagingDeps
}

export class PackagingAccessError extends Error {
  constructor() {
    super('Packaging looks need packaging access on your Vesper profile (an admin turns it on under Users). Nothing was read.')
    this.name = 'PackagingAccessError'
  }
}

/** Throws when the caller has no packaging access; exported for grade_image's packaging path. */
export async function assertPackagingAccess(ownerId: string): Promise<void> {
  const access = await deps.ownerAccess(ownerId)
  if (!access.packaging) throw new PackagingAccessError()
}

const NO_WORKER =
  'the creative worker is not configured on this Vesper (CREATIVE_WORKER_URL, CREATIVE_WORKER_SECRET): the mockup and the finishing steps are the repository\'s own code, run there. Nothing was made.'

function requireWorker(env: NodeJS.ProcessEnv): FlowWorker {
  const w = deps.worker(env)
  if (!w) throw new PackagingError(NO_WORKER)
  return w
}

const DECIDER_NOTE = 'The head of design decides, and is not named yet: no answer counts as a decider\'s verdict until they are.'

/** Who decides, from the kit: the named decider, or the note that nobody is named yet. */
export function deciderNote(pk: PackagingKit): string {
  const d = (pk.product.deciders?.[0] ?? {}) as { role?: string; name?: string | null }
  return d.name ? `${d.name}, the ${d.role ?? 'decider'}, decides.` : DECIDER_NOTE
}

function flowDeps(ctx: ToolContext, loaded: LoadedKit, pk: PackagingKit, rows: PinRow[], worker: FlowWorker): FlowDeps {
  const inlineLimit = pk.product.grading?.inline_limit_bytes ?? 3_500_000
  const b = deps.buckets(ctx.env)
  return {
    storage: deps.storage(ctx.env),
    worker,
    readKitFile: (file) => deps.readKitFile(loaded, file),
    pinRows: rows,
    pinsBucket: b.pins,
    outputsBucket: b.outputs,
    draw: deps.draw(ctx.env, inlineLimit),
  }
}

const CellArgs = {
  look: z.string().min(1).max(40).optional(),
  box: z.string().min(1).max(40).optional(),
  colourway: z.string().min(1).max(40).optional(),
}

function refuseExtras(tool: string, args: Record<string, unknown>): void {
  const extra = Object.keys(args).filter((k) => /^(reference|references|image|images|image_url|prompt|scene|light|model)$/i.test(k))
  if (extra.length) {
    throw new PackagingError(`${tool} takes no ${extra.join(', ')}: the pictures come from the kit's pins and the prompt is the finishing skeleton, byte for byte.`)
  }
}

// ------------------------------------------------------------------ packaging_list_looks

export const PackagingListLooksArgs = z.object({ look: z.string().min(1).max(40).optional() }).strict()

export const packagingListLooksHandler: ToolHandler = {
  async run(args, ctx) {
    const parsed = PackagingListLooksArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    const access = await deps.ownerAccess(ctx.principal.ownerId)
    if (!access.packaging) throw new PackagingAccessError()
    const loaded = await deps.loadKit(ctx.env)
    const pk = packagingKit(loaded.kit)
    const rows = await deps.pinRows(pk.slug)
    const specs = new Map(kitPins(loaded.kit).filter((s) => s.product === pk.slug).map((s) => [s.pinId, s]))
    const held = (pinId: string | null) => {
      if (!pinId) return false
      const spec = specs.get(pinId)
      const row = spec ? rows.find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256) : undefined
      return !!spec && usablePin(row, spec)
    }
    const cells = allCells(pk).filter((c) => !parsed.data.look || c.look.toLowerCase() === parsed.data.look.toLowerCase())
    if (parsed.data.look && !cells.length) throw new PackagingError(`no look '${parsed.data.look}'; the kit has ${Object.keys(pk.looks).join(', ')}`)
    const out = await Promise.all(
      cells.map(async (cell) => {
        const plan = gradePlanFor(pk, cell)
        const pictures = plan.map((e) => ({ role: e.role, pin: e.pin, held: e.pin === null ? null : held(e.pin) }))
        const mockup = await deps.findComposite(ctx.principal.ownerId, cellKey(cell)).catch(() => null)
        return {
          cell: cellKey(cell),
          ...cell,
          colourway_words: pk.looks[cell.look]?.colourways[cell.colourway] ?? null,
          render: renderPin(pk, cell.box).id,
          dieline_file: dielineFile(pk, cell).path,
          pictures,
          ready: pictures.every((p) => p.held !== false),
          your_mockup: mockup ? { output_id: mockup.outputId, url: mockup.url } : null,
        }
      })
    )
    const lines = [`Packaging in the creative kit ${loaded.kit.version}: ${Object.values(pk.looks).map((l) => l.name).join(', ')}.`]
    for (const c of out) {
      const missing = c.pictures.filter((p) => p.held === false).map((p) => p.pin)
      lines.push(
        `- ${c.cell} (${c.colourway_words ?? c.colourway}): ${c.ready ? 'every picture held' : `not held yet: ${missing.join(', ')}`}; ${c.your_mockup ? `your mockup: output ${c.your_mockup.output_id}` : 'no mockup of yours yet (packaging_mockup)'}.`
      )
    }
    lines.push(
      `Boxes: ${Object.entries(pk.boxes).map(([k, v]) => `${k} (${v})`).join('; ')}.`,
      'The flow: packaging_mockup (the composite, in code), packaging_finish (the model adds paper, light, shadow and gloss; only its grain is kept), grade_image (three reads). ' + deciderNote(pk)
    )
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
      structuredContent: { ...kitHeader(loaded), product: pk.slug, boxes: pk.boxes, looks: pk.looks, cells: out, calibration: pk.calibration, deciders: pk.product.deciders },
    }
  },
}

// ------------------------------------------------------------------ packaging_mockup

export const PackagingMockupArgs = z.object({ ...CellArgs, async: z.boolean().optional().default(false) }).strict()

interface MockupExecution {
  header: ReturnType<typeof kitHeader>
  cell: Cell
  result: MockupResult
  outputId: string | null
  generationId: string
  recorded: boolean
  recordError: string | null
  preview: string | null
}

function mockupSummary(x: MockupExecution): string {
  const lines = [
    `The mockup of ${cellKey(x.cell)}, built by the repository's mockup code: the look's artwork warped onto the white render's marked panels, the render's shading kept (${x.result.composite.width}x${x.result.composite.height}, sha256 ${x.result.composite.sha256.slice(0, 12)}).`,
    'This is the cell\'s control and the ground truth for placement and colour: a finish may add only paper, light, shadow and gloss.',
  ]
  if (x.result.notes.length) lines.push(`The mockup's notes: ${x.result.notes.join('; ')}.`)
  lines.push(x.recorded ? `Saved in Vesper under Claude / ${STREAM_SESSIONS.packaging.name}, output ${x.outputId}.` : `Not recorded in Vesper's web app (${x.recordError ?? 'unknown'}); the file is at the link.`)
  lines.push('Next: packaging_finish for the same cell.')
  return lines.join('\n')
}

function mockupStructured(x: MockupExecution): Record<string, unknown> {
  return {
    ...x.header,
    product: 'packaging',
    cell: cellKey(x.cell),
    ...x.cell,
    output_id: x.outputId,
    generationId: x.generationId,
    composite: { url: x.result.composite.url, sha256: x.result.composite.sha256, width: x.result.composite.width, height: x.result.composite.height },
    inputs: x.result.inputs,
    notes: x.result.notes,
    modelId: 'none',
    outputs: [{ url: x.result.composite.url, width: x.result.composite.width, height: x.result.composite.height, mimeType: 'image/png', outputId: x.outputId }],
    estimatedCostUsd: 0,
    next: 'packaging_finish',
  }
}

async function executeMockup(ctx: ToolContext, loaded: LoadedKit, pk: PackagingKit, cell: Cell, jobId: string | null): Promise<MockupExecution> {
  const worker = requireWorker(ctx.env)
  const rows = await deps.pinRows(pk.slug)
  const fd = flowDeps(ctx, loaded, pk, rows, worker)
  const plan = await planMockup(loaded.kit, pk, cell, fd)
  const generationId = randomUUID()
  const result = await runMockup(plan, fd, { generationId, outputsPrefix: `mcp/${ctx.principal.credentialId}/${generationId}` })
  const health = await worker.health().catch(() => null)
  const header = kitHeader(loaded)
  const renderUrl = plan.render.row.storagePath ? await deps.anchorUrl(plan.render.row.storagePath, ctx.env).catch(() => null) : null
  let outputId: string | null = null
  let recorded = false
  let recordError: string | null = null
  try {
    const rec = await deps.record({
      ownerId: ctx.principal.ownerId,
      generationId,
      stream: 'packaging',
      modelId: 'none',
      prompt: `The mockup of ${cellKey(cell)}, built in code (no model)`,
      costUsd: 0,
      outputs: [{ url: result.composite.url, width: result.composite.width, height: result.composite.height }],
      parameters: {
        toolName: 'packaging_mockup',
        source: 'mcp',
        credentialId: ctx.principal.credentialId,
        mcpJobId: jobId,
        creative: {
          product: pk.slug,
          ...cell,
          cell: cellKey(cell),
          lane: 'composite',
          model: 'none',
          kit_version: header.kit_version,
          kit_tag: header.kit_tag,
          kit_commit: header.kit_commit,
          composite: { sha256: result.composite.sha256, width: result.composite.width, height: result.composite.height, target: result.composite.target },
          mask: { ...result.mask.target, sha256: result.mask.sha256 },
          inputs: result.inputs,
          recipe: result.recipe,
          notes: result.notes,
          worker: health ? { version: health.version ?? null, commit: health.commit ?? null } : null,
        },
        ...(renderUrl ? { anchor: { kind: 'product-render', id: plan.render.spec.pinId, url: renderUrl, sha256: plan.render.spec.sha256 } } : {}),
        estimatedCostUsd: 0,
      },
    })
    outputId = rec.outputIds[0] ?? null
    recorded = true
  } catch (err) {
    recordError = (err as Error)?.message || 'unknown error'
  }
  const bytes = await fd.storage.read(result.composite.target).catch(() => null)
  return {
    header,
    cell,
    result,
    outputId,
    generationId,
    recorded,
    recordError,
    preview: bytes ? `data:image/png;base64,${bytes.toString('base64')}` : null,
  }
}

function mockupPayload(x: MockupExecution): JobPayload {
  return { summary: mockupSummary(x), structuredContent: mockupStructured(x), outputIds: x.outputId ? [x.outputId] : [], costUsd: 0 }
}

async function requirePackaging(ctx: ToolContext): Promise<void> {
  await assertPackagingAccess(ctx.principal.ownerId)
}

export const packagingMockupHandler: ToolHandler = {
  async run(args, ctx) {
    refuseExtras('packaging_mockup', args)
    const parsed = PackagingMockupArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    await requirePackaging(ctx)
    const a = parsed.data
    const loaded = await deps.loadKit(ctx.env)
    const pk = packagingKit(loaded.kit)
    const cell = resolveCell(pk, a)
    requireWorker(ctx.env)
    return runLongCall<MockupExecution>({
      ctx,
      toolName: 'packaging_mockup',
      modelId: 'none',
      request: { ...a },
      runAsync: a.async,
      what: `the ${cellKey(cell)} mockup`,
      execute: (jobId) => executeMockup(ctx, loaded, pk, cell, jobId),
      toPayload: mockupPayload,
      toWire: async (x) => ({
        content: await imageResultContent({
          summary: mockupSummary(x),
          outputs: [{ url: x.result.composite.url, width: x.result.composite.width, height: x.result.composite.height, mimeType: 'image/png' }],
          modelId: 'mockup',
          previewSources: x.preview ? [x.preview] : undefined,
          inline: true,
        }),
        structuredContent: mockupStructured(x),
      }),
    })
  },
}

// ------------------------------------------------------------------ packaging_finish

export const PackagingFinishArgs = z
  .object({
    ...CellArgs,
    lane: z.enum(LANES).optional().default('pro'),
    n: z.number().int().min(1).max(4).optional(),
    composite_output_id: z.string().uuid().optional(),
    async: z.boolean().optional().default(false),
  })
  .strict()

interface FinishExecution {
  header: ReturnType<typeof kitHeader>
  pk: PackagingKit
  cell: Cell
  composite: RecordedComposite
  result: FinishResult
  generationId: string
  outputs: Array<{ url: string; width: number; height: number; mimeType: string; outputId: string | null; draw: number }>
  previews: string[]
  manifest: Record<string, unknown>[]
  recorded: boolean
  recordError: string | null
  costUsd: number | null
}

const LANE_MODEL_ESTIMATE: Record<PackagingLane, string> = { pro: 'gemini-3-pro-image', nb2: 'gemini-3.1-flash-image', gpt: 'gpt-image-2' }

function finishSummary(x: FinishExecution): string {
  const r = x.result
  const kept = r.draws.filter((d) => !d.skipped && d.surfaced)
  const lines = [
    `${kept.length} finished picture${kept.length === 1 ? '' : 's'} of ${cellKey(x.cell)} from ${r.inputs.model} (lane ${r.inputs.lane}): the model was sent the padded composite, the white render and the dieline half, in that order, with the finishing skeleton ${r.inputs.skeleton?.version ?? ''} byte for byte; the draw was cut back to the render's frame and only its paper grain laid onto the composite.`,
    `The control, the composite itself: output ${x.composite.outputId}. Compare every finish with it.`,
  ]
  for (const d of r.draws.filter((d) => d.skipped)) {
    lines.push(`Draw ${d.index} was not kept: ${d.why ?? 'the frame moved'} (shift ${d.frameShiftPx ?? '?'} px).`)
  }
  if (r.failures.length) lines.push(`Not finished: ${r.failures.join('; ')}.`)
  lines.push(
    x.recorded ? `Saved in Vesper under Claude / ${STREAM_SESSIONS.packaging.name}.` : kept.length ? `Not recorded in Vesper's web app (${x.recordError ?? 'unknown'}); the files are at the links.` : 'Nothing was recorded.'
  )
  lines.push(`Worker ${r.worker.version ?? '?'} at commit ${String(r.worker.commit ?? '?').slice(0, 7)}.`)
  lines.push('Next: grade each with grade_image (product packaging). ' + deciderNote(x.pk))
  x.outputs.forEach((o) => lines.push(`${o.draw}. output ${o.outputId ?? '(not recorded)'}: ${o.url}`))
  return lines.join('\n')
}

function finishStructured(x: FinishExecution): Record<string, unknown> {
  const r = x.result
  return {
    ...x.header,
    product: 'packaging',
    cell: cellKey(x.cell),
    ...x.cell,
    lane: r.inputs.lane,
    model: r.inputs.model,
    modelId: r.inputs.model,
    request: r.inputs.request,
    frame: r.inputs.frame,
    prompt: r.inputs.prompt,
    skeleton: r.inputs.skeleton,
    references: r.inputs.references.map((ref) => ({ role: ref.role, sha256: ref.sha256 })),
    control: { output_id: x.composite.outputId, url: x.composite.url, sha256: x.composite.sha256 },
    draws: r.draws.map((d) => ({ draw: d.index, kept: !d.skipped && !!d.surfaced, skipped: d.skipped, why: d.why ?? null, frame_shift_px: d.frameShiftPx ?? null, sha256: d.surfaced?.sha256 ?? null })),
    failures: r.failures,
    worker: { version: r.worker.version ?? null, commit: r.worker.commit ?? null },
    generationId: x.generationId,
    outputs: x.outputs,
    manifest: x.manifest,
    estimatedCostUsd: x.costUsd,
    next: 'grade_image',
  }
}

async function executeFinish(ctx: ToolContext, loaded: LoadedKit, pk: PackagingKit, cell: Cell, composite: RecordedComposite, lane: PackagingLane, n: number, jobId: string | null): Promise<FinishExecution> {
  const worker = requireWorker(ctx.env)
  const rows = await deps.pinRows(pk.slug)
  const fd = flowDeps(ctx, loaded, pk, rows, worker)
  const plan = await planMockup(loaded.kit, pk, cell, fd)
  const generationId = randomUUID()
  const result = await runFinish(plan, pk, composite, lane, n, fd, { generationId, outputsPrefix: `mcp/${ctx.principal.credentialId}/${generationId}` }, {
    allowModel: (model) => assertModelAllowed(ctx.principal.allowedModels, vesperModelId(model)),
  })
  const header = kitHeader(loaded)
  const kept = result.draws.filter((d) => !d.skipped && d.surfaced)
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const manifest = result.draws.map((d) => finishManifestLine(cell, result, d, composite, timestamp))
  const perImage = drawPriceUsd(result.inputs.model, String(result.inputs.request.imageSize ?? '2K'))
  const drawnCount = result.draws.length
  const costUsd = perImage === null ? null : perImage * drawnCount
  const renderUrl = plan.render.row.storagePath ? await deps.anchorUrl(plan.render.row.storagePath, ctx.env).catch(() => null) : null
  let outputIds: Array<string | null> = kept.map(() => null)
  let recorded = false
  let recordError: string | null = null
  if (kept.length) {
    try {
      const rec = await deps.record({
        ownerId: ctx.principal.ownerId,
        generationId,
        stream: 'packaging',
        modelId: vesperModelId(result.inputs.model),
        prompt: result.inputs.prompt,
        costUsd,
        outputs: kept.map((d) => ({ url: d.surfaced!.url, width: d.surfaced!.width || null, height: d.surfaced!.height || null })),
        parameters: {
          toolName: 'packaging_finish',
          source: 'mcp',
          credentialId: ctx.principal.credentialId,
          mcpJobId: jobId,
          creative: {
            product: pk.slug,
            ...cell,
            cell: cellKey(cell),
            lane: result.inputs.lane,
            model: result.inputs.model,
            kit_version: header.kit_version,
            kit_tag: header.kit_tag,
            kit_commit: header.kit_commit,
            skeleton: result.inputs.skeleton,
            frame: result.inputs.frame,
            request: result.inputs.request,
            references: result.inputs.references.map((r) => ({ role: r.role, sha256: r.sha256 })),
            control: { output_id: composite.outputId, sha256: composite.sha256 },
            worker: { version: result.worker.version ?? null, commit: result.worker.commit ?? null },
          },
          manifest,
          ...(renderUrl ? { anchor: { kind: 'product-render', id: plan.render.spec.pinId, url: renderUrl, sha256: plan.render.spec.sha256 } } : {}),
          estimatedCostUsd: costUsd,
        },
      })
      outputIds = rec.outputIds
      recorded = true
    } catch (err) {
      recordError = (err as Error)?.message || 'unknown error'
    }
  }
  const previews = await Promise.all(
    kept.map(async (d) => {
      const bytes = await fd.storage.read(d.surfaced!.target).catch(() => null)
      return bytes ? `data:image/png;base64,${bytes.toString('base64')}` : d.surfaced!.url
    })
  )
  return {
    header,
    pk,
    cell,
    composite,
    result,
    generationId,
    outputs: kept.map((d, i) => ({ url: d.surfaced!.url, width: d.surfaced!.width, height: d.surfaced!.height, mimeType: 'image/png', outputId: outputIds[i] ?? null, draw: d.index })),
    previews,
    manifest,
    recorded,
    recordError,
    costUsd,
  }
}

function finishPayload(x: FinishExecution): JobPayload {
  return {
    summary: finishSummary(x),
    structuredContent: finishStructured(x),
    outputIds: x.outputs.map((o) => o.outputId).filter((id): id is string => typeof id === 'string'),
    costUsd: x.costUsd,
  }
}

export const packagingFinishHandler: ToolHandler = {
  estimateCostUsd(args) {
    const lane = (typeof args.lane === 'string' && (LANES as readonly string[]).includes(args.lane) ? args.lane : 'pro') as PackagingLane
    const n = typeof args.n === 'number' ? args.n : 1
    return (drawPriceUsd(LANE_MODEL_ESTIMATE[lane], '2K') ?? 0.2) * Math.max(1, n)
  },
  async run(args, ctx) {
    refuseExtras('packaging_finish', args)
    const parsed = PackagingFinishArgs.safeParse(args)
    if (!parsed.success) throw invalidArguments(parsed.error.issues)
    await requirePackaging(ctx)
    const a = parsed.data
    const loaded = await deps.loadKit(ctx.env)
    const pk = packagingKit(loaded.kit)
    const cell = resolveCell(pk, a)
    requireWorker(ctx.env)
    const composite = await deps.findComposite(ctx.principal.ownerId, cellKey(cell), a.composite_output_id)
    if (!composite) {
      throw new PackagingError(
        a.composite_output_id
          ? `output ${a.composite_output_id} is not a mockup of ${cellKey(cell)} of yours`
          : `no mockup of ${cellKey(cell)} of yours yet: run packaging_mockup for this cell first. Nothing was paid for.`
      )
    }
    const n = Math.max(1, Math.min(pk.drawsPerCall, a.n ?? 1))
    return runLongCall<FinishExecution>({
      ctx,
      toolName: 'packaging_finish',
      modelId: LANE_MODEL_ESTIMATE[a.lane],
      request: { ...a },
      runAsync: a.async,
      what: `the ${cellKey(cell)} finish`,
      execute: (jobId) => executeFinish(ctx, loaded, pk, cell, composite, a.lane, n, jobId),
      toPayload: finishPayload,
      toWire: async (x) => ({
        content: await imageResultContent({ summary: finishSummary(x), outputs: x.outputs, modelId: x.result.inputs.model, previewSources: x.previews, inline: true }),
        structuredContent: finishStructured(x),
      }),
    })
  },
}

// ------------------------------------------------------------------ grade_image, packaging

export interface PackagingGradeExecution {
  header: ReturnType<typeof kitHeader>
  slug: string
  pk: PackagingKit
  candidate: Omit<LoadedCandidate, 'bytes'>
  outcome: PackagingGradeOutcome
  composite: { output_id: string; sha256: string } | null
  gradeId: string | null
  storeError: string | null
  costUsd: number
}

/**
 * The packaging path of grade_image: the cell from the arguments or the picture's own record, the
 * cell's composite (the picture's own control, else the caller's newest mockup of the cell; refused
 * with the way to make one when there is none), the grade plan's pins, three reads.
 */
export async function executePackagingGrade(
  ctx: ToolContext,
  loaded: LoadedKit,
  a: { output_id?: string; frontify_asset_id?: string; image_url?: string; look?: string; box?: string; colourway?: string; runs?: number },
  load: typeof loadCandidate = loadCandidate
): Promise<PackagingGradeExecution> {
  const pk = packagingKit(loaded.kit)
  const candidate = await load(a, ctx.principal.ownerId, productionCandidateDeps(ctx.env))
  const own = candidate.outputId ? await deps.outputParameters(candidate.outputId, ctx.principal.ownerId) : null
  const drawn = obj(own?.creative)
  const drawnHere = drawn.product === pk.slug
  const cell = resolveCell(pk, {
    look: a.look ?? (drawnHere ? str(drawn.look) ?? undefined : undefined),
    box: a.box ?? (drawnHere ? str(drawn.box) ?? undefined : undefined),
    colourway: a.colourway ?? (drawnHere ? str(drawn.colourway) ?? undefined : undefined),
  })
  const isComposite = drawnHere && drawn.lane === 'composite' && drawn.cell === cellKey(cell)
  let composite: RecordedComposite | null = null
  if (!isComposite) {
    const controlId = drawnHere ? str(obj(drawn.control).output_id) : null
    composite = await deps.findComposite(ctx.principal.ownerId, cellKey(cell), controlId ?? undefined)
  }
  requireComposite(composite !== null, isComposite, cell)
  const storage = deps.storage(ctx.env)
  let cellComposite: CellComposite | null = null
  if (composite) {
    const bytes = composite.target ? await storage.read(composite.target) : null
    if (!bytes) throw new PackagingError(`the mockup ${composite.outputId} of ${cellKey(cell)} could not be read: run packaging_mockup again`)
    cellComposite = { outputId: composite.outputId, sha256: composite.sha256, bytes, mimeType: 'image/png' }
  }
  const rows = await deps.pinRows(pk.slug)
  const product = pk.product
  const inlineLimit = product.grading?.inline_limit_bytes ?? 3_500_000
  const partDeps = pinPartDeps(ctx.env, inlineLimit)
  const outcome = await gradePackagingCandidate(
    { kit: loaded.kit, pk, cell, candidate, composite: cellComposite, runs: a.runs },
    {
      pinRows: rows,
      candidatePart: (c) => candidatePartFor(ctx.env, inlineLimit, c),
      pinPart: (row, spec) => pinPart(row, spec, partDeps),
      read: gradeReader(ctx.env, product.grading?.models ?? []),
    }
  )
  const header = kitHeader(loaded)
  const costUsd = GRADE_READ_USD * outcome.aggregate.reads
  let gradeId: string | null = null
  let storeError: string | null = null
  try {
    const stored = await prismaCreativeRecords.insertGrade({
      product: pk.slug,
      ownerId: ctx.principal.ownerId,
      credentialId: ctx.principal.credentialId,
      outputId: candidate.outputId,
      imageUrl: candidate.imageUrl,
      frontifyAssetId: candidate.frontifyAssetId,
      imageSha256: candidate.sha256,
      colourway: cell.colourway,
      view: outcome.view,
      viewAssumed: false,
      claimSource: null,
      judge: 'vesper',
      judgeModel: outcome.judge_model,
      reads: outcome.aggregate.reads,
      templateId: outcome.template_id,
      kitVersion: loaded.kit.version,
      kitCommit: loaded.commit,
      rubricVersion: product.rubric.version ?? '?',
      runs: outcome.reads,
      fails: outcome.aggregate.fails,
      failed: outcome.aggregate.failed,
      failedAdvisory: outcome.aggregate.failed_advisory,
      verdict: outcome.aggregate.verdict,
      verdictMajority: outcome.aggregate.verdict_majority,
      unstable: outcome.aggregate.unstable,
      errors: outcome.aggregate.errors,
      references: {
        attached: outcome.references,
        missing: outcome.missing,
        prompt_sha256: outcome.prompt_sha256,
        packaging: { cell: cellKey(cell), composite: composite ? { output_id: composite.outputId, sha256: composite.sha256 } : 'the picture itself', calibration: outcome.calibration },
      },
      latencyMs: outcome.latency_ms,
      costUsd,
    })
    gradeId = stored.id
  } catch (err) {
    storeError = (err as Error)?.message || 'the grade could not be stored'
  }
  const { bytes: _bytes, ...rest } = candidate
  return {
    header,
    slug: pk.slug,
    pk,
    candidate: rest,
    outcome,
    composite: composite ? { output_id: composite.outputId, sha256: composite.sha256 } : null,
    gradeId,
    storeError,
    costUsd,
  }
}

/** The lines a packaging grade adds under the checks table. */
export function packagingGradeLines(x: Pick<PackagingGradeExecution, 'outcome' | 'composite' | 'gradeId' | 'pk'>): string[] {
  const o = x.outcome
  const lines = [
    `Read against ${cellKey(o.cell)}: ${o.references.map((r) => `${r.n}. ${r.title ?? r.pin_id} (${r.role})`).join('; ') || 'nothing attached'}.` +
      (o.missing.length ? ` Not attached: ${o.missing.map((m) => `${m.role} (${m.why})`).join('; ')}.` : ''),
  ]
  if (o.calibration) lines.push(`Uncalibrated: ${o.calibration.replace(/^uncalibrated:\s*/i, '')}.`)
  lines.push(deciderNote(x.pk))
  if (x.gradeId) lines.push(`grade_id ${x.gradeId}: record the answer with record_verdict when the head of design gives one.`)
  return lines
}

export function packagingGradeStructured(x: Pick<PackagingGradeExecution, 'outcome' | 'composite' | 'pk'>): Record<string, unknown> {
  const d = (x.pk.product.deciders?.[0] ?? {}) as { name?: string | null }
  return {
    packaging: { cell: cellKey(x.outcome.cell), ...x.outcome.cell, composite: x.composite ?? 'the picture itself' },
    calibration: x.outcome.calibration,
    decider_named: !!d.name,
    decider_note: deciderNote(x.pk),
  }
}

