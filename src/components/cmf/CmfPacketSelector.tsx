'use client'

import { useEffect, useMemo, useState } from 'react'
import { useCmfClowns, useCmfPackets, type CmfPacket } from '@/hooks/useCmf'
import {
  clownCoverageForPacket,
  summariseWorkspaceCoverage,
} from '@/lib/cmf/coverage'
import { listCmfProducts, type CmfProductSpec } from '@/lib/cmf/products'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertTriangle,
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Loader2,
  Package,
  Tag,
} from 'lucide-react'

interface CmfPacketSelectorProps {
  activePacketId: string | null
  onSelect: (id: string) => void
  /** Called when the user clicks a SKU leaf — selects the parent packet
   *  and scrolls to the row. The workspace listens to this so a designer
   *  can jump straight from "Switch 2 → Spring 2026 → Emerald" into the
   *  exact gallery card. */
  onRenderFocus?: (packetId: string, renderId: string) => void
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed',
}

type ReadinessTone = 'ready' | 'partial' | 'blocked' | 'empty'

function packetTone(
  packet: CmfPacket,
  clowns: ReturnType<typeof useCmfClowns>['data']
): ReadinessTone {
  if (!packet.renders || packet.renders.length === 0) return 'empty'
  const c = clownCoverageForPacket(packet, clowns ?? null)
  if (c.blocked === 0) return 'ready'
  if (c.matched > 0) return 'partial'
  return 'blocked'
}

/**
 * Aggregate readiness across a product's packets. The tone for the
 * product node is the WORST tone of any contained packet (ready unless
 * something needs work) so a designer scanning the catalog spots
 * trouble immediately.
 */
function productTone(
  packets: CmfPacket[],
  clowns: ReturnType<typeof useCmfClowns>['data']
): ReadinessTone {
  if (packets.length === 0) return 'empty'
  const tones = packets.map((p) => packetTone(p, clowns))
  if (tones.includes('blocked')) return 'blocked'
  if (tones.includes('partial')) return 'partial'
  if (tones.every((t) => t === 'ready')) return 'ready'
  return 'partial'
}

interface ProductNode {
  product: CmfProductSpec | null
  /** When the catalog doesn't recognise the slug we still surface it as
   *  a fallback row so legacy packets stay reachable. */
  fallbackSlug: string | null
  displayName: string
  category: 'earplug' | 'sensewear' | 'case' | 'other'
  packets: CmfPacket[]
  /** Cases / pouches that declare this product as their `parentSlug`.
   *  Rendered as a "Carry case" subsection inside the product's
   *  expansion so designers see the case packets right next to the
   *  parent product they belong to. */
  cases: ProductNode[]
}

const CATEGORY_ORDER: Record<ProductNode['category'], number> = {
  earplug: 0,
  sensewear: 1,
  case: 2,
  other: 3,
}

const CATEGORY_LABEL: Record<ProductNode['category'], string> = {
  earplug: 'Earplugs',
  sensewear: 'Sensewear',
  case: 'Cases',
  other: 'Uncatalogued',
}

/**
 * Compact packet selector — three-tier tree:
 *
 *   Product (catalog) → Packets (per launch / CMF code) → SKUs (renders)
 *
 * The catalog drives the top tier so the dropdown is stable across
 * imports — every product is always visible, with badge counts when it
 * has packets and a quiet "no packets yet" hint when it doesn't. The
 * product containing the active packet auto-expands so a refresh /
 * deep-link lands on the right context.
 */
