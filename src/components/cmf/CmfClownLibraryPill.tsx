'use client'

import { useMemo } from 'react'
import { useCmfClowns } from '@/hooks/useCmf'
import { cn } from '@/lib/utils'
import { ImageIcon, ChevronDown, Loader2 } from 'lucide-react'

interface CmfClownLibraryPillProps {
  onClick: () => void
}

/**
 * Top-level workspace pill for the shared clown reference library. Sits next
 * to the packet selector so the header reads as a row of workspace
 * resources — Workbooks (packet) | References (clowns) | People | Activity —
 * regardless of whether a packet is selected. Clicking opens the library
 * dialog, which is now a browseable grid rather than an upload form.
 */
export function CmfClownLibraryPill({ onClick }: CmfClownLibraryPillProps) {
  const { data: clowns, isLoading } = useCmfClowns()

  const summary = useMemo(() => {
    if (!clowns) return null
    const total = clowns.length
    const products = new Set(clowns.map((c) => c.productSlug)).size
    return { total, products }
  }, [clowns])

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-3 rounded-xl border border-border/50',
        'bg-card/40 hover:bg-card/70 hover:border-border/80',
        'px-3 py-2.5 text-left transition-colors min-w-[220px]',
        'backdrop-blur-sm'
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary flex-shrink-0">
        <ImageIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
          References
        </p>
        <p className="text-sm font-semibold tracking-tight truncate leading-tight">
          {isLoading || !summary
            ? 'Clown library'
            : summary.total === 0
            ? 'No clowns yet'
            : 'Clown library'}
        </p>
        <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          {isLoading ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Loading
            </span>
          ) : summary && summary.total > 0 ? (
            <>
              {summary.total} {summary.total === 1 ? 'asset' : 'assets'} ·{' '}
              {summary.products} {summary.products === 1 ? 'product' : 'products'}
            </>
          ) : (
            'Upload your first reference'
          )}
        </p>
      </div>
      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground transition-colors flex-shrink-0" />
    </button>
  )
}
