'use client'

/**
 * References tab — clown thumbnails for the selected product.
 *
 * Shows every variant the library knows about for this product,
 * sorted by `variantSlug`. The "Update references" affordance
 * triggers the parent's standalone clown library dialog with the
 * upload form pre-pointed at this product, so a designer can drop
 * new PNGs without losing context.
 */

import { AlertTriangle, Upload } from 'lucide-react'
import type { CmfClownAsset } from '@/hooks/useCmf'

interface ReferencesTabProps {
  clowns: CmfClownAsset[]
  onUpdateReferences: () => void
}

export function ReferencesTab({ clowns, onUpdateReferences }: ReferencesTabProps) {
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
          dialog pre-focused on this product. Same idempotent posture
          as the workbook updater: re-uploading a clown with the same
          (productSlug, variantSlug) replaces the prior asset rather
          than duplicating. */}
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
