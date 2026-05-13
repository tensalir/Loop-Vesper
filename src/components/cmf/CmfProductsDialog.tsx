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
import {
  summariseProductLibrary,
  type ProductSummary,
} from '@/lib/cmf/product-summary'
import type { CmfClownAsset, CmfPacket } from '@/hooks/useCmf'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  CheckCircle2,
  ImageOff,
  Library,
  Package,
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

  // Flatten the catalog into a click list (top-tier + nested cases) so
  // the left rail can render in one pass and selection state is a
  // single slug.
  const flatProducts = useMemo(() => {
    const out: Array<{ summary: ProductSummary; depth: 0 | 1 }> = []
    for (const product of rollup.products) {
      out.push({ summary: product, depth: 0 })
      for (const childCase of product.cases) {
        out.push({ summary: childCase, depth: 1 })
      }
    }
    return out
  }, [rollup.products])

  const selected = useMemo(() => {
    if (!selectedSlug) return null
    for (const item of flatProducts) {
      if (item.summary.productSlug === selectedSlug) return item.summary
    }
    return null
  }, [flatProducts, selectedSlug])

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
          {/* Left rail — bigger touch targets so designers can scan a
              long product list quickly. */}
          <aside className="border-r border-border/40 overflow-y-auto bg-muted/10">
            <ul className="py-2">
              {flatProducts.map(({ summary, depth }) => {
                const isSelected = summary.productSlug === selectedSlug
                const tone = productTone(summary)
                const total = summary.packets.length
                return (
                  <li key={summary.productSlug}>
                    <button
                      type="button"
                      onClick={() => setSelectedSlug(summary.productSlug)}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors',
                        depth === 1 && 'pl-10 text-[13px]',
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
                      {depth === 1 && (
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

        {/* Sticky footer — primary CTA so the way out of the dialog
            into the workspace is always visible, never hidden behind
            scroll or a per-row hover. */}
        {selected && (
          <footer className="flex items-center justify-between gap-3 border-t border-border/40 bg-background/95 px-5 py-3 flex-shrink-0">
            <p className="text-xs text-muted-foreground">
              {selected.mostRecentPacketId ? (
                <>
                  <span className="font-medium text-foreground">
                    {selected.displayName}
                  </span>
                  <span className="mx-1.5 text-muted-foreground/40">·</span>
                  {selected.packets.length || selected.cases.reduce((s, c) => s + c.packets.length, 0)}{' '}
                  {(selected.packets.length || selected.cases.reduce((s, c) => s + c.packets.length, 0)) === 1
                    ? 'packet'
                    : 'packets'}
                  {' '}available
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {selected.displayName}
                  </span>
                  <span className="mx-1.5 text-muted-foreground/40">·</span>
                  No packets yet — import a workbook first
                </>
              )}
            </p>
            <Button
              onClick={() => {
                if (selected.mostRecentPacketId) {
                  onSelectPacket(selected.mostRecentPacketId)
                  onOpenChange(false)
                }
              }}
              disabled={!selected.mostRecentPacketId}
              className="gap-2"
            >
              Open packet
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </footer>
        )}
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

  // Approved renders: the list endpoint already populates `renderUrl`
  // when an attempt has been approved (the approve action sets it on
  // the parent render row). Pull the unique URLs across this product's
  // packets so the gallery shows the canonical hero per SKU without us
  // having to round-trip /api/cmf/packets/[id] for every packet.
  const approvedRenders = useMemo(() => {
    const out: Array<{
      packetId: string
      packetName: string
      renderId: string
      label: string
      colorwayName: string | null
      url: string
    }> = []
    for (const packet of summary.packets) {
      for (const render of packet.renders) {
        if (!render.renderUrl || !render.id) continue
        out.push({
          packetId: packet.id,
          packetName: packet.name,
          renderId: render.id,
          label: render.label ?? '',
          colorwayName: render.colorwayName ?? null,
          url: render.renderUrl,
        })
      }
    }
    return out
  }, [summary])

  const hasAnyPackets = summary.packets.length > 0

  return (
    <div className="p-5 space-y-6">
      {/* Header */}
      <header className="space-y-1.5">
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
      </header>

      {/* Workbook / packets */}
      {hasAnyPackets && (
        <Section icon={Package} title="Workbook" subtitle="Imported packets">
          <ul className="space-y-1.5">
            {summary.packets
              .slice()
              .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
              .map((packet) => (
                <li key={packet.id}>
                  <button
                    type="button"
                    onClick={() => onSelectPacket(packet.id)}
                    className="group flex w-full items-center gap-3 rounded-lg border border-border/40 bg-card/30 p-3 text-left hover:border-primary/50 hover:bg-card/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
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
                    {/* Always-visible "Open" pill so the row reads as
                        an action, not just a panel. Tones up on hover
                        but never disappears entirely. */}
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary group-hover:bg-primary/20 transition-colors">
                      Open
                      <ArrowUpRight className="h-3 w-3" />
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </Section>
      )}

      {/* References / clowns */}
      <Section
        icon={Library}
        title="References"
        subtitle={`${productClowns.length} clown ${productClowns.length === 1 ? 'asset' : 'assets'}`}
      >
        {productClowns.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
            No clown references yet — uploads will land here.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {productClowns.map((clown) => (
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
        )}
      </Section>

      {/* Approved renders */}
      {hasAnyPackets && (
        <Section
          icon={CheckCircle2}
          title="Approved renders"
          subtitle={
            approvedRenders.length === 0
              ? 'No approved renders yet'
              : `${approvedRenders.length} ${approvedRenders.length === 1 ? 'SKU' : 'SKUs'} with an approved attempt`
          }
        >
          {approvedRenders.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/40 bg-card/20 p-4 text-xs text-muted-foreground">
              <ImageOff className="h-4 w-4 opacity-60" />
              <span>
                Approve a generated attempt in any packet and it will
                appear here as the canonical hero for that SKU.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {approvedRenders.map((render) => (
                <figure
                  key={render.renderId}
                  className="rounded-lg border border-emerald-500/30 bg-card/30 overflow-hidden"
                >
                  <div className="aspect-square bg-background/40 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={render.url}
                      alt={render.label}
                      className="h-full w-full object-contain p-3"
                    />
                  </div>
                  <figcaption className="px-2 py-1.5 text-[10px] text-muted-foreground">
                    <span className="block truncate font-medium text-foreground">
                      {render.colorwayName ?? render.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectPacket(render.packetId)}
                      className="block truncate text-[9px] hover:text-primary transition-colors"
                      title="Open packet"
                    >
                      {render.packetName} ↗
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          <Icon className="h-3 w-3" />
          {title}
        </h3>
        {subtitle && (
          <p className="text-[10px] text-muted-foreground/70 truncate">
            {subtitle}
          </p>
        )}
      </header>
      {children}
    </section>
  )
}
