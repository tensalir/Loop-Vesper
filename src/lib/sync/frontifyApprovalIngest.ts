/**
 * Frontify approved-final lineage: link assets to SyncLink timeline and mark ApprovalEvents.
 * Triggers Sigil LayoutDNA ingestion only from approved assets (e.g. tagged "approved" or "Shared with Gain").
 */

import { fetchFrontifyAssetsForSigil } from '@/lib/frontify/client'
import { persistEvent, toApprovalEvent, resolveOrCreateLink } from '@/lib/sync/normalize'
import type { CreativeWorkItem } from '@/lib/sync/contracts'
import { ingestFromFrontify } from '@/lib/sigil/ingest/frontifyIngest'

export interface FrontifyApprovalIngestOptions {
  projectId?: string
  limit?: number
  /** Tag(s) that indicate approved/live assets (e.g. "approved", "Shared with Gain"). */
  approvedTags?: string[]
  /** If true, run Sigil decomposition on the approved assets after recording approval. */
  triggerSigilIngest?: boolean
}

export interface FrontifyApprovalIngestResult {
  assetsProcessed: number
  approvalEventsInserted: number
  linksCreated: number
  sigilIngest?: { assetsFound: number; decomposed: number; errors: number }
}

/**
 * Fetch Frontify assets (optionally filtered by approved tags), record ApprovalEvents and SyncLinks,
 * and optionally trigger Sigil ingest for those assets only.
 */
export async function runFrontifyApprovalIngest(
  options: FrontifyApprovalIngestOptions = {}
): Promise<FrontifyApprovalIngestResult> {
  const approvedTags = options.approvedTags ?? ['approved']
  const { assets, total } = await fetchFrontifyAssetsForSigil({
    projectId: options.projectId,
    limit: options.limit ?? 100,
    requiredTags: approvedTags.length ? approvedTags : undefined,
  })

  let approvalEventsInserted = 0
  let linksCreated = 0

  for (const asset of assets) {
    const link: CreativeWorkItem = { frontifyAssetId: asset.id }
    const { linkId, created } = await resolveOrCreateLink(link)
    if (created) linksCreated++

    const approval = toApprovalEvent(
      asset.id,
      'approved',
      asset.modifiedAt || asset.createdAt || new Date().toISOString(),
      { link, payload: { title: asset.title, tags: asset.tags } }
    )
    const result = await persistEvent({ payload: approval, link })
    if (result.inserted) approvalEventsInserted++
  }

  let sigilIngest: FrontifyApprovalIngestResult['sigilIngest'] | undefined
  if (options.triggerSigilIngest && approvedTags.length > 0) {
    const ingest = await ingestFromFrontify({
      projectId: options.projectId,
      limit: options.limit ?? 100,
      requiredTags: approvedTags,
    })
    sigilIngest = {
      assetsFound: ingest.assetsFound,
      decomposed: ingest.decomposed.length,
      errors: ingest.errors.length,
    }
  }

  return {
    assetsProcessed: total,
    approvalEventsInserted,
    linksCreated,
    sigilIngest,
  }
}
