'use client'

/**
 * CmfProductsDialog — the canonical "what's in the library?" surface.
 *
 * Two-pane layout:
 *   - Left rail: every catalog product with status dot + packet
 *     count. Cases nested under their parent. Click selects.
 *   - Right pane: per-product overview
 *       · Header: name + category + status pill
 *       · Workbook tab: list of packets (cmfCode, status, SKU count,
 *         last edited). Each row jumps into the workspace; the
 *         trash icon opens the delete confirmation.
 *       · References tab: clown thumbnails for the product so a
 *         designer sees the "raw materials" without opening the
 *         clown library separately.
 *       · PDF tab: inline previews of every generated packet PDF.
 *
 * No filters, no search bar, no big card grid. Reading is the point —
 * if a designer wants to ACT on a product they click into a packet
 * and the workspace takes over.
 *
 * After Phase 5a the per-pane pieces live in
 * `src/components/cmf/products/`:
 *
 *   - `ProductsRail.tsx` — left rail tree
 *   - `ProductOverview.tsx` — header + tab strip
 *   - `WorkbookTab.tsx` / `ReferencesTab.tsx` / `PdfTab.tsx` — tabs
 *   - `SkuCard.tsx` — per-SKU spec card
 *   - `DeletePacketDialog.tsx` — confirmation prompt
 *   - `tone.ts` — coverage + lifecycle tone helpers
 *
 * This file is the shell that wires them together.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Library } from 'lucide-react'
import {
  summariseProductLibrary,
} from '@/lib/cmf/product-summary'
import { useCmfPermissions } from '@/hooks/useCmfPermissions'
import type { CmfClownAsset, CmfPacket } from '@/hooks/useCmf'
import { ProductsRail, findRailSelection } from './products/ProductsRail'
import { ProductOverview } from './products/ProductOverview'
import {
  DeletePacketDialog,
  type DeletePacketTarget,
} from './products/DeletePacketDialog'

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
  // level so the prompt overlays the products dialog cleanly and
  // survives re-renders of the inner tab.
  const [deleteTarget, setDeleteTarget] = useState<DeletePacketTarget | null>(null)
  const { canWrite } = useCmfPermissions()

  // Default selection: first product with packets so the dialog opens
  // on something worth reading. Re-derive when the dialog is
  // reopened.
  useEffect(() => {
    if (!open) return
    if (selectedSlug) return
    const firstWithPackets = rollup.products.find((p) => p.packets.length > 0)
    setSelectedSlug(
      firstWithPackets?.productSlug ?? rollup.products[0]?.productSlug ?? null
    )
  }, [open, rollup.products, selectedSlug])

  const selected = useMemo(
    () => findRailSelection(rollup, selectedSlug),
    [rollup, selectedSlug]
  )

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

        {/* Body: two-pane grid that owns the scrollable area. */}
        <div className="grid grid-cols-[280px_1fr] flex-1 min-h-0">
          <ProductsRail
            rollup={rollup}
            selectedSlug={selectedSlug}
            onSelect={setSelectedSlug}
          />

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

      <DeletePacketDialog
        target={deleteTarget}
        onTargetChange={setDeleteTarget}
        onDeleted={(id) => onPacketDeleted?.(id)}
      />
    </Dialog>
  )
}
