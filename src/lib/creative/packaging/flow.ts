/**
 * The packaging flow as Vesper runs it (the plugin repository's `docs/worker.md`):
 *
 *   1. `/v1/mockup` for the cell, with the mask: the composite built in code (`mockup.py`)
 *   2. `/v1/finish-inputs` with that composite: the padded composite, the dieline half, the prompt,
 *      the lane's model and settings (`finish.py`)
 *   3. the model call, in Vesper, which holds the keys: the three references in binding order, then
 *      the prompt, with the lane's settings
 *   4. `/v1/unpad`: the draw cut back to the render's frame (`finish.unpad`)
 *   5. `/v1/surface` with the mockup's mask: the draw's paper grain laid onto the composite
 *      (`surface.py`), or `skipped` when the draw moved
 *
 * Geometry, artwork, type and colour are the repository's code, never a model's; the model gives
 * paper, light, shadow and gloss, and only its fine detail survives the surface pass. Every input
 * the worker reads is a short signed URL with its sha256; every output it writes goes to a signed
 * upload URL, and the bytes come back here only through storage. Pure except for `FlowDeps`.
 */

import crypto from 'crypto'
import type { WorkerConfig } from '../cmf/worker-client'
import { cellKey, dielineFile, laneRuledOut, neededPanelImages, panelsFile, pinByPath, renderPin, PackagingError, type Cell, type DielineJson, type KitFile, type PackagingKit, type PanelsJson } from './kit-packaging'
import type { PinRow, PinSpec } from '../pins'
import { kitPins, usablePin } from '../pins'
import type { Kit } from '../kit-schema'

export const LANES = ['pro', 'nb2', 'gpt'] as const
export type PackagingLane = (typeof LANES)[number]
export const FINISH_DEADLINE_MS = 280_000
export const SIGNED_GET_SECONDS = 900

export interface StoreTarget {
  bucket: string
  path: string
}

export interface FlowStorage {
  /** A short signed GET URL the worker fetches. */
  signedGet(target: StoreTarget, seconds: number): Promise<string>
  /** A signed upload URL the worker PUTs a PNG to. */
  signedPut(target: StoreTarget): Promise<{ upload_url: string; content_type: string }>
  read(target: StoreTarget): Promise<Buffer | null>
  write(target: StoreTarget, bytes: Buffer, contentType: string): Promise<void>
  /** The public URL of a file in the outputs bucket (a Vesper output's `fileUrl`). */
  publicUrl(target: StoreTarget): string
}

export interface FlowWorker {
  call<T = unknown>(route: string, body: unknown): Promise<T>
  health(): Promise<WorkerHealth>
}

export interface WorkerHealth {
  ok?: boolean
  version?: string | null
  commit?: string | null
  signed?: boolean
}

export interface FlowReference {
  role: string
  sha256: string
  bytes: Buffer
  mimeType: string
  /** The pinned render: sent from Vesper's pinned copy, never re-encoded. */
  pin?: { row: PinRow; spec: PinSpec }
}

export interface DrawCall {
  provider: 'gemini' | 'openai'
  model: string
  prompt: string
  references: FlowReference[]
  request: Record<string, unknown>
  deadline: number
}

export interface FlowDeps {
  storage: FlowStorage
  worker: FlowWorker
  /** The kit files the mockup reads (the panels and the dieline JSON), checked by sha256. */
  readKitFile(file: KitFile): Promise<Buffer>
  pinRows: readonly PinRow[]
  pinsBucket: string
  outputsBucket: string
  /** One model call; returns the image. */
  draw(call: DrawCall): Promise<{ bytes: Buffer; mimeType: string }>
  now?: () => number
}

