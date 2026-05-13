'use client'

/**
 * Workbook tab — read-only render of every imported packet for the
 * selected product.
 *
 * Per packet: a header row carrying the cmfCode + status + last-edited
 * stamp (clickable to open the packet) and a discrete trash icon that
 * opens the delete confirmation when CMF write access is granted.
 *
 * Per SKU: a card with the approved render thumbnail and the parsed
 * Excel content (label, productCode, components grid, palette
 * swatches). Lives in `SkuCard.tsx` so the per-SKU markup stays
 * self-contained.
 */

import { useMemo } from 'react'
import { ArrowUpRight, Database, Trash2, Upload } from 'lucide-react'
import type { ProductSummary } from '@/lib/cmf/product-summary'
import { timeAgo } from '@/lib/cmf/format'
import { CmfStatusBadge } from '../CmfStatusBadge'
import { SkuCard } from './SkuCard'
import { packetStatusTone } from './tone'

interface WorkbookTabProps {
  summary: ProductSummary
  canWrite: boolean
  onSelectPacket: (packetId: string) => void
  onImport: () => void
  onRequestDelete: (packet: ProductSummary['packets'][number]) => void
}

export function WorkbookTab({
  summary,
  canWrite,
  onSelectPacket,
  onImport,
  onRequestDelete,
}: WorkbookTabProps) {
  const sortedPackets = useMemo(
    () =>
      summary.packets
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [summary.packets]
  )

  if (sortedPackets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 bg-card/20 p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-4 w-4 opacity-60" />
          <span>
            No packets imported for this product yet. Drop the workbook
            to start.
          </span>
        </div>
        <button
          type="button"
          onClick={onImport}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          Import workbook
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Slim updater strip — re-uploading an updated workbook auto-
          merges into the matching packet (by cmfCode, or by SKU
          signature when no code), so the action is non-destructive
          and idempotent. The copy makes that promise explicit so a
          designer doesn't worry about creating duplicates. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/20 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Re-uploading auto-merges by CMF code or SKU set. Existing
          rows update in place; new rows append.
        </p>
        <button
          type="button"
          onClick={onImport}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <Upload className="h-3 w-3" />
          Update workbook
        </button>
      </div>

      {sortedPackets.map((packet) => (
        <article
          key={packet.id}
          className="rounded-xl border border-border/40 bg-card/20 overflow-hidden"
        >
          {/* Packet header — split into a primary "open" click region
              and a discrete delete control on the right. The delete
              button can't be nested inside the open button (HTML
              forbids button-in-button), so we render them as
              siblings inside a flex row instead. The header still
              reads as "click anywhere to open" because the open
              region fills the available space. */}
          <header className="group flex items-center gap-1 border-b border-border/40 bg-muted/10 transition-colors hover:bg-muted/20">
            <button
              type="button"
              onClick={() => onSelectPacket(packet.id)}
              className="flex flex-1 min-w-0 items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="truncate text-sm font-semibold">
                    {packet.cmfCode || packet.name}
                  </span>
                  <CmfStatusBadge
                    tone={packetStatusTone(packet.status)}
                    label={packet.status}
                    className="px-1.5 py-0"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {packet.cmfCode ? packet.name : '—'}
                  <span className="mx-1.5 text-muted-foreground/40">·</span>
                  {packet.renders.length}{' '}
                  {packet.renders.length === 1 ? 'SKU' : 'SKUs'}
                  {packet.updatedAt && (
                    <>
                      <span className="mx-1.5 text-muted-foreground/40">·</span>
                      edited {timeAgo(packet.updatedAt)}
                    </>
                  )}
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 group-hover:text-primary transition-colors flex-shrink-0">
                Open
                <ArrowUpRight className="h-3 w-3" />
              </span>
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRequestDelete(packet)
                }}
                aria-label={`Delete packet ${packet.cmfCode || packet.name}`}
                title="Delete packet"
                className="mr-2 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </header>

          {/* SKU rows — one card per render. The components grid is
              the actual parsed Excel content; the thumbnail is the
              approved render (or a placeholder when nothing's been
              approved yet). */}
          <ul className="divide-y divide-border/30">
            {packet.renders.map((render) => (
              <li key={render.id ?? render.label} className="p-4">
                <SkuCard render={render} productSlug={summary.productSlug} />
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  )
}
