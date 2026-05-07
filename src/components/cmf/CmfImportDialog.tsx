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
}

/**
 * Stage-01 drawer. Reuses the existing import panel verbatim — the change
 * is just the entry surface (a focused dialog launched from the pipeline
 * stage instead of a sidebar card always present on the page).
 */
export function CmfImportDialog({ open, onOpenChange, onPacketCreated }: CmfImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Stage 01 · Schema</DialogTitle>
          <DialogDescription>
            Drop in a CMF workbook (.xlsx). Vesper validates each row and
            opens the resulting packet automatically.
          </DialogDescription>
        </DialogHeader>
        <CmfImportPanel
          onPacketCreated={(id) => {
            onPacketCreated?.(id)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
