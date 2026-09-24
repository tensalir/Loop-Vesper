/**
 * What the read-only creative tools say, as pure functions of the kit (and,
 * for references, of the pins' state). The MCP handlers in
 * `src/lib/headless/tools/creative-read.ts` are thin wrappers around these.
 */

import type { Kit, KitProduct } from './kit-schema'
import type { LoadedKit } from './kit'
import { kitPins, usablePin, type PinRow, type PinSpec } from './pins'
import { servedProducts, resolveProduct } from './products'

export const TEXT_CAP = 20_000

/** The Vesper tools a product of each kind is worked with; only those this Vesper has are listed. */
export const TOOLS_BY_KIND: Record<KitProduct['kind'], string[]> = {
  'product-imagery': ['get_product_references', 'generate_product_image', 'grade_image', 'record_grade', 'record_verdict'],
  packaging: ['get_product_references', 'packaging_list_looks', 'packaging_mockup', 'packaging_finish', 'grade_image', 'record_verdict'],
  cmf: ['get_product_references', 'cmf_list', 'cmf_prompt', 'cmf_render', 'grade_image', 'cmf_check_pdf', 'record_verdict'],
}

export function cap(text: string, max: number = TEXT_CAP): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[cut at ${max} characters of ${text.length}]`
}

export function kitHeader(loaded: Pick<LoadedKit, 'kit' | 'ref' | 'commit' | 'stale' | 'staleReason'>) {
  return {
    kit_version: loaded.kit.version,
    kit_tag: loaded.kit.tag,
    kit_ref: loaded.ref,
    kit_commit: loaded.commit,
    kit_stale: loaded.stale,
    ...(loaded.stale ? { kit_stale_reason: loaded.staleReason } : {}),
  }
}

export interface ProductListing {
  slug: string
  name: string
  kind: KitProduct['kind']
  status: KitProduct['status']
  command: string
  aliases: string[]
  rubric_version: string | null
  reporting_only: boolean
  colourways: string[]
  views: string[]
  looks: string[]
  verdict_route: string
  deciders: Array<{ role: string | null; name: string | null }>
  tools: string[]
}

export function listProducts(kit: Kit, available: (tool: string) => boolean, opts: { isAdmin?: boolean } = {}): ProductListing[] {
  return servedProducts(kit, opts).map(({ slug, product }) => {
    const p = product as KitProduct & { looks?: Record<string, unknown> }
    return {
      slug,
      name: product.name,
      kind: product.kind,
      status: product.status,
      command: product.command,
      aliases: product.aliases,
      rubric_version: product.rubric.version,
      reporting_only: product.rubric.reporting_only,
      colourways: product.grading?.colourways ?? [],
      views: product.grading?.views ?? [],
      looks: p.looks ? Object.keys(p.looks) : [],
      verdict_route: product.verdicts.route,
      deciders: product.deciders.map((d) => ({
        role: (d.role as string | undefined) ?? null,
        name: (d.name as string | null | undefined) ?? null,
      })),
      tools: TOOLS_BY_KIND[product.kind].filter(available),
    }
  })
}

export function rubricMarkdown(slug: string, product: KitProduct): string {
  const r = product.rubric
  const lines = [
    `# ${product.name}: rubric ${r.version ?? '?'}${r.reporting_only ? ' (reporting only: no check blocks)' : ''}`,
    '',
    `Chat reads families ${r.chat_families.join(', ') || 'all'}. The decider decides; a grade is a floor, never an approval.`,
    '',
    '| ID | Severity | Plain words | Check | Fails when |',
    '|---|---|---|---|---|',
    ...r.checks.map((c) => `| ${c.id} | ${c.severity} | ${c.caption ?? ''} | ${c.check.replace(/\|/g, '/')} | ${c.fails_when.replace(/\|/g, '/')} |`),
    '',
    '## Grading rules',
    '',
    r.grading_rules,
  ]
  return cap(lines.join('\n'))
}

export type KitSection = 'summary' | 'products' | 'prompting' | 'feedback' | `rubric:${string}`

export function kitSection(
  loaded: LoadedKit,
  section: string,
  available: (tool: string) => boolean,
  opts: { isAdmin?: boolean } = {}
): { text: string; structured: Record<string, unknown> } {
  const kit = loaded.kit
  const header = kitHeader(loaded)
  if (section === 'summary') {
    const products = listProducts(kit, available, opts).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind, status: p.status, rubric: p.rubric_version }))
    const text = [
      `Creative kit ${kit.version} (${loaded.ref}, commit ${loaded.commit.slice(0, 7)})${loaded.stale ? ` — STALE: ${loaded.staleReason}` : ''}.`,
      `Products: ${products.map((p) => `${p.name} (${p.slug}, ${p.status}, rubric ${p.rubric ?? '?'})`).join('; ')}.`,
      kit.prompting ? `Prompting: genai-prompting ${kit.prompting.version ?? '?'}, Loop edition, ${kit.prompting.lessons.length} lessons.` : 'Prompting: not in this kit.',
      `Judges: ${kit.judges.surfaces.join(', ')}; Vesper's reads are labelled '${kit.judges.vesper_surface}' and never pooled with another judge.`,
      `Comment lines are written [${kit.comment_line.prefix} <product> <date>] and read under ${[kit.comment_line.prefix, ...kit.comment_line.reads_also].join(' or ')}.`,
    ].join('\n')
    return { text, structured: { ...header, products, prompting_version: kit.prompting?.version ?? null } }
  }
  if (section === 'products') {
    const products = listProducts(kit, available, opts)
    return { text: cap(JSON.stringify(products, null, 2)), structured: { ...header, products } }
  }
  if (section === 'prompting') {
    if (!kit.prompting) return { text: 'This kit carries no prompting skill.', structured: { ...header, prompting: null } }
    const p = kit.prompting
    return {
      text: cap(p.skill_body),
      structured: { ...header, version: p.version, sha256: p.sha256, lessons: p.lessons.map((l) => l.id), settings: p.settings },
    }
  }
  if (section === 'feedback') {
    return { text: cap(JSON.stringify(kit.feedback, null, 2)), structured: { ...header, feedback: kit.feedback } }
  }
  if (section.startsWith('rubric:')) {
    const { slug, product } = resolveProduct(kit, section.slice('rubric:'.length), opts)
    return {
      text: rubricMarkdown(slug, product),
      structured: { ...header, product: slug, rubric_version: product.rubric.version, checks: product.rubric.checks },
    }
  }
  throw new Error(`Unknown section '${section}'. Use summary, products, prompting, feedback or rubric:<product>.`)
}

