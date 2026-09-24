/**
 * A Loop product drawn from Claude, the way the product's own `generate.py`
 * draws it: the product render first, then one photograph of it worn (the
 * kit's `generation.attach` map), at most `max_references`; the skeleton
 * filled by code and never rewritten; one model call per image; every draw
 * recorded with the full prompt and the references in order.
 *
 * There is no way to hand a draw a reference: nothing can chain a draw.
 */

import crypto from 'crypto'
import type { Kit, KitProduct } from './kit-schema'
import type { PinRow, PinSpec } from './pins'
import { kitPins, usablePin } from './pins'
import { referencePlan } from './tool-views'
import { fillSkeleton, kitSkeleton, skeletonKey } from './skeleton'

export const DRAW_DEADLINE_MS = 280_000
export const DEFAULT_ASPECT = '4:5'
export const DEFAULT_IMAGE_SIZE = '2K'
/** GPT Image 2 refuses a reference over 50 MiB; such a pin is left out and the result says so. */
export const GPT_MAX_REFERENCE_BYTES = 50 * 1024 * 1024

export type Lane = 'final' | 'second' | 'draft'

export class DrawError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DrawError'
  }
}

export interface DrawArgs {
  colourway?: string
  view?: string
  scene: string
  light: string
  format?: string
  lane?: Lane
  n?: number
  aspect?: string
  image_size?: '1K' | '2K' | '4K'
}

export interface DrawReference {
  n: number
  pin_id: string
  title: string | null
  role: string
  sha256: string
  spec: PinSpec
  row: PinRow
}

export interface DrawPlan {
  product: string
  kind: KitProduct['kind']
  colourway: string
  view: string
  lane: Lane
  model: string
  model_name: string
  references: DrawReference[]
  left_out: string[]
  prompt: string
  prompt_sha256: string
  skeleton_version: string | null
  skeleton_key: string
  n: number
  aspect: string
  image_size: string
  format: string
  rules: string[]
}

interface RouterRow {
  lane: string
  model: string
  name?: string
}

function router(product: KitProduct): RouterRow[] {
  const gen = (product.generation ?? {}) as { router?: { rows?: RouterRow[] } | null }
  return gen.router?.rows ?? []
}

/** The lane's model from the product's dated router in the kit. */
export function modelForLane(product: KitProduct, lane: Lane): RouterRow {
  const row = router(product).find((r) => r.lane.toLowerCase() === lane)
  if (!row) {
    const lanes = router(product).map((r) => r.lane)
    throw new DrawError(`${product.name}'s router has no '${lane}' lane${lanes.length ? `; it has ${lanes.join(', ')}` : ''}`)
  }
  return row
}

