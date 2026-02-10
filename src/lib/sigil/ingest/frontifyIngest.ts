/**
 * Frontify ingestion pipeline for Sigil: fetch approved assets and decompose to LayoutDNA.
 */

import { fetchFrontifyAssetsForSigil } from '../../frontify/client'
import { decomposeAdToLayoutDNA } from '../decompose/adDecomposer'
import type { LayoutDNA } from '../schema/layoutDNA'

export interface IngestOptions {
  projectId?: string
  limit?: number
  requiredTags?: string[]
  /** Optional: skip decomposition and only list assets (discovery mode). */
  discoveryOnly?: boolean
}

export interface IngestResult {
  assetsFound: number
  decomposed: LayoutDNA[]
  errors: Array<{ assetId: string; error: string }>
}

/**
 * Ingest social ad assets from Frontify and decompose each to LayoutDNA.
 */
export async function ingestFromFrontify(options: IngestOptions = {}): Promise<IngestResult> {
  const { assets, total } = await fetchFrontifyAssetsForSigil({
    projectId: options.projectId,
    limit: options.limit ?? 50,
    requiredTags: options.requiredTags,
  })

  if (options.discoveryOnly) {
    return {
      assetsFound: total,
      decomposed: [],
      errors: [],
    }
  }

  const decomposed: LayoutDNA[] = []
  const errors: Array<{ assetId: string; error: string }> = []

  for (const asset of assets) {
    try {
      const dna = await decomposeAdToLayoutDNA({
        imageUrl: asset.downloadUrl || asset.previewUrl,
        sourceAssetId: asset.id,
        sourceType: 'frontify',
        metadata: {
          tags: asset.tags,
          title: asset.title,
        },
      })
      decomposed.push(dna)
    } catch (e) {
      errors.push({
        assetId: asset.id,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    assetsFound: total,
    decomposed,
    errors,
  }
}
