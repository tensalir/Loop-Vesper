/**
 * Designer correction capture: record deltas when designers modify Sigil output in Figma.
 * Feeds back into the layout space as weighted adjustments (desire paths).
 * Stub: full implementation will parse Figma webhook or export diff and update vector index.
 */

import type { LayoutSpec } from '../schema/layoutSpec'
import type { LayoutDNA } from '../schema/layoutDNA'

export interface DesignerCorrection {
  /** Original spec that was exported. */
  originalSpecId: string
  /** Modified spec or delta (e.g. text block position/size changes). */
  correctedSpec: LayoutSpec
  /** Optional: source (e.g. figma_webhook, manual_edit). */
  source?: string
  createdAt: string
}

/**
 * Record a designer correction for later ingestion into the layout space.
 * In production, this would persist to DB and a job would update LayoutDNA clusters.
 */
export function recordCorrection(correction: DesignerCorrection): void {
  // Stub: log or persist to DB; background job would compute delta and adjust vector index
  console.debug('[Sigil] Designer correction recorded', {
    originalSpecId: correction.originalSpecId,
    source: correction.source,
    blockCount: correction.correctedSpec.textBlocks.length,
  })
}

/**
 * Compute a simple delta between original and corrected spec (for feedback weighting).
 * Returns a partial structural delta that can be used to nudge LayoutDNA.
 */
export function computeSpecDelta(
  original: LayoutSpec,
  corrected: LayoutSpec
): Partial<LayoutDNA['structural']> {
  const ob = original.textBlocks
  const cb = corrected.textBlocks
  if (ob.length === 0 || cb.length === 0) return {}

  const avgY = (blocks: LayoutSpec['textBlocks']) =>
    blocks.reduce((s, b) => s + b.bbox.y + b.bbox.height / 2, 0) / blocks.length
  const avgH = (blocks: LayoutSpec['textBlocks']) =>
    blocks.reduce((s, b) => s + b.bbox.height, 0) / blocks.length

  return {
    textBlockCount: cb.length,
    whitespaceRatio: 1 - cb.reduce((s, b) => s + b.bbox.width * b.bbox.height, 0),
  }
}
