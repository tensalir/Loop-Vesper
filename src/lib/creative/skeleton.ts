/**
 * A Loop product's prompt, filled by code from its skeleton, never rewritten.
 *
 * A port of `fill_skeleton` in the plugin repository's `tools/kit.py`
 * (contract: `docs/kit.md`, "A skeleton is filled, never rewritten"). The kit
 * carries the skeleton once per number of attached references
 * (`generation.skeleton.by_refs`), with `{{slot}}` markers; each marker is
 * replaced by the caller's value verbatim. The kit's conformance file holds
 * the prompt the product's own `generate.build_prompt` writes for sample
 * inputs, and a test holds this function to every one, byte for byte.
 *
 * The Eclipse skeleton exists for one and two references: the render is
 * always attached, so none is never offered, and past two the product's own
 * builder writes the two-reference prompt (`build_prompt` special-cases only
 * zero and one).
 */

import type { KitProduct } from './kit-schema'

export const SKELETON_SLOTS = ['colourway', 'scene', 'light', 'format'] as const
export type SkeletonSlot = (typeof SKELETON_SLOTS)[number]

export interface SkeletonInputs {
  n_refs: number
  colourway: string
  scene: string
  light: string
  format: string
}

export class SkeletonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkeletonError'
  }
}

interface KitSkeleton {
  version?: string | null
  by_refs: Record<string, string>
  fill_slots: Record<string, string>
}

export function kitSkeleton(product: KitProduct): KitSkeleton {
  const generation = (product.generation ?? {}) as { skeleton?: Partial<KitSkeleton> | null }
  const sk = generation.skeleton
  if (!sk?.by_refs || !sk.fill_slots || Object.keys(sk.by_refs).length === 0) {
    throw new SkeletonError(`${product.name} has no skeleton in the kit to fill`)
  }
  return { version: sk.version ?? null, by_refs: sk.by_refs, fill_slots: sk.fill_slots }
}

/** The `by_refs` key for this many attached references. */
export function skeletonKey(sk: Pick<KitSkeleton, 'by_refs'>, nRefs: number): string {
  if (sk.by_refs[String(nRefs)] !== undefined) return String(nRefs)
  const keys = Object.keys(sk.by_refs)
    .map(Number)
    .filter((k) => Number.isFinite(k) && k <= nRefs)
    .sort((a, b) => b - a)
  if (keys.length === 0) throw new SkeletonError(`the kit has no skeleton for ${nRefs} reference(s)`)
  return String(keys[0])
}

/**
 * The prompt for these inputs. Refuses a value holding a newline or a slot
 * marker, and a result still carrying a `{{slot}}` or a `[placeholder]`.
 */
export function fillSkeleton(product: KitProduct, inputs: SkeletonInputs): string {
  const sk = kitSkeleton(product)
  const key = skeletonKey(sk, inputs.n_refs)
  let text = sk.by_refs[key]
  for (const [slot, token] of Object.entries(sk.fill_slots)) {
    const value = String((inputs as unknown as Record<string, unknown>)[slot] ?? '')
    if (value.includes('\n') || value.includes('{{')) {
      throw new SkeletonError(`the ${slot} value holds a newline or a slot marker`)
    }
    text = text.split(token).join(value)
  }
  if (/\{\{\w+\}\}/.test(text) || /\[[^\]]{4,}\]/.test(text)) {
    throw new SkeletonError('the skeleton still carries a placeholder')
  }
  return text
}
