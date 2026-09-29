/**
 * Packaging as the creative kit carries it: looks, boxes, colourways, the white render of each box,
 * the dieline of each look and colourway, the panels marked on each render, the grade plan, and
 * the pins behind them. Vesper holds no packaging rule of its own; everything here is read from the
 * kit (`products.packaging`) and the kit files it names, checked by sha256.
 *
 * A cell is one look, one box and one colourway: the unit the repository's mockup and finishing
 * scripts work in (`products/packaging/skill/scripts/{mockup,finish}.py`).
 */

import type { Kit, KitProduct } from '../kit-schema'

/** A file the kit names, checked by its sha256 when read. */
export interface KitFile {
  path: string
  sha256: string
}

export class PackagingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PackagingError'
  }
}

export interface PackagingLook {
  name: string
  colourways: Record<string, string>
  dielines: Record<string, string[]>
}

export interface GradePlanEntry {
  /** The pin id, or null for the cell's own composite (the mockup built in code). */
  pin: string | null
  role: string
}

export interface PackagingPin {
  id: string
  title: string | null
  sha256: string | null
  source: string
  localPath: string | null
  roles: string[]
  look: string | null
  colourway: string | null
}

export interface RouterRow {
  lane: string
  model: string
  name?: string
  when?: string
}

export interface PackagingKit {
  slug: string
  product: KitProduct
  looks: Record<string, PackagingLook>
  boxes: Record<string, string>
  renderByBox: Record<string, string>
  dielines: Record<string, KitFile>
  panels: Record<string, KitFile>
  gradePlan: Record<string, Record<string, Record<string, GradePlanEntry[]>>>
  colourwayWords: Record<string, Record<string, string>>
  pins: PackagingPin[]
  bindOrder: string[]
  drawsPerCall: number
  router: RouterRow[]
  calibration: string | null
}

export interface Cell {
  look: string
  box: string
  colourway: string
}

type Obj = Record<string, unknown>

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {}
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

/** The kit's packaging product, read into the shape the tools use; refuses a kit that lacks it. */
export function packagingKit(kit: Kit): PackagingKit {
  const entry = Object.entries(kit.products).find(([, p]) => p.kind === 'packaging')
  if (!entry) throw new PackagingError(`the creative kit ${kit.version} carries no packaging product`)
  const [slug, product] = entry
  const p = product as KitProduct & Obj
  const looks: Record<string, PackagingLook> = {}
  for (const [id, raw] of Object.entries(obj(p.looks))) {
    const l = obj(raw)
    looks[id] = {
      name: str(l.name) ?? id,
      colourways: Object.fromEntries(Object.entries(obj(l.colourways)).map(([k, v]) => [k, String(v)])),
      dielines: Object.fromEntries(Object.entries(obj(l.dielines)).map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : []])),
    }
  }
  const files = (v: unknown): Record<string, KitFile> =>
    Object.fromEntries(
      Object.entries(obj(v))
        .filter(([, f]) => typeof obj(f).path === 'string' && typeof obj(f).sha256 === 'string')
        .map(([k, f]) => [k, { path: String(obj(f).path), sha256: String(obj(f).sha256) }])
    )
  const gp = obj(p.grading_prompt)
  const gen = obj(p.generation)
  const router = obj(gen.router)
  const pins: PackagingPin[] = (product.references?.pins ?? []).map((pin) => {
    const raw = pin as unknown as Obj
    return {
      id: pin.id,
      title: pin.title ?? null,
      sha256: pin.sha256 ?? null,
      source: String(pin.source),
      localPath: str(raw.local_path),
      roles: pin.roles ?? [],
      look: str(raw.look),
      colourway: str(raw.colourway),
    }
  })
  return {
    slug,
    product,
    looks,
    boxes: Object.fromEntries(Object.entries(obj(p.boxes)).map(([k, v]) => [k, String(v)])),
    renderByBox: Object.fromEntries(Object.entries(obj(obj(p.renders).by_box)).map(([k, v]) => [k, String(v)])),
    dielines: files(p.dielines),
    panels: files(p.panels),
    gradePlan: obj(gp.grade_plan) as PackagingKit['gradePlan'],
    colourwayWords: obj(gp.colourway_words) as PackagingKit['colourwayWords'],
    pins,
    bindOrder: Array.isArray(gen.bind_order) ? gen.bind_order.map(String) : [],
    drawsPerCall: typeof gen.draws_per_call === 'number' && gen.draws_per_call > 0 ? gen.draws_per_call : 1,
    router: Array.isArray(router.rows) ? (router.rows as RouterRow[]) : [],
    calibration: str(obj(p.grading).calibration),
  }
}

