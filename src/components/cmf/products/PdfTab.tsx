'use client'

/**
 * PDF tab — inline preview per packet.
 *
 * Browsers render application/pdf natively in iframes (Supabase
 * storage serves the right Content-Type), so we don't need pdf.js.
 * Each card has the packet meta + open / download buttons up top so
 * they're reachable without scrolling the embedded PDF.
 *
 * Packets without a generated PDF appear in a separate "Not
 * generated yet" group with a dashed-border CTA pointing the
 * designer back to the workspace's Export action.
 */

import { useMemo } from 'react'
import { ArrowUpRight, Download, FileText } from 'lucide-react'
import type { ProductSummary } from '@/lib/cmf/product-summary'
import { timeAgo } from '@/lib/cmf/format'

interface PdfTabProps {
  summary: ProductSummary
  onSelectPacket: (packetId: string) => void
}

export function PdfTab({ summary, onSelectPacket }: PdfTabProps) {
  const sorted = useMemo(
    () =>
      summary.packets
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [summary.packets]
  )
  const withPdf = sorted.filter((p) => p.pdfUrl)
  const withoutPdf = sorted.filter((p) => !p.pdfUrl)

  if (sorted.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 bg-card/20 p-5 text-xs text-muted-foreground">
        <FileText className="h-4 w-4 opacity-60" />
        <span>No packets imported for this product yet.</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {withPdf.map((packet) => (
        <article
          key={packet.id}
          className="rounded-xl border border-border/40 bg-card/20 overflow-hidden"
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 bg-muted/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">
                {packet.cmfCode || packet.name}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {packet.cmfCode ? packet.name : '—'}
                {packet.generatedAt && (
                  <>
                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                    generated {timeAgo(packet.generatedAt)}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <a
                href={packet.pdfUrl ?? '#'}
                download
                className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card/50 px-2.5 py-1 text-[11px] font-medium hover:border-border hover:bg-card/80 transition-colors"
              >
                <Download className="h-3 w-3" />
                Download
              </a>
              <a
                href={packet.pdfUrl ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Open in tab
                <ArrowUpRight className="h-3 w-3" />
              </a>
            </div>
          </header>
          <div className="bg-background/40">
            <iframe
              title={`PDF preview · ${packet.cmfCode || packet.name}`}
              src={packet.pdfUrl ?? ''}
              className="block h-[600px] w-full border-0"
            />
          </div>
        </article>
      ))}

      {withoutPdf.length > 0 && (
        <div className="space-y-2">
          {withPdf.length > 0 && (
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 px-1">
              Not generated yet
            </p>
          )}
          <ul className="space-y-2">
            {withoutPdf.map((packet) => (
              <li key={packet.id}>
                <button
                  type="button"
                  onClick={() => onSelectPacket(packet.id)}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-border/40 bg-card/10 p-3 text-left hover:border-primary/50 hover:bg-card/30 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {packet.cmfCode || packet.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      No PDF generated yet — open the packet and run
                      Export to produce one.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 group-hover:text-primary transition-colors flex-shrink-0">
                    Open packet
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