/** The plan for a draw, or a refusal naming what is missing. Pure: no network, no spend. */
export function planDraw(kit: Kit, slug: string, product: KitProduct, args: DrawArgs, rows: readonly PinRow[], opts: { isAdmin?: boolean } = {}): DrawPlan {
  if (product.kind === 'packaging') {
    throw new DrawError('packaging is drawn as a mockup first, in code, then finished: packaging_mockup and packaging_finish, not generate_product_image')
  }
  if (product.kind === 'cmf') {
    throw new DrawError("a CMF render is Damien's template filled from the sheet row, with the clown the only image: cmf_prompt and cmf_render, not generate_product_image")
  }
  const gen = (product.generation ?? {}) as { max_references?: number; draws_per_call?: number; rules?: string[] }
  const maxRefs = gen.max_references ?? 3
  const perCall = gen.draws_per_call ?? 2
  const n = Math.max(1, Math.min(perCall, args.n ?? 1))
  const lane: Lane = args.lane ?? 'final'
  const route = modelForLane(product, lane)

  const plan = referencePlan(kit, { product: slug, purpose: 'generate', colourway: args.colourway, view: args.view }, rows, opts)
  const specs = new Map(kitPins(kit).filter((s) => s.product === slug).map((s) => [s.pinId, s]))
  const byKey = new Map(rows.map((r) => [`${r.pinId}@${r.sha256}`, r]))
  const references: DrawReference[] = []
  const leftOut: string[] = []
  plan.references.slice(0, maxRefs).forEach((ref, i) => {
    const spec = specs.get(ref.pin_id)
    const row = spec ? byKey.get(`${spec.pinId}@${spec.sha256}`) : undefined
    const usable = !!spec && !!row && usablePin(row, spec)
    const role = ref.roles[0] ?? (i === 0 ? 'render' : 'wear')
    if (i === 0 && (!usable || role !== 'render')) {
      // The render goes first or the draw does not happen.
      throw new DrawError(
        `the product render for ${plan.key.colourway} ${plan.key.view} (${ref.title ?? ref.pin_id}) is ${
          usable ? 'not first in the kit' : ref.why_not ?? 'not pinned'
        }; a draw starts from it or not at all`
      )
    }
    if (!usable) {
      leftOut.push(`${ref.title ?? ref.pin_id}: ${ref.why_not ?? 'not pinned'}`)
      return
    }
    references.push({ n: references.length + 1, pin_id: ref.pin_id, title: ref.title, role, sha256: ref.sha256, spec: spec!, row: row! })
  })
  for (const ref of plan.references.slice(maxRefs)) leftOut.push(`${ref.title ?? ref.pin_id}: past the ${maxRefs}-reference limit`)

  const aspect = args.aspect ?? DEFAULT_ASPECT
  const format = (args.format ?? aspect).trim()
  const sk = kitSkeleton(product)
  const colourway = plan.key.colourway
  const prompt = fillSkeleton(product, {
    n_refs: references.length,
    colourway,
    scene: args.scene.trim(),
    light: args.light.trim(),
    format,
  })
  return {
    product: slug,
    kind: product.kind,
    colourway,
    view: plan.key.view,
    lane,
    model: route.model,
    model_name: route.name ?? route.model,
    references,
    left_out: leftOut,
    prompt,
    prompt_sha256: crypto.createHash('sha256').update(prompt, 'utf8').digest('hex'),
    skeleton_version: sk.version ?? null,
    skeleton_key: skeletonKey(sk, references.length),
    n,
    aspect,
    image_size: args.image_size ?? DEFAULT_IMAGE_SIZE,
    format,
    rules: gen.rules ?? [],
  }
}

/** One manifest line per draw, shaped like the product's `generate.py` writes, with `source: vesper`. */
export function manifestLine(
  plan: DrawPlan,
  draw: { index: number; file: string; model: string; settings: Record<string, unknown>; timestamp: string }
): Record<string, unknown> {
  return {
    file: draw.file,
    source: 'vesper',
    lane: 'delivery',
    name: `${plan.colourway}-${plan.view}`,
    use_case: null,
    draw: draw.index,
    model: draw.model,
    model_lane: plan.lane,
    colourway: plan.colourway,
    colourway_source: 'prompt',
    view: plan.view,
    references: plan.references.map((r) => r.title ?? r.pin_id),
    reference_pins: plan.references.map((r) => ({ pin_id: r.pin_id, sha256: r.sha256, role: r.role })),
    settings: draw.settings,
    prompt: plan.prompt,
    timestamp: draw.timestamp,
  }
}

export interface DrawnImage {
  bytes: Buffer
  mimeType: string
  model: string
  settings: Record<string, unknown>
}

export interface DrawDeps {
  /** One image from the plan's model, the references in binding order. Never passed `input_fidelity`. */
  drawOne(plan: DrawPlan, index: number, deadline: number): Promise<DrawnImage>
  now?: () => number
}

/** One call per image, all at once; a failed image is reported, the others are kept. */
export async function executeDraws(plan: DrawPlan, deps: DrawDeps): Promise<{ images: Array<DrawnImage & { index: number }>; failures: string[] }> {
  const now = deps.now ?? Date.now
  const deadline = now() + DRAW_DEADLINE_MS
  const settled = await Promise.allSettled(
    Array.from({ length: plan.n }, (_, i) => deps.drawOne(plan, i + 1, deadline).then((img) => ({ ...img, index: i + 1 })))
  )
  const images: Array<DrawnImage & { index: number }> = []
  const failures: string[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') images.push(s.value)
    else failures.push(`draw ${i + 1}: ${(s.reason as Error)?.message || 'failed'}`)
  })
  if (images.length === 0) throw new DrawError(`no draw came back (${failures.join('; ')})`)
  return { images, failures }
}
