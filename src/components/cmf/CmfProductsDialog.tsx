'use client'

/**
 * CmfProductsDialog — the canonical "what's in the library?" surface.
 *
 * Two-pane layout:
 *   - Left rail: every catalog product with status dot + packet count.
 *     Cases nested under their parent. Click selects.
 *   - Right pane: per-product overview
 *       · Header: name + category + status pill
 *       · Workbook section: list of packets (cmfCode, status, SKU
 *         count, last edited). Each row jumps into the workspace.
 *       · References section: clown thumbnails for the product so a
 *         designer sees the "raw materials" without opening the
 *         clown library separately.
 *       · Approved renders: thumbnails of every render whose `renderUrl`
 *         is set (i.e. has an approved attempt). The portfolio view.
 *
 * No filters, no search bar, no big card grid. Reading is the point —
 * if a designer wants to ACT on a product they click into a packet and
 * the workspace takes over.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  summariseProductLibrary,
  type ProductSummary,
} from '@/lib/cmf/product-summary'
import type { CmfClownAsset, CmfPacket } from '@/hooks/useCmf'
import { getComponentLabel } from '@/lib/cmf/products'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  Database,
  Download,
  FileText,
  ImageOff,
  Library,
} from 'lucide-react'

interface CmfProductsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  packets: CmfPacket[] | undefined
  clowns: CmfClownAsset[] | undefined
  /** When the user picks a packet from the right-pane list, the
   *  workspace switches to it and the dialog closes. */
  onSelectPacket: (packetId: string) => void
}

const CATEGORY_LABEL: Record<ProductSummary['category'], string> = {
  earplug: 'Earplug',
  sensewear: 'Sensewear',
  case: 'Case',
  other: 'Uncatalogued',
}

type Tone = 'ready' | 'partial' | 'blocked' | 'empty'

function productTone(summary: ProductSummary): Tone {
  if (summary.coverage.total === 0) return 'empty'
  if (summary.coverage.blocked === 0) return 'ready'
  if (summary.coverage.matched > 0) return 'partial'
  return 'blocked'
}

function timeAgo(iso: string | null): string | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

