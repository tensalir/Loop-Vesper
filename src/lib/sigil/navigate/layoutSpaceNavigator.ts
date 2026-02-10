/**
 * Layout space navigator: vector index + hybrid retrieval.
 * Returns a region of the layout space (nearest neighbours) for a given creative intent + optional visual constraints.
 */

import type { LayoutDNA, CreativeIntent } from '../schema'
import { createBlankLayoutDNA, layoutDNAToVector } from '../schema/layoutDNA'

export interface LayoutSpaceIndexEntry {
  id: string
  dna: LayoutDNA
  vector: number[]
}

export interface NavigatorFilter {
  channel?: string
  aspectRatio?: string
  layoutFamily?: string
  language?: string
}

export interface NavigatorOptions {
  /** Max number of neighbours to return. */
  k?: number
  /** Hard filters (all must match). */
  filter?: NavigatorFilter
  /** Optional: only consider DNAs with embedding (if we add semantic embeddings later). */
  useEmbedding?: boolean
}

/** In-memory vector index for LayoutDNA (MVP). */
export class LayoutSpaceIndex {
  private entries: LayoutSpaceIndexEntry[] = []

  add(dna: LayoutDNA): void {
    const vector = layoutDNAToVector(dna)
    this.entries.push({
      id: dna.sourceAssetId,
      dna,
      vector,
    })
  }

  addMany(dnas: LayoutDNA[]): void {
    for (const dna of dnas) this.add(dna)
  }

  size(): number {
    return this.entries.length
  }

  /** Euclidean distance between two vectors. */
  private static distance(a: number[], b: number[]): number {
    if (a.length !== b.length) return Infinity
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i]
      sum += d * d
    }
    return Math.sqrt(sum)
  }

  /**
   * Find nearest neighbours to a query vector, with optional hard filters.
   */
  query(
    queryVector: number[],
    options: NavigatorOptions = {}
  ): LayoutSpaceIndexEntry[] {
    const k = options.k ?? 5
    const filter = options.filter ?? {}

    let candidates = this.entries

    if (filter.channel) {
      candidates = candidates.filter(
        (e) => e.dna.categorical.channel === filter.channel
      )
    }
    if (filter.aspectRatio) {
      candidates = candidates.filter(
        (e) => e.dna.categorical.aspectRatio === filter.aspectRatio
      )
    }
    if (filter.layoutFamily) {
      candidates = candidates.filter(
        (e) => e.dna.categorical.layoutFamily === filter.layoutFamily
      )
    }
    if (filter.language) {
      candidates = candidates.filter(
        (e) => (e.dna.categorical.language ?? 'en') === filter.language
      )
    }

    const withDistance = candidates.map((e) => ({
      entry: e,
      dist: LayoutSpaceIndex.distance(queryVector, e.vector),
    }))
    withDistance.sort((a, b) => a.dist - b.dist)
    return withDistance.slice(0, k).map((x) => x.entry)
  }
}

/**
 * Build a query vector from creative intent (target structural preferences).
 * Uses intent formatId/channel to infer target layout region; structural part is neutral until we have user steering.
 */
export function intentToQueryVector(intent: CreativeIntent, defaultStructural?: Partial<LayoutDNA['structural']>): number[] {
  const dna = createBlankLayoutDNA('query', 'frontify')
  const s = defaultStructural ?? {}
  dna.structural = {
    ...dna.structural,
    textDensity: s.textDensity ?? 0.25,
    ctaProminence: s.ctaProminence ?? 0.6,
    whitespaceRatio: s.whitespaceRatio ?? 0.5,
    hierarchyDepth: s.hierarchyDepth ?? 2,
    visualDominanceRatio: s.visualDominanceRatio ?? 0.5,
    textBlockCount: s.textBlockCount ?? 3,
    negativeSpaceDistribution: s.negativeSpaceDistribution,
  }
  dna.categorical = {
    channel: intent.channel,
    aspectRatio: intent.formatId === '9x16' ? '9:16' : intent.formatId === '4x5' ? '4:5' : '1:1',
    layoutFamily: 'other',
  }
  return layoutDNAToVector(dna)
}

/**
 * Navigate the layout space: given an index, creative intent, and optional query vector override,
 * return the best-matching LayoutDNA entries (candidate region for the Skill).
 */
export function navigateLayoutSpace(
  index: LayoutSpaceIndex,
  intent: CreativeIntent,
  options: NavigatorOptions = {}
): LayoutSpaceIndexEntry[] {
  const filter: NavigatorFilter = {
    ...options.filter,
    aspectRatio: intent.formatId === '9x16' ? '9:16' : intent.formatId === '4x5' ? '4:5' : options.filter?.aspectRatio,
    channel: options.filter?.channel ?? intent.channel,
    language: options.filter?.language ?? intent.language,
  }
  const queryVector = intentToQueryVector(intent)
  return index.query(queryVector, { ...options, filter })
}