function sha256(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function usablePinFor(kit: Kit, pk: PackagingKit, rows: readonly PinRow[], pinId: string, what: string): { row: PinRow; spec: PinSpec } {
  const spec = kitPins(kit).find((s) => s.product === pk.slug && s.pinId === pinId)
  if (!spec) throw new PackagingError(`${what} (${pinId}) is not a pin with a sha256 in the kit`)
  const row = rows.find((r) => r.pinId === spec.pinId && r.sha256 === spec.sha256)
  if (!row || !usablePin(row, spec) || !row.storagePath) {
    throw new PackagingError(
      `${what} (${spec.title ?? pinId}) is not pinned in Vesper yet: an admin uploads it with scripts/creative-upload-pin.mjs and syncs the pins. Nothing was made.`
    )
  }
  return { row, spec }
}

// ------------------------------------------------------------------ 1. the mockup

export interface MockupPlan {
  cell: Cell
  render: { row: PinRow; spec: PinSpec }
  dielineImage: { row: PinRow; spec: PinSpec }
  panelImages: Array<{ path: string; row: PinRow; spec: PinSpec }>
  panelsJson: KitFile & { content: string }
  dielineJson: KitFile & { content: string }
}

/** Every input of the cell's mockup, from the kit, each a pin Vesper holds with the kit's bytes. */
export async function planMockup(kit: Kit, pk: PackagingKit, cell: Cell, deps: Pick<FlowDeps, 'readKitFile' | 'pinRows'>): Promise<MockupPlan> {
  const renderSpec = renderPin(pk, cell.box)
  const dFile = dielineFile(pk, cell)
  const pFile = panelsFile(pk, cell.box)
  const dText = (await deps.readKitFile(dFile)).toString('utf8')
  const pText = (await deps.readKitFile(pFile)).toString('utf8')
  const dieline = JSON.parse(dText) as DielineJson
  const panels = JSON.parse(pText) as PanelsJson
  if (!dieline.image) throw new PackagingError(`the dieline ${dFile.path} names no picture`)
  const dPin = pinByPath(pk, dieline.image)
  if (!dPin) throw new PackagingError(`the dieline picture ${dieline.image} is not a pin in the kit`)
  const render = usablePinFor(kit, pk, deps.pinRows, renderSpec.id, `the white render of the ${cell.box} box`)
  const dielineImage = usablePinFor(kit, pk, deps.pinRows, dPin.id, `the dieline of ${cell.look} ${cell.colourway}`)
  const panelImages = neededPanelImages(dieline, panels, cell.box).map((path) => {
    const pin = pinByPath(pk, path)
    if (!pin) throw new PackagingError(`the panel picture ${path} the dieline names is not a pin in the kit`)
    return { path, ...usablePinFor(kit, pk, deps.pinRows, pin.id, `the panel picture ${path}`) }
  })
  return {
    cell,
    render,
    dielineImage,
    panelImages,
    panelsJson: { ...pFile, content: pText },
    dielineJson: { ...dFile, content: dText },
  }
}

export interface MockupResult {
  composite: { target: StoreTarget; url: string; sha256: string; bytes: number; width: number; height: number }
  mask: { target: StoreTarget; sha256: string }
  recipe: unknown
  notes: string[]
  inputs: Record<string, unknown>
}

interface WorkerFile {
  sha256: string
  bytes: number
  width: number
  height: number
}

/** `/v1/mockup` for the planned cell: the composite into the outputs bucket, the mask kept private. */
export async function runMockup(plan: MockupPlan, deps: FlowDeps, where: { generationId: string; outputsPrefix: string }): Promise<MockupResult> {
  const pin = async (p: { row: PinRow; spec: PinSpec }) => ({
    url: await deps.storage.signedGet({ bucket: deps.pinsBucket, path: p.row.storagePath! }, SIGNED_GET_SECONDS),
    sha256: p.spec.sha256,
  })
  const compositeTarget = { bucket: deps.outputsBucket, path: `${where.outputsPrefix}/composite.png` }
  const maskTarget = { bucket: deps.pinsBucket, path: `work/packaging/${where.generationId}/mask.png` }
  const images: Record<string, { url: string; sha256: string }> = {}
  for (const img of plan.panelImages) images[img.path] = await pin(img)
  const body = {
    look: plan.cell.look,
    box: plan.cell.box,
    colourway: plan.cell.colourway,
    render: await pin(plan.render),
    dieline: await pin(plan.dielineImage),
    panels_json: plan.panelsJson,
    dieline_json: plan.dielineJson,
    images,
    output: await deps.storage.signedPut(compositeTarget),
    mask_output: await deps.storage.signedPut(maskTarget),
  }
  const res = await deps.worker.call<WorkerFile & { composite?: WorkerFile; mask?: WorkerFile; recipe?: unknown; notes?: string[]; inputs?: Record<string, unknown> }>('/v1/mockup', body)
  if (!res?.sha256 || !res.mask?.sha256) throw new PackagingError('the creative worker answered /v1/mockup without the composite and its mask')
  return {
    composite: { target: compositeTarget, url: deps.storage.publicUrl(compositeTarget), sha256: res.sha256, bytes: res.bytes, width: res.width, height: res.height },
    mask: { target: maskTarget, sha256: res.mask.sha256 },
    recipe: res.recipe ?? null,
    notes: res.notes ?? [],
    inputs: res.inputs ?? {},
  }
}

// ------------------------------------------------------------------ 2 to 5. the finish

/** What a recorded mockup of the cell carries, from its generation's parameters. */
export interface RecordedComposite {
  outputId: string
  generationId: string
  url: string
  sha256: string
  /** Where the composite sits in the outputs bucket. */
  target: StoreTarget | null
  mask: StoreTarget & { sha256: string }
  /** The worker's record of what the composite was built from. */
  inputs: { render?: string; dieline?: string; dieline_json?: string; panels_json?: string }
}

/** Refuses a composite made from inputs the kit no longer names: the mockup must be made again. */
export function checkCompositeCurrent(plan: Pick<MockupPlan, 'render' | 'dielineImage' | 'dielineJson' | 'panelsJson'>, composite: RecordedComposite): void {
  const changed: string[] = []
  if (composite.inputs.render && composite.inputs.render !== plan.render.spec.sha256) changed.push('the white render')
  if (composite.inputs.dieline && composite.inputs.dieline !== plan.dielineImage.spec.sha256) changed.push('the dieline picture')
  if (composite.inputs.dieline_json && composite.inputs.dieline_json !== plan.dielineJson.sha256) changed.push('the dieline file')
  if (composite.inputs.panels_json && composite.inputs.panels_json !== plan.panelsJson.sha256) changed.push('the marked panels')
  if (changed.length) {
    throw new PackagingError(`the kit changed ${changed.join(', ')} since this mockup was made: run packaging_mockup again. Nothing was paid for.`)
  }
}

export interface FinishInputs {
  lane: string
  model: string
  provider: 'gemini' | 'openai'
  request: Record<string, unknown>
  settings: Record<string, unknown>
  frame: { pad: number[]; padded: number[]; sent: number[]; frame: number[] }
  prompt: string
  skeleton: { heading?: string; version?: string | null; [k: string]: unknown }
  references: Array<{ role: string; sha256: string; bytes: number; width: number; height: number; uploaded: string | null }>
  inputs: Record<string, unknown>
}

export interface FinishedDraw {
  index: number
  model: string
  skipped: boolean
  why?: string
  shift?: number[]
  frameShiftPx?: number
  surfaced?: { target: StoreTarget; url: string; sha256: string; bytes: number; width: number; height: number }
  unpadded?: { sha256: string }
  raw?: { sha256: string; mimeType: string }
  settings?: Record<string, unknown>
}

export interface FinishResult {
  inputs: FinishInputs
  draws: FinishedDraw[]
  failures: string[]
  worker: WorkerHealth
}

/**
 * Steps 2 to 5 for `n` draws from one recorded composite. Refuses before any model call when the
 * kit's router rules the lane out or the inputs the worker prepared are not the bytes it named.
 */
export async function runFinish(
  plan: MockupPlan,
  pk: PackagingKit,
  composite: RecordedComposite,
  lane: PackagingLane,
  n: number,
  deps: FlowDeps,
  where: { generationId: string; outputsPrefix: string },
  checks: { allowModel(model: string): void } = { allowModel: () => undefined }
): Promise<FinishResult> {
  const now = deps.now ?? Date.now
  checkCompositeCurrent(plan, composite)
  const work = (name: string): StoreTarget => ({ bucket: deps.pinsBucket, path: `work/packaging/${where.generationId}/${name}` })
  const pin = async (p: { row: PinRow; spec: PinSpec }) => ({
    url: await deps.storage.signedGet({ bucket: deps.pinsBucket, path: p.row.storagePath! }, SIGNED_GET_SECONDS),
    sha256: p.spec.sha256,
  })
  const worker = await deps.worker.health().catch(() => ({ ok: false }) as WorkerHealth)

  // 2. what the finishing model is sent, as finish.py builds it
  const inputs = await deps.worker.call<FinishInputs>('/v1/finish-inputs', {
    look: plan.cell.look,
    box: plan.cell.box,
    colourway: plan.cell.colourway,
    lane,
    composite: { url: composite.url, sha256: composite.sha256 },
    render: await pin(plan.render),
    dieline: await pin(plan.dielineImage),
    dieline_json: plan.dielineJson,
    outputs: { padded: await deps.storage.signedPut(work('padded.png')), dieline_half: await deps.storage.signedPut(work('dieline-half.png')) },
  })
  const ruledOut = laneRuledOut(pk, inputs.model)
  if (ruledOut) throw new PackagingError(`${ruledOut}. Nothing was paid for.`)
  checks.allowModel(inputs.model)

  // The references in binding order, each read back and held to the sha256 the worker named.
  const references: FlowReference[] = []
  for (const ref of inputs.references) {
    if (ref.role === 'render') {
      if (ref.sha256 !== plan.render.spec.sha256) throw new PackagingError('the worker sent a render that is not the pinned one. Nothing was paid for.')
      const bytes = await deps.storage.read({ bucket: deps.pinsBucket, path: plan.render.row.storagePath! })
      if (!bytes || sha256(bytes) !== ref.sha256) throw new PackagingError("the pinned render's bytes could not be read as the kit's. Nothing was paid for.")
      references.push({ role: ref.role, sha256: ref.sha256, bytes, mimeType: plan.render.row.mime || 'image/png', pin: plan.render })
      continue
    }
    const name = ref.role === 'composite' ? 'padded.png' : ref.role === 'dieline' ? 'dieline-half.png' : null
    if (!name) throw new PackagingError(`the worker named a reference Vesper does not know: ${ref.role}`)
    const bytes = await deps.storage.read(work(name))
    if (!bytes || sha256(bytes) !== ref.sha256) {
      throw new PackagingError(`the ${ref.role} the worker prepared is not the file it named (sha256). Nothing was paid for.`)
    }
    references.push({ role: ref.role, sha256: ref.sha256, bytes, mimeType: 'image/png' })
  }
  const order = pk.bindOrder.length ? pk.bindOrder : ['composite', 'render', 'dieline']
  if (references.map((r) => r.role).join(',') !== order.join(',')) {
    throw new PackagingError(`the worker's references are ${references.map((r) => r.role).join(', ')}, the kit binds ${order.join(', ')}. Nothing was paid for.`)
  }

  // 3. the model calls, all at once, one image each
  const deadline = now() + FINISH_DEADLINE_MS
  const settled = await Promise.allSettled(
    Array.from({ length: n }, () =>
      deps.draw({ provider: inputs.provider, model: inputs.model, prompt: inputs.prompt, references, request: inputs.request, deadline })
    )
  )
  const failures: string[] = []
  const drawn: Array<{ index: number; bytes: Buffer; mimeType: string }> = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') drawn.push({ index: i + 1, ...s.value })
    else failures.push(`draw ${i + 1}: ${(s.reason as Error)?.message || 'failed'}`)
  })
  if (!drawn.length) throw new PackagingError(`no draw came back (${failures.join('; ')})`)

  // 4 and 5, per draw
  const draws: FinishedDraw[] = []
  for (const d of drawn) {
    const rawTarget = work(`draw-${d.index}${d.mimeType === 'image/jpeg' ? '.jpg' : '.png'}`)
    await deps.storage.write(rawTarget, d.bytes, d.mimeType)
    const rawSha = sha256(d.bytes)
    try {
      const unpadded = await deps.worker.call<WorkerFile>('/v1/unpad', {
        draw: { url: await deps.storage.signedGet(rawTarget, SIGNED_GET_SECONDS), sha256: rawSha },
        frame: inputs.frame,
        output: await deps.storage.signedPut(work(`unpadded-${d.index}.png`)),
      })
      const surfacedTarget = { bucket: deps.outputsBucket, path: `${where.outputsPrefix}/${d.index - 1}.png` }
      const surfaced = await deps.worker.call<WorkerFile & { skipped: boolean; shift?: number[]; frame_shift_px?: number; settings?: Record<string, unknown>; why?: string }>('/v1/surface', {
        composite: { url: composite.url, sha256: composite.sha256 },
        draw: { url: await deps.storage.signedGet(work(`unpadded-${d.index}.png`), SIGNED_GET_SECONDS), sha256: unpadded.sha256 },
        mask: { url: await deps.storage.signedGet(composite.mask, SIGNED_GET_SECONDS), sha256: composite.mask.sha256 },
        output: await deps.storage.signedPut(surfacedTarget),
      })
      if (surfaced.skipped) {
        draws.push({ index: d.index, model: inputs.model, skipped: true, why: surfaced.why, shift: surfaced.shift, frameShiftPx: surfaced.frame_shift_px, raw: { sha256: rawSha, mimeType: d.mimeType }, unpadded: { sha256: unpadded.sha256 } })
        continue
      }
      draws.push({
        index: d.index,
        model: inputs.model,
        skipped: false,
        shift: surfaced.shift,
        frameShiftPx: surfaced.frame_shift_px,
        settings: surfaced.settings,
        raw: { sha256: rawSha, mimeType: d.mimeType },
        unpadded: { sha256: unpadded.sha256 },
        surfaced: { target: surfacedTarget, url: deps.storage.publicUrl(surfacedTarget), sha256: surfaced.sha256, bytes: surfaced.bytes, width: surfaced.width, height: surfaced.height },
      })
    } catch (err) {
      failures.push(`draw ${d.index}: ${(err as Error)?.message || 'the worker failed'}`)
    }
  }
  return { inputs, draws, failures, worker }
}

