'use client'

/**
 * Left rail of the Products dialog.
 *
 * Renders every catalog product as an indented list, with brand
 * headers grouping a parent product and its child carry case.
 * Products without a case stay flat (no header) since there's
 * nothing to disambiguate. Status dot on the left of each item;
 * packet count on the right.
 *
 * Pure presentation — selection lives in the parent dialog so a
 * second consumer (e.g. a future "library overview" page) could
 * mount the rail without dragging the rest of the dialog along.
 */

import { useMemo } from 'react'
import { Briefcase } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LibraryRollup, ProductSummary } from '@/lib/cmf/product-summary'
import { CmfStatusDot } from '../CmfStatusBadge'
import { productTone } from './tone'

type RailEntry =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; summary: ProductSummary; depth: 0 | 1 }

interface ProductsRailProps {
  rollup: LibraryRollup
  selectedSlug: string | null
  onSelect: (productSlug: string) => void
}

export function ProductsRail({
  rollup,
  selectedSlug,
  onSelect,
}: ProductsRailProps) {
  // Build the rail as a typed list of headers + items. Products with a
  // child case (carry case / pouch) get a non-clickable brand header
  // followed by each clickable variant indented underneath, so the
  // hierarchy reads as "APHRODITE → [Aphrodite, Aphrodite Carry Case]"
  // instead of two equivalent buttons.
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

  return (
    <aside className="border-r border-border/40 overflow-y-auto bg-muted/10">
      <ul className="py-2">
        {railEntries.map((entry, idx) => {
          if (entry.kind === 'header') {
            // Add visual breathing room before each new brand group
            // except the first.
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
                onClick={() => onSelect(summary.productSlug)}
                className={cn(
                  'flex w-full items-center gap-2.5 py-2.5 text-left text-sm transition-colors',
                  // Indent children of a brand header so the hierarchy
                  // reads in one glance.
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
  )
}

/**
 * Resolve the active product summary for a given slug. Centralised
 * here because the rail is the canonical source of which products
 * are visible; the parent dialog calls this with the selectedSlug to
 * get the matching summary back.
 */
export function findRailSelection(
  rollup: LibraryRollup,
  selectedSlug: string | null
): ProductSummary | null {
  if (!selectedSlug) return null
  for (const product of rollup.products) {
    if (product.productSlug === selectedSlug) return product
    for (const childCase of product.cases) {
      if (childCase.productSlug === selectedSlug) return childCase
    }
  }
  return null
}
