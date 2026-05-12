'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CmfImportPanel } from './CmfImportPanel'

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
 * Stage-01 drawer. Reuses the existing import panel verbatim — the change
 * is just the entry surface (a focused dialog launched from the pipeline
 * stage instead of a sidebar card always present on the page).
 *
 * Note: the panel itself is left visible to read-only users so they can
 * see the merge-summary breakdown of an import that just landed; the
 * upload form returns 403 if a non-cmfAccess user submits, surfaced as
 * a toast.
 */
export function CmfImportDialog({
  open,
  onOpenChange,
  onPacketCreated,
  onRenderFocus,
}: CmfImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Stage 01 · Schema</DialogTitle>
          <DialogDescription>
            Drop in a CMF workbook (.xlsx). Vesper validates each row,
            merges into the matching packet (or creates a new one), and
            opens the result automatically.
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  )
}
