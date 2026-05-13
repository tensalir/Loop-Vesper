'use client'

/**
 * Right-pane overview for a single product.
 *
 * Composes the per-product header (display name + category eyebrow +
 * status pill + "Open packet" CTA), the metric line (packet/SKU/clown
 * counts), and the three-tab strip that drives the per-tab content
 * (Workbook / References / PDF).
 *
 * State that lives here:
 *   - `tab` — which tab is active. Resets to `workbook` whenever the
 *     selected product changes so opening a new product never strands
 *     the designer on a tab that doesn't apply.
 *
 * Everything else flows down from the parent dialog as props. This
 * keeps the overview composable in isolation; a future "library
 * showcase" page could mount it without dragging the rail along.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Database, FileText, Library } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { CmfClownAsset } from '@/hooks/useCmf'
import type { ProductSummary } from '@/lib/cmf/product-summary'
import { CmfStatusBadge } from '../CmfStatusBadge'
import { WorkbookTab } from './WorkbookTab'
import { ReferencesTab } from './ReferencesTab'
import { PdfTab } from './PdfTab'
import {
  PRODUCT_CATEGORY_LABEL,
  PRODUCT_TONE_LABEL,
  productTone,
} from './tone'

interface ProductOverviewProps {
  summary: ProductSummary
  allClowns: CmfClownAsset[]
  canWrite: boolean
  onSelectPacket: (packetId: string) => void
  onImport: () => void
  onUpdateReferences: () => void
  onRequestDelete: (packet: ProductSummary['packets'][number]) => void
}

export function ProductOverview({
  summary,
  allClowns,
  canWrite,
  onSelectPacket,
  onImport,
  onUpdateReferences,
  onRequestDelete,
}: ProductOverviewProps) {
  const tone = productTone(summary)
  const productClowns = useMemo(
    () =>
      allClowns
        .filter((c) => c.productSlug === summary.productSlug)
        .sort((a, b) => a.variantSlug.localeCompare(b.variantSlug)),
    [allClowns, summary.productSlug]
  )

  const hasAnyPackets = summary.packets.length > 0
  const packetsWithPdf = useMemo(
    () => summary.packets.filter((p) => p.pdfUrl),
    [summary.packets]
  )

  // Tab state — defaults to Workbook (the user's primary "let me
  // double-check the Excel content" path). Resets back to Workbook
  // whenever a different product is picked so opening a new product
  // never strands you on a tab that doesn't apply (e.g. PDF tab on
  // a product without any generated PDFs).
  const [tab, setTab] = useState<'workbook' | 'references' | 'pdf'>('workbook')
  useEffect(() => {
    setTab('workbook')
  }, [summary.productSlug])

  return (
    <div className="p-5 space-y-6">
      {/* Header — title block on the left, primary "Open packet" CTA
          on the right so the way out of the dialog into the workspace
          is always visible at a glance. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
            {PRODUCT_CATEGORY_LABEL[summary.category]}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              {summary.displayName}
            </h2>
            <CmfStatusBadge
              tone={tone}
              label={PRODUCT_TONE_LABEL[tone]}
              className="text-[10px] px-2 py-0.5"
            />
          </div>
        </div>
        {summary.mostRecentPacketId && (
          <Button
            onClick={() => onSelectPacket(summary.mostRecentPacketId!)}
            className="gap-2 flex-shrink-0"
          >
            Open packet
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </header>

      {/* Spacer to keep the metric line below outside the header
          flex so it stays full-width even when the Open button wraps
          on narrow viewports. */}
      <div className="-mt-3">
        {hasAnyPackets ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {summary.packets.length}
              </span>{' '}
              {summary.packets.length === 1 ? 'packet' : 'packets'}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>
              <span className="font-semibold text-foreground">
                {summary.skuCount}
              </span>{' '}
              SKUs
            </span>
            {summary.coverage.total > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>
                  {summary.coverage.matched}/{summary.coverage.total} clown coverage
                </span>
              </>
            )}
            {productClowns.length > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span>{productClowns.length} reference variants</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground/70">
            No packets imported for this product yet.
          </p>
        )}
      </div>

      {/* Tab strip — Workbook is the default since "let me check
          what's in the Excel" is the primary use case. References
          and PDF are secondary lookups. */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as 'workbook' | 'references' | 'pdf')}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="workbook" className="gap-1.5 text-xs">
            <Database className="h-3.5 w-3.5" />
            Workbook
            {summary.packets.length > 0 && (
              <span className="ml-1 tabular-nums text-[10px] opacity-70">
                {summary.packets.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="references" className="gap-1.5 text-xs">
            <Library className="h-3.5 w-3.5" />
            References
            {productClowns.length > 0 && (
              <span className="ml-1 tabular-nums text-[10px] opacity-70">
                {productClowns.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pdf" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            PDF
            {packetsWithPdf.length > 0 && (
              <span className="ml-1 tabular-nums text-[10px] opacity-70">
                {packetsWithPdf.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workbook" className="mt-4">
          <WorkbookTab
            summary={summary}
            canWrite={canWrite}
            onSelectPacket={onSelectPacket}
            onImport={onImport}
            onRequestDelete={onRequestDelete}
          />
        </TabsContent>

        <TabsContent value="references" className="mt-4">
          <ReferencesTab
            clowns={productClowns}
            onUpdateReferences={onUpdateReferences}
          />
        </TabsContent>

        <TabsContent value="pdf" className="mt-4">
          <PdfTab summary={summary} onSelectPacket={onSelectPacket} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
