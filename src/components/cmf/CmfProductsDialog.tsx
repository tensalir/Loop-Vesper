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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  summariseProductLibrary,
  type ProductSummary,
} from '@/lib/cmf/product-summary'
import { useDeleteCmfPacket, type CmfClownAsset, type CmfPacket } from '@/hooks/useCmf'
import { useToast } from '@/components/ui/use-toast'
import { useCmfPermissions } from '@/hooks/useCmfPermissions'
import { getComponentLabel } from '@/lib/cmf/products'
import { timeAgo } from '@/lib/cmf/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  CmfStatusBadge,
  CmfStatusDot,
  type CmfStatusTone,
} from './CmfStatusBadge'
import {
  AlertTriangle,
  ArrowUpRight,
  Briefcase,
  Database,
  Download,
  FileText,
  ImageOff,
  Library,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'

interface CmfProductsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  packets: CmfPacket[] | undefined
  clowns: CmfClownAsset[] | undefined
  /** When the user picks a packet from the right-pane list, the
   *  workspace switches to it and the dialog closes. */
  onSelectPacket: (packetId: string) => void
  /** Open the unified import dialog. Called from the Workbook tab's
   *  "Update workbook" affordance — closes this dialog and opens
   *  the import dialog so the designer never loses context. */
  onImport: () => void
  /** Open the standalone clown library dialog focused on a specific
   *  product's references. Called from the References tab's "Update
   *  references" affordance — closes this dialog and opens the
   *  clown library with the upload form already pointing at the
   *  selected product. */
  onUpdateReferences: (productSlug: string) => void
  /** Fired after the user confirms deletion of a packet. The
   *  workspace uses this to clear `activePacketId` if the deleted
   *  packet was the one currently open. */
  onPacketDeleted?: (packetId: string) => void
}

const CATEGORY_LABEL: Record<ProductSummary['category'], string> = {
  earplug: 'Earplug',
  sensewear: 'Sensewear',
  case: 'Case',
  other: 'Uncatalogued',
}

/**
 * Coverage-driven tone for a product summary. Drives both the rail dot
 * and the per-product status badge in the right pane. Maps directly to
 * the `CmfStatusTone` vocabulary so the badge primitive can render it
 * without an additional translation layer.
 */
function productTone(summary: ProductSummary): CmfStatusTone {
  if (summary.coverage.total === 0) return 'empty'
  if (summary.coverage.blocked === 0) return 'ready'
  if (summary.coverage.matched > 0) return 'partial'
  return 'blocked'
}

const PRODUCT_TONE_LABEL: Record<CmfStatusTone, string> = {
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
 * "failed") to the shared tone vocabulary. Centralised so the per-packet
 * badge in the workbook tab and any future status surface stay aligned.
 */
function packetStatusTone(status: string): CmfStatusTone {
  if (status === 'ready') return 'ready'
  if (status === 'rendering') return 'rendering'
  if (status === 'failed') return 'failed'
  return 'draft'
}