export function CmfPacketSelector({
  activePacketId,
  onSelect,
  onRenderFocus,
}: CmfPacketSelectorProps) {
  const { data: packets, isLoading } = useCmfPackets()
  const { data: clowns } = useCmfClowns()
  const [open, setOpen] = useState(false)
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set())
  const [expandedPackets, setExpandedPackets] = useState<Set<string>>(new Set())

  const active: CmfPacket | undefined = packets?.find((p) => p.id === activePacketId)

  const summary = useMemo(
    () => summariseWorkspaceCoverage(packets ?? [], clowns ?? null),
    [packets, clowns]
  )

  // Build the product → packets tree. Catalog products always appear
  // (even with zero packets) so the dropdown reads as a product
  // catalog, not a packet list. Slugs not in the catalog get an
  // "Uncatalogued" group at the bottom so legacy data stays reachable.
  //
  // Cases / pouches that declare a `parentSlug` are NOT promoted to
  // top-tier nodes — instead they're attached to the parent product's
  // `cases[]` and rendered as a subsection inside the parent's
  // expansion. The generic `case` slug (no parent) and any case slug
  // whose parent is missing from the catalog stay top-level so legacy
  // data is never hidden.
  const productNodes: ProductNode[] = useMemo(() => {
    const catalog = listCmfProducts()
    const bySlug = new Map<string, ProductNode>()

    for (const product of catalog) {
      bySlug.set(product.slug, {
        product,
        fallbackSlug: null,
        displayName: product.name,
        category: product.category,
        packets: [],
        cases: [],
      })
    }

    for (const packet of packets ?? []) {
      const slug = packet.renders?.[0]?.productSlug ?? '(unknown)'
      let node = bySlug.get(slug)
      if (!node) {
        node = {
          product: null,
          fallbackSlug: slug,
          displayName: slug === '(unknown)' ? 'Uncatalogued' : slug,
          category: 'other',
          packets: [],
          cases: [],
        }
        bySlug.set(slug, node)
      }
      node.packets.push(packet)
    }

    // Wire each case/pouch product into its parent's `cases[]`. We do
    // this AFTER the packets pass so case packets are already on the
    // case node before it gets nested.
    const allNodes = Array.from(bySlug.values())
    const childSlugs = new Set<string>()
    for (const node of allNodes) {
      if (!node.product?.parentSlug) continue
      const parentNode = bySlug.get(node.product.parentSlug)
      if (!parentNode) continue
      parentNode.cases.push(node)
      childSlugs.add(node.product.slug)
    }
    // Sort the child cases for deterministic UI ordering.
    for (const node of allNodes) {
      if (node.cases.length > 1) {
        node.cases.sort((a, b) => a.displayName.localeCompare(b.displayName))
      }
    }

    return allNodes
      .filter((n) => {
        // Hide nodes that have been re-parented into another product.
        if (n.product && childSlugs.has(n.product.slug)) return false
        // Hide catalog products with zero packets unless they're a
        // top-tier "primary" product. Cases without a parent stay
        // visible so legacy `case` slug rows are still reachable.
        return n.product || n.packets.length > 0
      })
      .sort((a, b) => {
        const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
        if (cat !== 0) return cat
        return a.displayName.localeCompare(b.displayName)
      })
  }, [packets])

  // Auto-expand the product (and packet) that contains the active
  // selection so opening the dropdown reveals the current SKU set
  // without an extra click. When the active packet belongs to a case
  // sub-product (e.g. `case-aphrodite`), we ALSO expand the parent
  // product (`aphrodite`) since the case is rendered nested inside
  // it. Runs every time `activePacketId` shifts.
  useEffect(() => {
    if (!active) return
    const slug = active.renders?.[0]?.productSlug
    if (slug) {
      setExpandedProducts((prev) => {
        const next = new Set(prev)
        next.add(slug)
        // If this slug is a case with a parent in the catalog, expand
        // the parent too so the case subsection becomes visible.
        const node = productNodes.find(
          (n) =>
            n.product?.slug === slug ||
            n.cases.some((c) => c.product?.slug === slug)
        )
        if (node?.product?.slug) next.add(node.product.slug)
        return prev.size === next.size ? prev : next
      })
    }
    setExpandedPackets((prev) => {
      if (prev.has(active.id)) return prev
      const next = new Set(prev)
      next.add(active.id)
      return next
    })
  }, [active, productNodes])

  const activeTone: ReadinessTone | null = active ? packetTone(active, clowns) : null
  const activeProductSlug = active?.renders?.[0]?.productSlug ?? null
  // Resolve the active product label, looking inside parent.cases[] too
  // so a selected carry-case packet shows up as "Loop Aphrodite · Carry
  // case" rather than the bare slug.
  const activeProductLabel: string | null = (() => {
    if (!activeProductSlug) return null
    for (const n of productNodes) {
      if (n.product?.slug === activeProductSlug || n.fallbackSlug === activeProductSlug) {
        return n.displayName
      }
      const child = n.cases.find(
        (c) => c.product?.slug === activeProductSlug
      )
      if (child) return `${n.displayName} · ${child.displayName.replace(/^Loop\s+/, '')}`
    }
    return activeProductSlug
  })()

  function toggleProduct(key: string) {
    setExpandedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function togglePacket(id: string) {
    setExpandedPackets((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'group inline-flex items-center gap-3 rounded-xl border border-border/50',
            'bg-card/40 hover:bg-card/70 hover:border-border/80',
            'px-3 py-2.5 text-left transition-colors min-w-[260px]',
            'backdrop-blur-sm'
          )}
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary flex-shrink-0">
            <FileSpreadsheet className="h-4 w-4" />
            {activeTone && (
              <span
                aria-hidden
                className={cn(
                  'absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card',
                  activeTone === 'ready' && 'bg-emerald-500',
                  activeTone === 'partial' && 'bg-amber-500',
                  activeTone === 'blocked' && 'bg-rose-500',
                  activeTone === 'empty' && 'bg-muted-foreground/40'
                )}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 truncate">
              {activeProductLabel ?? 'Product'}
            </p>
            <p className="text-sm font-semibold tracking-tight truncate leading-tight">
              {isLoading
                ? 'Loading…'
                : active
                ? active.name
                : packets?.length
                ? `Browse ${productNodes.length} products`
                : 'No packets yet'}
            </p>
            {active?.cmfCode && (
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
                {active.cmfCode}
              </p>
            )}
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors flex-shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[440px] p-1.5 max-h-[70vh] overflow-y-auto"
      >
        {isLoading && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading library…
          </div>
        )}

        {/* Aggregate readiness header — same data as before, anchored above
            the catalog so a designer scanning the product list immediately
            sees how many packets need work. */}
        {!isLoading && (packets?.length ?? 0) > 0 && (
          <div className="px-3 py-2 mb-1 border-b border-border/40">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Library readiness
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                {summary.readyPackets} ready
              </span>
              {summary.partialPackets > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {summary.partialPackets} partial
                </span>
              )}
              {summary.blockedPackets > 0 && (
                <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="h-3 w-3" />
                  {summary.blockedPackets} need clowns
                </span>
              )}
            </div>
          </div>
        )}

        {!isLoading && (!packets || packets.length === 0) && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {"No packets yet. Click stage 01 'Schema' to import a workbook."}
          </p>
        )}

        {/* The 3-tier tree: products grouped by category, packets per
            product, SKUs per packet. Cases / pouches that declare a
            parentSlug appear inside their parent's expansion as a
            "Carry case" subsection so a case always reads as belonging
            to its parent product. */}
        <ul className="space-y-1.5">
          {productNodes.map((node, idx) => {
            const key = node.product?.slug ?? node.fallbackSlug ?? `product-${idx}`
            const expanded = expandedProducts.has(key)
            // Aggregate tone + counts across the parent and its child
            // case nodes so the collapsed product row reflects the
            // whole subtree, not just the parent's own packets.
            const allPackets = [...node.packets, ...node.cases.flatMap((c) => c.packets)]
            const tone = productTone(allPackets, clowns)
            const skuCount = allPackets.reduce(
              (s, p) => s + (p.renders?.length ?? 0),
              0
            )
            const isFirstInCategory =
              idx === 0 || productNodes[idx - 1].category !== node.category

            return (
              <li key={key} className="space-y-0.5">
                {isFirstInCategory && (
                  <p className="px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
                    {CATEGORY_LABEL[node.category]}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => toggleProduct(key)}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    expanded ? 'bg-muted/40' : 'hover:bg-muted/40'
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0 transition-transform',
                      expanded && 'rotate-90'
                    )}
                  />
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
                  <Package className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0" />
                  <span className="flex-1 truncate text-sm font-medium">
                    {node.displayName}
                    {node.cases.length > 0 && node.cases.some((c) => c.packets.length > 0) && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wider text-muted-foreground/60 font-normal">
                        + case
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 flex-shrink-0">
                    {allPackets.length === 0
                      ? 'no packets yet'
                      : allPackets.length === 1
                      ? `1 packet · ${skuCount} ${skuCount === 1 ? 'SKU' : 'SKUs'}`
                      : `${allPackets.length} packets · ${skuCount} SKUs`}
                  </span>
                </button>

                {expanded && allPackets.length === 0 && (
                  <p className="ml-9 mb-1 text-[11px] italic text-muted-foreground/60">
                    No packets imported for this product yet.
                  </p>
                )}

                {expanded && node.packets.length > 0 && (
                  <PacketList
                    packets={node.packets}
                    activePacketId={activePacketId}
                    expandedPackets={expandedPackets}
                    togglePacket={togglePacket}
                    clowns={clowns}
                    onSelect={onSelect}
                    onRenderFocus={onRenderFocus}
                    setOpen={setOpen}
                  />
                )}

                {expanded &&
                  node.cases.map((caseNode) => (
                    <div key={caseNode.product?.slug ?? caseNode.fallbackSlug} className="ml-3 mt-1">
                      <p className="flex items-center gap-1.5 px-1 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                        <Briefcase className="h-3 w-3 opacity-70" />
                        {caseNode.displayName.replace(/^Loop\s+/, '')}
                        <span className="ml-auto normal-case tracking-normal text-muted-foreground/50">
                          {caseNode.packets.length === 0
                            ? 'no packets yet'
                            : `${caseNode.packets.length} packet${
                                caseNode.packets.length === 1 ? '' : 's'
                              }`}
                        </span>
                      </p>
                      {caseNode.packets.length > 0 && (
                        <PacketList
                          packets={caseNode.packets}
                          activePacketId={activePacketId}
                          expandedPackets={expandedPackets}
                          togglePacket={togglePacket}
                          clowns={clowns}
                          onSelect={onSelect}
                          onRenderFocus={onRenderFocus}
                          setOpen={setOpen}
                        />
                      )}
                    </div>
                  ))}
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/* ── Packet list (shared by parent product + each case subsection) ───── */

interface PacketListProps {
  packets: CmfPacket[]
  activePacketId: string | null
  expandedPackets: Set<string>
  togglePacket: (id: string) => void
  clowns: ReturnType<typeof useCmfClowns>['data']
  onSelect: (id: string) => void
  onRenderFocus?: (packetId: string, renderId: string) => void
  setOpen: (open: boolean) => void
}

function PacketList({
  packets,
  activePacketId,
  expandedPackets,
  togglePacket,
  clowns,
  onSelect,
  onRenderFocus,
  setOpen,
}: PacketListProps) {
  return (
    <ul className="ml-3 border-l border-border/40 pl-1 space-y-0.5">
      {packets.map((packet) => {
        const isActive = packet.id === activePacketId
        const packetExpanded = expandedPackets.has(packet.id)
        const renderCount = packet.renders?.length ?? 0
        const coverage = clownCoverageForPacket(packet, clowns ?? null)
        const ptone = packetTone(packet, clowns)
        return (
          <li key={packet.id}>
            <div
              className={cn(
                'group flex items-start gap-1.5 rounded-md px-2 py-1.5 transition-colors',
                isActive ? 'bg-primary/10' : 'hover:bg-muted/40'
              )}
            >
              <button
                type="button"
                onClick={() => togglePacket(packet.id)}
                className="mt-1 flex-shrink-0 rounded p-0.5 hover:bg-muted/60"
                aria-label={packetExpanded ? 'Collapse SKUs' : 'Expand SKUs'}
              >
                <ChevronRight
                  className={cn(
                    'h-3 w-3 text-muted-foreground/60 transition-transform',
                    packetExpanded && 'rotate-90'
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelect(packet.id)
                  setOpen(false)
                }}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full flex-shrink-0',
                      ptone === 'ready' && 'bg-emerald-500',
                      ptone === 'partial' && 'bg-amber-500',
                      ptone === 'blocked' && 'bg-rose-500',
                      ptone === 'empty' && 'bg-muted-foreground/30'
                    )}
                  />
                  <p className="text-[12px] font-medium truncate">
                    {packet.cmfCode || packet.name}
                  </p>
                  {isActive && (
                    <Check className="h-3 w-3 text-primary flex-shrink-0" />
                  )}
                  <span
                    className={cn(
                      'ml-auto text-[9px] font-medium uppercase tracking-wider rounded-full px-1.5 py-0.5 flex-shrink-0',
                      packet.status === 'ready'
                        ? 'bg-primary/15 text-primary'
                        : packet.status === 'rendering'
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                        : packet.status === 'failed'
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {STATUS_LABEL[packet.status] ?? packet.status}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">
                  {packet.cmfCode ? packet.name : '—'}
                  {' · '}
                  {renderCount} {renderCount === 1 ? 'SKU' : 'SKUs'}
                  {ptone === 'blocked' && coverage.missingSlugs.length > 0 && (
                    <span className="text-rose-700 dark:text-rose-300">
                      {' · needs clown'}
                    </span>
                  )}
                </p>
              </button>
            </div>

            {packetExpanded && renderCount > 0 && (
              <ul className="ml-6 mb-1 mt-0.5 space-y-0.5 border-l border-border/30 pl-2">
                {packet.renders.map((render) => (
                  <li key={render.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(packet.id)
                        onRenderFocus?.(packet.id, render.id)
                        setOpen(false)
                      }}
                      className="w-full flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
                    >
                      <Tag className="h-2.5 w-2.5 flex-shrink-0 opacity-60" />
                      <span className="truncate">
                        {render.colorwayName ?? render.label}
                      </span>
                      <span
                        className={cn(
                          'ml-auto h-1.5 w-1.5 rounded-full flex-shrink-0',
                          render.status === 'ready' && 'bg-emerald-500',
                          render.status === 'rendering' &&
                            'bg-amber-500 animate-pulse',
                          render.status === 'failed' && 'bg-destructive',
                          (render.status === 'draft' ||
                            render.status === 'queued') &&
                            'bg-muted-foreground/30'
                        )}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