/** One manifest line per finished draw, shaped like the rounds' lines, with `source: vesper`. */
export function finishManifestLine(
  cell: Cell,
  result: FinishResult,
  draw: FinishedDraw,
  composite: RecordedComposite,
  timestamp: string
): Record<string, unknown> {
  return {
    file: draw.surfaced?.url ?? null,
    source: 'vesper',
    look: cell.look,
    box: cell.box,
    colourway: cell.colourway,
    cell: cellKey(cell),
    model_lane: result.inputs.lane,
    model: draw.model,
    draw: draw.index,
    prompt: result.inputs.prompt,
    prompt_sha256: sha256(result.inputs.prompt),
    skeleton: result.inputs.skeleton,
    references: result.inputs.references.map((r) => ({ role: r.role, sha256: r.sha256 })),
    settings: result.inputs.settings,
    surface: draw.skipped ? { skipped: true, shift: draw.shift, frame_shift_px: draw.frameShiftPx, why: draw.why } : { ...(draw.settings ?? {}), shift: draw.shift, frame_shift_px: draw.frameShiftPx },
    composite: { output_id: composite.outputId, sha256: composite.sha256 },
    raw_sha256: draw.raw?.sha256 ?? null,
    unpadded_sha256: draw.unpadded?.sha256 ?? null,
    worker: { version: result.worker.version ?? null, commit: result.worker.commit ?? null },
    timestamp,
  }
}

/** The worker, as `FlowWorker`, from B7's signed client. */
export function workerFrom(cfg: WorkerConfig, call: (cfg: WorkerConfig, route: string, body: unknown) => Promise<unknown>, health: (cfg: WorkerConfig) => Promise<WorkerHealth>): FlowWorker {
  return {
    call: <T>(route: string, body: unknown) => call(cfg, route, body) as Promise<T>,
    health: () => health(cfg),
  }
}

