/**
 * A CMF render from Claude: the payload the repository's `scripts/prompt_build.py` wrote for a
 * tab, column and clown key, sent the way `scripts/render.py` sends it. Before anything is paid for,
 * the same refusals `render.py` makes:
 *
 *   - exactly one image, the clown; the clown is the only image the model sees
 *   - a draft key is refused (a zone names no component)
 *   - the payload's template sha256 is the kit's template block
 *   - the prompt's sha256 is the payload's `prompt_sha256`, and the kit's for that payload
 *   - the clown's bytes, read from Vesper's pinned copy, have the payload's clown sha256, else
 *     "the clown changed; its key must be sampled again"
 *
 * Then: the aspect the payload names, 2K unless asked, one model call per image, no rewrite and no
 * lighting clause (the prompt is sent as it is, byte for byte). Pure except `executeCmfDraws`,
 * whose model call is injected.
 */

import crypto from 'crypto'
import type { CmfKit, CmfPayloadEntry } from './kit-cmf'
import { CmfError } from './kit-cmf'

export const CMF_DRAW_DEADLINE_MS = 280_000
export const CMF_MAX_DRAWS = 4

export interface CmfPayload {
  schema?: number
  tab: string
  column: string
  sku_name?: string | null
  sku_id?: string
  product_slug?: string | null
  key: { id: string; sha256?: string | null; confirmed_by?: string | null }
  key_confirmed?: boolean
  clown: { id: string; sha256: string; width?: number; height?: number; aspect?: string | null }
  template_sha256: string
  prompt: string
  prompt_sha256: string
  lines?: unknown[]
  omitted?: Array<{ component: string; why: string }>
  image?: { sha256?: string; count?: number }
  warnings?: string[]
  [k: string]: unknown
}

export type CmfLane = 'final' | 'draft'

export interface CmfRenderPlan {
  payloadId: string
  tab: string
  column: string
  skuName: string | null
  key: string
  keyConfirmed: boolean
  clown: CmfPayload['clown']
  prompt: string
  promptSha256: string
  lane: CmfLane
  model: string
  n: number
  aspect: string
  imageSize: string
  warnings: string[]
  omitted: Array<{ component: string; why: string }>
}

function sha256(text: string | Buffer): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/** The model for a lane, from the kit's CMF generation models. */
export function cmfModelForLane(cmf: CmfKit, lane: CmfLane): string {
  const gen = (cmf.product.generation ?? {}) as { models?: Array<{ lane: string; model: string }> }
  const row = (gen.models ?? []).find((m) => m.lane === lane)
  if (!row) throw new CmfError(`the kit names no CMF model for the '${lane}' lane`)
  return row.model
}

/** Every check `render.py` makes before a call, on the payload and the kit. Throws the first refusal with all reasons. */
export function planCmfRender(
  cmf: CmfKit,
  entry: CmfPayloadEntry,
  payloadBytes: Buffer,
  args: { lane?: CmfLane; n?: number; image_size?: '1K' | '2K' | '4K' }
): CmfRenderPlan {
  const id = `${entry.spec}--${entry.column}--${entry.key}`
  if (entry.status !== 'ready') {
    throw new CmfError(`no prompt for ${entry.tab} column ${entry.column} through '${entry.key}': ${(entry.reasons ?? []).join('; ') || 'refused'}`)
  }
  const payload = JSON.parse(payloadBytes.toString('utf8')) as CmfPayload
  const reasons: string[] = []
  const key = cmf.keys[entry.key]
  if (!key) reasons.push(`the key '${entry.key}' is not in the kit`)
  else if (key.draft) reasons.push(`the key '${entry.key}' is a draft: a zone names no component`)
  const count = payload.image?.count ?? 1
  if (count !== 1) reasons.push(`the payload names ${count} images; a CMF render sends the clown and nothing else`)
  if (!cmf.template) reasons.push('the kit carries no CMF template')
  else if (payload.template_sha256 !== cmf.template.block_sha256) {
    reasons.push(`the payload was built from template ${payload.template_sha256.slice(0, 12)}, the kit's template is ${cmf.template.block_sha256.slice(0, 12)}: rebuild the payloads`)
  }
  const promptSha = sha256(payload.prompt)
  if (promptSha !== payload.prompt_sha256) reasons.push('the prompt is not the one the payload hashed')
  if (entry.prompt_sha256 && promptSha !== entry.prompt_sha256) reasons.push("the prompt is not the one the kit names for this payload")
  if (!payload.clown?.sha256) reasons.push('the payload names no clown sha256')
  else if (key?.clown?.sha256 && key.clown.sha256 !== payload.clown.sha256) {
    reasons.push(`the key's clown is ${key.clown.sha256.slice(0, 12)}, the payload's ${payload.clown.sha256.slice(0, 12)}: the clown changed; its key must be sampled again`)
  }
  if (reasons.length) throw new CmfError(`not sent (nothing was paid for): ${reasons.join('; ')}`)
  const lane = args.lane ?? 'final'
  return {
    payloadId: id,
    tab: payload.tab,
    column: payload.column,
    skuName: payload.sku_name ?? null,
    key: entry.key,
    keyConfirmed: payload.key_confirmed === true,
    clown: payload.clown,
    prompt: payload.prompt,
    promptSha256: promptSha,
    lane,
    model: cmfModelForLane(cmf, lane),
    n: Math.max(1, Math.min(CMF_MAX_DRAWS, args.n ?? 1)),
    aspect: payload.clown.aspect || '1:1',
    imageSize: args.image_size ?? (((cmf.product.generation ?? {}) as { image_size?: string }).image_size || '2K'),
    warnings: payload.warnings ?? [],
    omitted: payload.omitted ?? [],
  }
}

