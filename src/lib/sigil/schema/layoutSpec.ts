/**
 * LayoutSpec — output of the Sigil layout generation step.
 * Consumed by Figma export service to create editable frames with text layers.
 * Structure only; no pixels.
 */

import type { NormalizedBBox } from './layoutDNA'

export const LAYOUT_SPEC_VERSION = '1.0.0'

/** Semantic role of a text block in the spec. */
export type LayoutSpecTextRole = 'headline' | 'subhead' | 'body' | 'cta' | 'legal' | 'product-name'

/** Single text block in the layout. */
export interface LayoutSpecTextBlock {
  id: string
  role: LayoutSpecTextRole
  /** Placeholder or actual copy (from brief). */
  content: string
  /** Position in normalized 0–1 space. */
  bbox: NormalizedBBox
  /** Font family (e.g. Avantt, Space Grotesk). */
  fontFamily: string
  /** Font weight (e.g. 400, 600, 700). */
  fontWeight: number
  /** Relative scale (1 = base). */
  scale: number
  /** Color token or hex. */
  color: string
  /** Optional max width in 0–1 for wrapping. */
  maxWidth?: number
  /** Alignment within bbox. */
  textAlign?: 'left' | 'center' | 'right'
}

/** Layout spec for one asset (one frame). */
export interface LayoutSpec {
  version: string
  /** Format id (e.g. 4x5, 9x16). */
  formatId: string
  /** Width/height in px for the target asset. */
  widthPx: number
  heightPx: number
  textBlocks: LayoutSpecTextBlock[]
  /** Optional safe-zone guide (for Figma overlay). */
  safeZone?: {
    topPx: number
    bottomPx: number
    leftPx: number
    rightPx: number
  }
  /** Rationale from the generator (for debugging/explainability). */
  rationale?: string
  /** Confidence 0–1. */
  confidence?: number
  createdAt: string
}

export function createBlankLayoutSpec(formatId: string, widthPx: number, heightPx: number): LayoutSpec {
  return {
    version: LAYOUT_SPEC_VERSION,
    formatId,
    widthPx,
    heightPx,
    textBlocks: [],
    createdAt: new Date().toISOString(),
  }
}