// ------------------------------------------------------------------ references

export interface ReferenceQuery {
  product: string
  purpose: 'grade' | 'generate'
  colourway?: string
  view?: string
  look?: string
  scene?: string
  /** CMF: the clown key, e.g. case-experience2--front. */
  clown?: string
}

export interface ReferenceItem {
  n: number
  pin_id: string
  title: string | null
  roles: string[]
  colourway: string | null
  sha256: string
  usable: boolean
  status: string
  why_not: string | null
}

export interface ReferencePlan {
  product: string
  purpose: 'grade' | 'generate'
  key: Record<string, string>
  references: ReferenceItem[]
  missing: string[]
  assumed: string[]
}

function pick<T>(map: Record<string, T> | undefined, key: string | undefined, fallback: string | undefined, label: string, assumed: string[]): [string, T] {
  if (!map || Object.keys(map).length === 0) throw new Error(`the kit has no ${label} map for this`)
  if (key) {
    const hit = Object.keys(map).find((k) => k.toLowerCase() === key.toLowerCase())
    if (!hit) throw new Error(`no ${label} '${key}'; the kit has ${Object.keys(map).join(', ')}`)
    return [hit, map[hit]]
  }
  const chosen = fallback && map[fallback] !== undefined ? fallback : Object.keys(map)[0]
  assumed.push(`${label} ${chosen} (none given)`)
  return [chosen, map[chosen]]
}

/**
 * The pinned references a grade or a draw attaches, in the order they are
 * attached, with whether each can be used now. Reads the kit's maps; never
 * invents an order.
 */
export function referencePlan(
  kit: Kit,
  query: ReferenceQuery,
  rows: readonly PinRow[],
  opts: { isAdmin?: boolean } = {}
): ReferencePlan {
  const { slug, product } = resolveProduct(kit, query.product, opts)
  const specs = kitPins(kit).filter((p) => p.product === slug)
  const specById = new Map(specs.map((s) => [s.pinId, s]))
  const rowByKey = new Map(rows.map((r) => [`${r.pinId}@${r.sha256}`, r]))
  const assumed: string[] = []
  const key: Record<string, string> = {}
  let ids: string[] = []

  if (product.kind === 'cmf') {
    if (!query.clown) throw new Error('CMF references are a clown: name the clown key (e.g. case-experience2--front); cmf_list names them')
    const clown = specs.find((s) => s.pinId === query.clown)
    if (!clown) throw new Error(`no clown '${query.clown}' in the kit`)
    ids = [clown.pinId]
    key.clown = clown.pinId
  } else if (product.kind === 'packaging') {
    const attach = product.references?.attach
    const [look, scenes] = pick(attach, query.look, undefined, 'look', assumed)
    const [scene, list] = pick(scenes, query.scene ?? query.view, 'both', 'scene', assumed)
    ids = list
    Object.assign(key, { look, scene })
  } else {
    const generation = (product.generation ?? {}) as { attach?: Record<string, Record<string, string[]>> }
    const attach = query.purpose === 'generate' ? generation.attach : product.references?.attach
    const [colourway, views] = pick(attach, query.colourway, product.grading?.default_colourway, 'colourway', assumed)
    const [view, list] = pick(views, query.view, 'frontal', 'view', assumed)
    ids = list
    Object.assign(key, { colourway, view })
  }

  const missing: string[] = []
  const references: ReferenceItem[] = ids.map((id, i) => {
    const spec: PinSpec | undefined = specById.get(id)
    if (!spec) {
      missing.push(`${id}: named in the attach map but not a pin with a sha256 in the kit`)
      return { n: i + 1, pin_id: id, title: null, roles: [], colourway: null, sha256: '', usable: false, status: 'unknown', why_not: 'no sha256 in the kit' }
    }
    const row = rowByKey.get(`${spec.pinId}@${spec.sha256}`) ?? null
    const usable = usablePin(row, spec)
    const status = row?.status ?? 'pending'
    const whyNot = usable
      ? null
      : status === 'sha_mismatch'
        ? 'its bytes are not the kit\'s'
        : status === 'needs_upload'
          ? 'an admin has not uploaded it yet'
          : status === 'needs_derived'
            ? 'too large for a model until its derived copy is uploaded'
            : status === 'missing'
              ? 'not found at its source'
              : 'not pinned yet'
    if (!usable) missing.push(`${spec.title ?? spec.pinId}: ${whyNot}`)
    const kitPin = product.references?.pins.find((p) => p.id === spec.pinId)
    return {
      n: i + 1,
      pin_id: spec.pinId,
      title: spec.title,
      roles: query.purpose === 'generate' ? kitPin?.generate_roles ?? [] : kitPin?.roles ?? [],
      colourway: kitPin?.colourway ?? null,
      sha256: spec.sha256,
      usable,
      status,
      why_not: whyNot,
    }
  })
  return { product: slug, purpose: query.purpose, key, references, missing, assumed }
}