/** The clown's bytes against the payload, just before the call. */
export function checkClownBytes(plan: Pick<CmfRenderPlan, 'clown'>, bytes: Buffer): void {
  const got = sha256(bytes)
  if (got !== plan.clown.sha256) {
    throw new CmfError(
      `the clown ${plan.clown.id} in Vesper has sha256 ${got.slice(0, 12)}, the payload was built from ${plan.clown.sha256.slice(0, 12)}: the clown changed; its key must be sampled again. Nothing was paid for.`
    )
  }
}

export interface CmfDrawn {
  index: number
  bytes: Buffer
  mimeType: string
  model: string
  settings: Record<string, unknown>
}

/** One call per image, all at once; the clown the only image; a failed image is reported. */
export async function executeCmfDraws(
  plan: CmfRenderPlan,
  drawOne: (index: number, deadline: number) => Promise<Omit<CmfDrawn, 'index'>>,
  now: () => number = Date.now
): Promise<{ images: CmfDrawn[]; failures: string[] }> {
  const deadline = now() + CMF_DRAW_DEADLINE_MS
  const settled = await Promise.allSettled(Array.from({ length: plan.n }, (_, i) => drawOne(i + 1, deadline).then((d) => ({ ...d, index: i + 1 }))))
  const images: CmfDrawn[] = []
  const failures: string[] = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') images.push(s.value)
    else failures.push(`render ${i + 1}: ${(s.reason as Error)?.message || 'failed'}`)
  })
  if (!images.length) throw new CmfError(`no render came back (${failures.join('; ')})`)
  return { images, failures }
}

/** One manifest line per render, shaped like the line `render.py` writes, with `source: vesper`. */
export function cmfManifestLine(plan: CmfRenderPlan, draw: { index: number; file: string; model: string; settings: Record<string, unknown>; timestamp: string }): Record<string, unknown> {
  return {
    file: draw.file,
    source: 'vesper',
    tab: plan.tab,
    column: plan.column,
    sku_name: plan.skuName,
    key: plan.key,
    key_confirmed: plan.keyConfirmed,
    clown: { id: plan.clown.id, sha256: plan.clown.sha256 },
    lane: plan.lane,
    model: draw.model,
    draw: draw.index,
    settings: draw.settings,
    prompt: plan.prompt,
    prompt_sha256: plan.promptSha256,
    timestamp: draw.timestamp,
  }
}

/**
 * What one model call is sent: the plan's model, the payload's prompt as it is, the clown and
 * nothing else, the payload's aspect and the size. The only place a CMF draw's request is made.
 */
export function cmfDrawRequest<P>(plan: CmfRenderPlan, clownPart: P): { model: string; prompt: string; references: P[]; aspect: string; size: string } {
  return { model: plan.model, prompt: plan.prompt, references: [clownPart], aspect: plan.aspect, size: plan.imageSize }
}
