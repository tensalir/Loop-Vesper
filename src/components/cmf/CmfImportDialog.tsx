'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CmfImportPanel } from './CmfImportPanel'
import { CmfReferenceUploadInline } from './CmfReferenceUploadInline'
import { Database, ImageIcon } from 'lucide-react'

interface CmfImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPacketCreated?: (packetId: string) => void
  /** Forwarded to the underlying CmfImportPanel — fires when a designer
   *  clicks a changed SKU in the merge summary so the workspace can
   *  jump straight to it. */
  onRenderFocus?: (packetId: string, renderId: string) => void
}

/**
 * Unified import dialog — one place to drop both the workbook AND the
 * clown reference zips when setting up a new product launch.
 *
 * Schema (workbook) and References (clown library) used to be two
 * separate stages in the pipeline, but they're really part of the same
 * preflight: a designer launching a new colourway uploads BOTH the
 * Excel and the clown PNGs at the same time. Splitting them across
 * two pipeline stages added clicks without adding clarity.
 *
 * Two stacked sections:
 *   1. Workbook (.xlsx) — the source of truth for SKUs / components
 *      / palettes. Submitting this section creates or merges packets.
 *   2. Reference zips — the clown PNGs the recolour pass uses.
 *      Optional. Server maps each zip filename to a product slug.
 *
 * Both sections submit independently so a designer can re-open the
 * dialog later to add references without re-uploading the workbook,
 * or vice-versa.
 *
 * Read-only users see both sections; their submits return 403 as a
 * toast (the API enforces cmfAccess for both endpoints).
 */
export function CmfImportDialog({
  open,
  onOpenChange,
  onPacketCreated,
  onRenderFocus,
}: CmfImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add to library</DialogTitle>
          <DialogDescription>
            Drop a workbook to import SKUs, and optionally upload the
            matching clown reference zips. Both run independently so
            you can come back later to fill the other half.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-1">
          <Section
            icon={Database}
            title="Workbook"
            subtitle="CMF schema (.xlsx) — required to create or merge a packet"
          >
            <CmfImportPanel
              onPacketCreated={(id) => {
                onPacketCreated?.(id)
                onOpenChange(false)
              }}
              onRenderFocus={(packetId, renderId) => {
                onRenderFocus?.(packetId, renderId)
                onOpenChange(false)
              }}
            />
          </Section>

          <div className="border-t border-border/40" />

          <Section
            icon={ImageIcon}
            title="References"
            subtitle="Clown PNG zip(s) — feeds the recolour pass. Optional."
          >
            <CmfReferenceUploadInline />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
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
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <header className="space-y-0.5">
        <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-foreground">
          <Icon className="h-3 w-3 opacity-70" />
          {title}
        </h3>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {subtitle}
        </p>
      </header>
      {children}
    </section>
  )
}