export function CmfProductsDialog({
  open,
  onOpenChange,
  packets,
  clowns,
  onSelectPacket,
  onImport,
  onUpdateReferences,
  onPacketDeleted,
}: CmfProductsDialogProps) {
  const rollup = useMemo(
    () => summariseProductLibrary({ packets, clowns }),
    [packets, clowns]
  )
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  // Pending delete target — when set, the AlertDialog renders the
  // confirmation prompt against this packet. Tracked at the dialog
  // level (not the WorkbookTab) so the prompt overlays the products
  // dialog cleanly and survives re-renders of the inner tab.
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    name: string
    cmfCode: string | null
    skuCount: number
  } | null>(null)
  const deleteMutation = useDeleteCmfPacket()
  const { toast } = useToast()
  const { canWrite } = useCmfPermissions()

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
                      <CmfStatusDot tone={tone} />
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
                canWrite={canWrite}
                onSelectPacket={(id) => {
                  onSelectPacket(id)
                  onOpenChange(false)
                }}
                onImport={() => {
                  onOpenChange(false)
                  onImport()
                }}
                onUpdateReferences={() => {
                  onOpenChange(false)
                  onUpdateReferences(selected.productSlug)
                }}
                onRequestDelete={(packet) =>
                  setDeleteTarget({
                    id: packet.id,
                    name: packet.cmfCode || packet.name,
                    cmfCode: packet.cmfCode,
                    skuCount: packet.renders.length,
                  })
                }
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Pick a product on the left.
              </div>
            )}
          </section>
        </div>

      </DialogContent>

      {/* Confirmation prompt — destructive operations should require
          a deliberate "yes". The copy spells out exactly what will
          be lost (SKU count, attempts, renders) so a designer
          doesn't nuke a packet they meant to keep. */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next && !deleteMutation.isPending) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-destructive" />
              Delete packet?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                <span className="font-semibold text-foreground">
                  {deleteTarget?.name ?? ''}
                </span>{' '}
                — {deleteTarget?.skuCount ?? 0}{' '}
                {deleteTarget?.skuCount === 1 ? 'SKU' : 'SKUs'} and every
                attempt, approval, and exported PDF tied to this packet.
              </span>
              <span className="block text-destructive">
                This cannot be undone.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={async (event) => {
                // Stop Radix from auto-closing — we need the prompt to
                // stay up while the network call runs so the spinner
                // is visible and the user can't double-fire.
                event.preventDefault()
                if (!deleteTarget) return
                try {
                  await deleteMutation.mutateAsync({
                    packetId: deleteTarget.id,
                  })
                  toast({
                    title: 'Packet deleted',
                    description: `${deleteTarget.name} removed from the library.`,
                  })
                  onPacketDeleted?.(deleteTarget.id)
                  setDeleteTarget(null)
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : 'Delete failed'
                  toast({ title: 'Delete failed', description: message })
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete packet
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}

/* ── Right-pane overview ────────────────────────────────────────────────── */

function ProductOverview({
  summary,
  allClowns,
  canWrite,
  onSelectPacket,
  onImport,
  onUpdateReferences,
  onRequestDelete,
}: {
  summary: ProductSummary
  allClowns: CmfClownAsset[]
  canWrite: boolean
  onSelectPacket: (packetId: string) => void
  onImport: () => void
  onUpdateReferences: () => void
  onRequestDelete: (packet: ProductSummary['packets'][number]) => void
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
  canWrite,
  onSelectPacket,
  onImport,
  onRequestDelete,
}: {
  summary: ProductSummary
  canWrite: boolean
  onSelectPacket: (packetId: string) => void
  onImport: () => void
  onRequestDelete: (packet: ProductSummary['packets'][number]) => void
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
      <div className="rounded-lg border border-dashed border-border/40 bg-card/20 p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-4 w-4 opacity-60" />
          <span>
            No packets imported for this product yet. Drop the
            workbook to start.
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

function ReferencesTab({
  clowns,
  onUpdateReferences,
}: {
  clowns: CmfClownAsset[]
  onUpdateReferences: () => void
}) {
  if (clowns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 bg-card/20 p-5 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500/70" />
          <span>
            No clown references for this product yet. Drop a zip
            (server maps the filename to the product) or upload one
            PNG at a time.
          </span>
        </div>
        <button
          type="button"
          onClick={onUpdateReferences}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload references
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {/* Slim updater strip — opens the standalone clown library
          dialog pre-focused on this product. Same idempotent
          posture as the workbook updater: re-uploading a clown
          with the same (productSlug, variantSlug) replaces the
          prior asset rather than duplicating. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/20 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Re-uploading a variant replaces the prior asset. New
          variants append.
        </p>
        <button
          type="button"
          onClick={onUpdateReferences}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        >
          <Upload className="h-3 w-3" />
          Update references
        </button>
      </div>

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