export function CmfProductsDialog({
  open,
  onOpenChange,
  packets,
  clowns,
  onSelectPacket,
}: CmfProductsDialogProps) {
  const rollup = useMemo(
    () => summariseProductLibrary({ packets, clowns }),
    [packets, clowns]
  )
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)

  // Default selection: first product with packets so the dialog opens
  // on something worth reading. Re-derive when the dialog is reopened.
  useEffect(() => {
    if (!open) return
    if (selectedSlug) return
    const firstWithPackets = rollup.products.find((p) => p.packets.length > 0)
    setSelectedSlug(
      firstWithPackets?.productSlug ?? rollup.products[0]?.productSlug ?? null
    )
  }, [open, rollup.products, selectedSlug])

  // Build the rail as a typed list of headers + items. Products with a
  // child case (carry case / pouch) get a non-clickable brand header
  // followed by each clickable variant indented underneath, so the
  // hierarchy reads as "APHRODITE → [Aphrodite, Aphrodite Carry Case]"
  // instead of two equivalent buttons. Products without a case stay
  // flat — no header is needed when there's nothing to disambiguate.
  type RailEntry =
    | { kind: 'header'; key: string; label: string }
    | { kind: 'item'; summary: ProductSummary; depth: 0 | 1 }

  const railEntries = useMemo<RailEntry[]>(() => {
    const out: RailEntry[] = []
    for (const product of rollup.products) {
      if (product.cases.length > 0) {
        out.push({
          kind: 'header',
          key: `header-${product.productSlug}`,
          label: product.displayName.replace(/^Loop\s+/, ''),
        })
        out.push({ kind: 'item', summary: product, depth: 1 })
        for (const childCase of product.cases) {
          out.push({ kind: 'item', summary: childCase, depth: 1 })
        }
      } else {
        out.push({ kind: 'item', summary: product, depth: 0 })
      }
    }
    return out
  }, [rollup.products])

  const selected = useMemo(() => {
    if (!selectedSlug) return null
    for (const entry of railEntries) {
      if (entry.kind === 'item' && entry.summary.productSlug === selectedSlug) {
        return entry.summary
      }
    }
    return null
  }, [railEntries, selectedSlug])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/40 flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Library className="h-4 w-4 text-muted-foreground" />
            Products
          </DialogTitle>
          <DialogDescription className="text-xs">
            Workbook, references, and approved renders for every Loop
            product. Click a packet to jump into its workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Body: two-pane grid that owns the scrollable area. The
            footer below sits outside this so the primary "Open" CTA
            is always anchored visible regardless of scroll. */}
        <div className="grid grid-cols-[280px_1fr] flex-1 min-h-0">
          {/* Left rail — brand headers as labels, the actual products
              as indented clickable items below. Products without a
              case stay flat (no header) since there's nothing to
              disambiguate. */}
          <aside className="border-r border-border/40 overflow-y-auto bg-muted/10">
            <ul className="py-2">
              {railEntries.map((entry, idx) => {
                if (entry.kind === 'header') {
                  // Add visual breathing room before each new brand
                  // group except the first.
                  const isFirst = idx === 0
                  return (
                    <li
                      key={entry.key}
                      className={cn(
                        'px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60',
                        !isFirst && 'pt-3'
                      )}
                    >
                      {entry.label}
                    </li>
                  )
                }
                const { summary, depth } = entry
                const isSelected = summary.productSlug === selectedSlug
                const tone = productTone(summary)
                const total = summary.packets.length
                const isCase = !!summary.product?.parentSlug
                return (
                  <li key={summary.productSlug}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug(summary.productSlug)}
                      className={cn(
                        'flex w-full items-center gap-2.5 py-2.5 text-left text-sm transition-colors',
                        // Indent children of a brand header so the
                        // hierarchy reads in one glance.
                        depth === 1 ? 'pl-7 pr-4' : 'px-4',
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'hover:bg-muted/40 text-foreground'
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'h-2 w-2 rounded-full flex-shrink-0',
                          tone === 'ready' && 'bg-emerald-500',
                          tone === 'partial' && 'bg-amber-500',
                          tone === 'blocked' && 'bg-rose-500',
                          tone === 'empty' && 'bg-muted-foreground/30'
                        )}
                      />
                      {isCase && (
                        <Briefcase className="h-3 w-3 flex-shrink-0 opacity-60" />
                      )}
                      <span className="flex-1 truncate">
                        {summary.displayName.replace(/^Loop\s+/, '')}
                      </span>
                      {total > 0 && (
                        <span
                          className={cn(
                            'tabular-nums text-[11px]',
                            isSelected
                              ? 'text-primary/80'
                              : 'text-muted-foreground/60'
                          )}
                        >
                          {total}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {/* Right pane */}
          <section className="overflow-y-auto">
            {selected ? (
              <ProductOverview
                summary={selected}
                allClowns={clowns ?? []}
                onSelectPacket={(id) => {
                  onSelectPacket(id)
                  onOpenChange(false)
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Pick a product on the left.
              </div>
            )}
          </section>
        </div>

      </DialogContent>
    </Dialog>
  )
}

/* ── Right-pane overview ────────────────────────────────────────────────── */

function ProductOverview({
  summary,
  allClowns,
  onSelectPacket,
}: {
  summary: ProductSummary
  allClowns: CmfClownAsset[]
  onSelectPacket: (packetId: string) => void
}) {
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
          on the right so the way out of the dialog into the
          workspace is always visible at a glance. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5 min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
            {CATEGORY_LABEL[summary.category]}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight">
              {summary.displayName}
            </h2>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                tone === 'ready' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                tone === 'partial' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                tone === 'blocked' && 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
                tone === 'empty' && 'bg-muted/30 text-muted-foreground'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  tone === 'ready' && 'bg-emerald-500',
                  tone === 'partial' && 'bg-amber-500',
                  tone === 'blocked' && 'bg-rose-500',
                  tone === 'empty' && 'bg-muted-foreground/40'
                )}
              />
              {tone === 'ready' && 'Ready'}
              {tone === 'partial' && 'Partial'}
              {tone === 'blocked' && 'Needs clowns'}
              {tone === 'empty' && 'Empty'}
            </span>
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
          flex so it stays full-width even when the Open button
          wraps on narrow viewports. */}
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
          <WorkbookTab summary={summary} onSelectPacket={onSelectPacket} />
        </TabsContent>

        <TabsContent value="references" className="mt-4">
          <ReferencesTab clowns={productClowns} />
        </TabsContent>

        <TabsContent value="pdf" className="mt-4">
          <PdfTab summary={summary} onSelectPacket={onSelectPacket} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ── Workbook tab ───────────────────────────────────────────────────────── */

/**
 * Read-only render of every imported packet for the selected product.
 * Per packet: a header row carrying the cmfCode + status + last-edited
 * stamp (the whole row is clickable to open that packet in the
 * workspace). Per SKU: a card with the approved render thumbnail on
 * the left and the parsed Excel content on the right (label,
 * productCode, components grid, palette swatches).
 *
 * The point is "double-check what was imported" — this is the only
 * surface in the app that shows the parsed components + palette
 * without dropping the designer back into the spreadsheet.
 */
function WorkbookTab({
  summary,
  onSelectPacket,
}: {
  summary: ProductSummary
  onSelectPacket: (packetId: string) => void
}) {
  const sortedPackets = useMemo(
    () =>
      summary.packets
        .slice()
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [summary.packets]
  )

  if (sortedPackets.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 bg-card/20 p-5 text-xs text-muted-foreground">
        <Database className="h-4 w-4 opacity-60" />
        <span>
          No packets imported for this product yet. Use the
          {' "+"'} button on the pipeline to import a workbook.
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {sortedPackets.map((packet) => (
        <article
          key={packet.id}
          className="rounded-xl border border-border/40 bg-card/20 overflow-hidden"
        >
          {/* Packet header — same click semantics as the old per-row
              button: clicking opens this specific packet in the
              workspace and closes the dialog. */}
          <button
            type="button"
            onClick={() => onSelectPacket(packet.id)}
            className="group flex w-full items-center justify-between gap-3 border-b border-border/40 bg-muted/10 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="truncate text-sm font-semibold">
                  {packet.cmfCode || packet.name}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center rounded-full px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider',
                    packet.status === 'ready'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : packet.status === 'rendering'
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                      : packet.status === 'failed'
                      ? 'bg-destructive/15 text-destructive'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {packet.status}
                </span>
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
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 group-hover:text-primary transition-colors">
              Open
              <ArrowUpRight className="h-3 w-3" />
            </span>
          </button>

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

/**
 * Single SKU card — left thumbnail of the approved render, right
 * panel with label, productCode, components grid (region · material
 * · finish · pantone · hex with a small color swatch), and an
 * optional palette swatch row.
 */
function SkuCard({
  render,
  productSlug,
}: {
  render: ProductSummary['packets'][number]['renders'][number]
  productSlug: string
}) {
  const components = (render.componentSpecs ?? []) as Array<{
    region: string
    label?: string
    material?: string | null
    finish?: string | null
    pantone?: string | null
    colorHex?: string | null
    technique?: string | null
    notes?: string | null
  }>
  const palette = (render.paletteSwatches ?? []) as Array<{
    label: string
    pantone?: string | null
    colorHex?: string | null
  }>
  return (
    <div className="flex gap-4 items-start">
      <div className="flex-shrink-0 h-16 w-16 rounded-md border border-border/40 bg-background/60 overflow-hidden flex items-center justify-center">
        {render.renderUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={render.renderUrl}
            alt={render.label ?? ''}
            className="h-full w-full object-contain p-1"
          />
        ) : (
          <ImageOff className="h-5 w-5 text-muted-foreground/40" />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold truncate">
              {render.colorwayName ?? render.label}
            </h4>
            <p className="text-[10px] font-mono text-muted-foreground/80 truncate">
              {render.productCode || '—'}
              {render.ean && (
                <>
                  <span className="mx-1.5 opacity-50">·</span>
                  EAN {render.ean}
                </>
              )}
            </p>
          </div>
          {render.status && (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 flex-shrink-0">
              {render.status}
            </span>
          )}
        </div>

        {components.length > 0 && (
          <div className="rounded-md border border-border/30 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-muted/20 text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  <th className="px-2.5 py-1.5 text-left font-medium">Region</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">Material / Finish</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">Pantone</th>
                  <th className="px-2.5 py-1.5 text-left font-medium">Hex</th>
                </tr>
              </thead>
              <tbody>
                {components.map((c, i) => {
                  const label = c.label ?? getComponentLabel(productSlug, c.region)
                  return (
                    <tr
                      key={`${c.region}-${i}`}
                      className="border-t border-border/30 hover:bg-muted/10"
                    >
                      <td className="px-2.5 py-1.5 font-medium truncate max-w-[180px]">
                        {label}
                      </td>
                      <td className="px-2.5 py-1.5 text-muted-foreground truncate max-w-[200px]">
                        {[c.material, c.finish].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono text-muted-foreground">
                        {c.pantone || '—'}
                      </td>
                      <td className="px-2.5 py-1.5 font-mono">
                        {c.colorHex ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className="h-2.5 w-2.5 rounded-full border border-border/40"
                              style={{ backgroundColor: c.colorHex }}
                            />
                            {c.colorHex}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {palette.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-muted-foreground">
            <span className="uppercase tracking-wider opacity-60">Palette</span>
            {palette.map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/40 px-1.5 py-0.5"
                title={[s.label, s.pantone, s.colorHex].filter(Boolean).join(' · ')}
              >
                {s.colorHex && (
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full border border-border/40"
                    style={{ backgroundColor: s.colorHex }}
                  />
                )}
                <span className="font-medium text-foreground/80">{s.label}</span>
                {s.pantone && <span className="font-mono opacity-70">{s.pantone}</span>}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── References tab ─────────────────────────────────────────────────────── */

function ReferencesTab({ clowns }: { clowns: CmfClownAsset[] }) {
  if (clowns.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 bg-card/20 p-5 text-xs text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-500/70" />
        <span>
          No clown references yet. Drop a reference zip in the import
          dialog and the variants will appear here.
        </span>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {clowns.map((clown) => (
        <figure
          key={clown.id}
          className="rounded-lg border border-border/40 bg-card/30 overflow-hidden"
        >
          <div className="aspect-square bg-background/40 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={clown.imageUrl}
              alt={clown.label}
              className="h-full w-full object-contain p-3"
            />
          </div>
          <figcaption className="px-2 py-1.5 text-[10px] text-muted-foreground">
            <span className="block truncate font-medium text-foreground">
              {clown.label}
            </span>
            <span className="font-mono">{clown.variantSlug}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

/* ── PDF tab ────────────────────────────────────────────────────────────── */

/**
 * Inline PDF preview per packet. Browsers render application/pdf
 * natively in iframes (Supabase storage serves the right
 * Content-Type), so we don't need pdf.js. Each card has the packet
 * meta + open / download buttons up top so they're reachable
 * without scrolling the embedded PDF.
 */
function PdfTab({
  summary,
  onSelectPacket,
}: {
  summary: ProductSummary
  onSelectPacket: (packetId: string) => void
}) {
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

