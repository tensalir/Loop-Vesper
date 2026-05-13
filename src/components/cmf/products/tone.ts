/**
 * Coverage + lifecycle tone helpers shared by the products dialog
 * subtree.
 *
 * Two distinct vocabularies converge here:
 *
 *   - **Coverage tones** (`productTone`) — drive the rail dot and the
 *     per-product status badge. Derived from `summary.coverage` (the
 *     ratio of clown-matched SKUs).
 *   - **Lifecycle tones** (`packetStatusTone`) — the per-packet badge
 *     in the workbook tab. Maps the database `status` enum into the
 *     shared `CmfStatusTone` palette.
 *
 * The label dictionary lives next door because the rail/badge
 * surfaces both consume it. The split-out file means the per-tab
 * components don't need to import from each other or from the shell;
 * they import from `./tone` directly.
 */

import type { ProductSummary } from '@/lib/cmf/product-summary'
import type { CmfStatusTone } from '../CmfStatusBadge'

export const PRODUCT_CATEGORY_LABEL: Record<ProductSummary['category'], string> = {
  earplug: 'Earplug',
  sensewear: 'Sensewear',
  case: 'Case',
  other: 'Uncatalogued',
}

/**
 * Coverage-driven tone for a product summary. Drives both the rail
 * dot and the per-product status badge in the right pane. Maps
 * directly to the `CmfStatusTone` vocabulary so the badge primitive
 * can render it without an additional translation layer.
 */
export function productTone(summary: ProductSummary): CmfStatusTone {
  if (summary.coverage.total === 0) return 'empty'
  if (summary.coverage.blocked === 0) return 'ready'
  if (summary.coverage.matched > 0) return 'partial'
  return 'blocked'
}

export const PRODUCT_TONE_LABEL: Record<CmfStatusTone, string> = {
  ready: 'Ready',
  partial: 'Partial',
  blocked: 'Needs clowns',
  empty: 'Empty',
  rendering: 'Rendering',
  failed: 'Failed',
  draft: 'Draft',
}

/**
 * Map a `CmfPacket.status` string ("draft" | "rendering" | "ready" |
 * "failed") to the shared tone vocabulary. Centralised so the
 * per-packet badge in the workbook tab and any future status surface
 * stay aligned.
 */
export function packetStatusTone(status: string): CmfStatusTone {
  if (status === 'ready') return 'ready'
  if (status === 'rendering') return 'rendering'
  if (status === 'failed') return 'failed'
  return 'draft'
}