function pick(what: string, given: string | undefined, options: string[]): string {
  if (given) {
    const hit = options.find((o) => o.toLowerCase() === given.trim().toLowerCase())
    if (!hit) throw new PackagingError(`no ${what} '${given}'; the kit has ${options.join(', ') || 'none'}`)
    return hit
  }
  if (options.length === 1) return options[0]
  throw new PackagingError(`name the ${what}: ${options.join(', ')}`)
}

/** One look, box and colourway, each checked against the kit; the only option is taken when there is one. */
export function resolveCell(pk: PackagingKit, a: { look?: string; box?: string; colourway?: string }): Cell {
  const look = pick('look', a.look, Object.keys(pk.looks))
  const boxes = Object.keys(pk.looks[look].dielines)
  const box = pick('box', a.box, boxes)
  const colourways = pk.looks[look].dielines[box] ?? []
  const colourway = pick(`colourway of ${look} on ${box}`, a.colourway, colourways)
  return { look, box, colourway }
}

export function cellKey(cell: Cell): string {
  return `${cell.look}/${cell.box}/${cell.colourway}`
}

/** Every cell the kit carries, in the kit's order. */
export function allCells(pk: PackagingKit): Cell[] {
  const out: Cell[] = []
  for (const [look, l] of Object.entries(pk.looks)) {
    for (const [box, colourways] of Object.entries(l.dielines)) {
      for (const colourway of colourways) out.push({ look, box, colourway })
    }
  }
  return out
}

/** The pin a repo-relative path names (`references/figma/white-open.png`), by its local path. */
export function pinByPath(pk: PackagingKit, rel: string): PackagingPin | null {
  const want = `products/${pk.slug}/${rel.replace(/^\/+/, '')}`
  return pk.pins.find((p) => p.localPath === want) ?? null
}

export function pinById(pk: PackagingKit, id: string): PackagingPin | null {
  return pk.pins.find((p) => p.id === id) ?? null
}

/** The white render of a box: the pin its `renders.by_box` path names. */
export function renderPin(pk: PackagingKit, box: string): PackagingPin {
  const rel = pk.renderByBox[box]
  if (!rel) throw new PackagingError(`the kit names no white render for the ${box} box`)
  const pin = pinByPath(pk, rel)
  if (!pin?.sha256) throw new PackagingError(`the white render of the ${box} box (${rel}) is not a pin with a sha256 in the kit`)
  return pin
}

/** The dieline file (the JSON of rectangles) of a look and colourway. */
export function dielineFile(pk: PackagingKit, cell: Cell): KitFile {
  const f = pk.dielines[`${cell.look}-${cell.colourway}`]
  if (!f) throw new PackagingError(`the kit carries no dieline for ${cell.look} ${cell.colourway}`)
  return f
}

/** The panels marked on a box's white render, named after the render's pin. */
export function panelsFile(pk: PackagingKit, box: string): KitFile {
  const render = renderPin(pk, box)
  const f = pk.panels[render.id]
  if (!f) throw new PackagingError(`the kit carries no marked panels for the render ${render.id}`)
  return f
}

export interface DielineJson {
  look?: string
  colourway?: string
  image?: string
  boxes?: Record<string, { panels?: Record<string, { image?: string }> }>
}

export interface PanelsJson {
  panels?: Record<string, { source?: string }>
}

/**
 * The panel pictures the dieline names for this box (the larger front panel), exactly as the
 * worker's `/v1/mockup` works them out: every panel of the render whose source is a panel of this
 * box with an `image`. Each must be sent, or the worker refuses.
 */
export function neededPanelImages(dieline: DielineJson, panels: PanelsJson, box: string): string[] {
  const boxPanels = dieline.boxes?.[box]?.panels ?? {}
  const needed = new Set<string>()
  for (const p of Object.values(panels.panels ?? {})) {
    const src = p.source
    if (!src || src === 'none' || src === 'flat') continue
    const image = boxPanels[src]?.image
    if (image) needed.add(image)
  }
  return Array.from(needed).sort()
}

/** What a picture of this cell is graded against, in order (the kit's `grade_plan`). */
export function gradePlanFor(pk: PackagingKit, cell: Cell): GradePlanEntry[] {
  const plan = pk.gradePlan[cell.look]?.[cell.box]?.[cell.colourway]
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new PackagingError(`the kit carries no grade plan for ${cellKey(cell)}`)
  }
  return plan
}

/**
 * A lane the kit's router rules out for packaging, by the model the lane draws with: the router's
 * own words, or null when the lane may be drawn.
 */
export function laneRuledOut(pk: PackagingKit, model: string): string | null {
  const row = pk.router.find((r) => r.model === model)
  if (row && /not a lane/i.test(row.lane)) {
    return `${row.name ?? model} is not a lane for packaging in the kit's router: ${row.when ?? 'ruled out'}`
  }
  return null
}
