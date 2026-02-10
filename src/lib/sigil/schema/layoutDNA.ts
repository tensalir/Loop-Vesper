/**
 * LayoutDNA — high-dimensional feature vector for social ad layout.
 * Each historical ad decomposes into structural, categorical, geometric, and typographic features.
 * Used for vector-space navigation and retrieval (Sigil MVP).
 */

/** Normalized bounding box in 0–1 coordinate space (relative to asset dimensions). */
export interface NormalizedBBox {
  x: number
  y: number
  width: number
  height: number
}

/** Role of a text block in the layout. */
export type TextBlockRole =
  | 'headline'
  | 'subhead'
  | 'body'
  | 'cta'
  | 'legal'
  | 'product-name'
  | 'other'

/** Single text block with position and role. */
export interface TextAnchorZone {
  role: TextBlockRole
  bbox: NormalizedBBox
  /** Approximate character count (for density/complexity). */
  charCount?: number
  /** Inferred or detected font scale tier (e.g. 1 = largest). */
  scaleTier?: number
}

/** Layout family / composition pattern. */
export type LayoutFamily =
  | 'top-heavy'
  | 'centered'
  | 'l-shaped'
  | 'full-bleed'
  | 'split'
  | 'minimal'
  | 'grid'
  | 'other'

/** Structural features (continuous, 0–1 or normalized). */
export interface LayoutDNAStructural {
  /** Ratio of area occupied by text to total area. */
  textDensity: number
  /** Prominence of CTA (size/position score). */
  ctaProminence: number
  /** Ratio of negative/whitespace to total area. */
  whitespaceRatio: number
  /** Depth of typographic hierarchy (number of distinct levels). */
  hierarchyDepth: number
  /** Ratio of dominant visual (product/hero) to total area. */
  visualDominanceRatio: number
  /** Number of distinct text blocks. */
  textBlockCount: number
  /** Distribution of negative space (e.g. top/bottom/left/right balance). */
  negativeSpaceDistribution?: {
    top: number
    bottom: number
    left: number
    right: number
  }
}

/** Categorical features for filtering. */
export interface LayoutDNACategorical {
  channel: string
  aspectRatio: string
  campaignObjective?: string
  language?: string
  layoutFamily: LayoutFamily
}

/** Geometric features. */
export interface LayoutDNAGeometric {
  textAnchorZones: TextAnchorZone[]
  /** Offset of focal region from center (normalized). */
  focalRegionOffset?: { x: number; y: number }
  /** Optional mask or bbox of product region (avoid text overlay). */
  productRegionBbox?: NormalizedBBox
}

/** Typographic features. */
export interface LayoutDNATypographic {
  /** Relative scale of headline (e.g. 1–3). */
  headlineScale: number
  /** Relative scale of body. */
  bodyScale: number
  /** Contrast between heaviest and lightest weight. */
  fontWeightContrast?: number
  /** Type-to-background contrast ratio (e.g. WCAG). */
  typeColorContrastRatio?: number
}

/** Full LayoutDNA vector for one asset. */
export interface LayoutDNA {
  version: string
  sourceAssetId: string
  sourceType: 'frontify' | 'figma'
  structural: LayoutDNAStructural
  categorical: LayoutDNACategorical
  geometric: LayoutDNAGeometric
  typographic: LayoutDNATypographic
  /** Optional semantic embedding vector for similarity search. */
  embedding?: number[]
  /** Extracted metadata from source (tags, campaign, etc.). */
  metadata?: Record<string, unknown>
  createdAt: string
}

const LAYOUT_DNA_VERSION = '1.0.0'

/** Create a blank LayoutDNA with defaults (for partial fill during decomposition). */
export function createBlankLayoutDNA(sourceAssetId: string, sourceType: 'frontify' | 'figma'): LayoutDNA {
  return {
    version: LAYOUT_DNA_VERSION,
    sourceAssetId,
    sourceType,
    structural: {
      textDensity: 0,
      ctaProminence: 0,
      whitespaceRatio: 0.5,
      hierarchyDepth: 0,
      visualDominanceRatio: 0,
      textBlockCount: 0,
    },
    categorical: {
      channel: 'unknown',
      aspectRatio: '1:1',
      layoutFamily: 'other',
    },
    geometric: {
      textAnchorZones: [],
    },
    typographic: {
      headlineScale: 1,
      bodyScale: 0.75,
    },
    createdAt: new Date().toISOString(),
  }
}

/** Serialize LayoutDNA to a flat vector for similarity/distance (structural + key typographic only). */
export function layoutDNAToVector(dna: LayoutDNA): number[] {
  const s = dna.structural
  const t = dna.typographic
  return [
    s.textDensity,
    s.ctaProminence,
    s.whitespaceRatio,
    s.hierarchyDepth,
    s.visualDominanceRatio,
    s.textBlockCount,
    t.headlineScale,
    t.bodyScale,
    ...(s.negativeSpaceDistribution
      ? [s.negativeSpaceDistribution.top, s.negativeSpaceDistribution.bottom, s.negativeSpaceDistribution.left, s.negativeSpaceDistribution.right]
      : [0.25, 0.25, 0.25, 0.25]),
  ]
}
