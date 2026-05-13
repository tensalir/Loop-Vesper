'use client'

/**
 * Confirmation prompt for packet deletion.
 *
 * Destructive operations should require a deliberate "yes". The copy
 * spells out exactly what will be lost (SKU count, attempts,
 * approvals, exported PDFs) so a designer can't nuke a packet they
 * meant to keep.
 *
 * Lifted out of `CmfProductsDialog` so the shell stays focused on
 * the rail/overview composition. The mutation lives here too — the
 * dialog is the only caller, so co-locating the network call with
 * the confirmation UI keeps the contract obvious: "open this dialog
 * with a target, delete fires when the user confirms".
 */

import { Loader2, Trash2 } from 'lucide-react'
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
import { useDeleteCmfPacket } from '@/hooks/useCmf'
import { useToast } from '@/components/ui/use-toast'

export interface DeletePacketTarget {
  id: string
  name: string
  cmfCode: string | null
  skuCount: number
}

interface DeletePacketDialogProps {
  /** Target packet, or null when the dialog is closed. */
  target: DeletePacketTarget | null
  /** Fired with `null` when the user cancels (so the parent can clear
   *  its `deleteTarget` state). */
  onTargetChange: (next: DeletePacketTarget | null) => void
  /** Fired after a successful delete with the deleted packet id, so
   *  the workspace can clear `activePacketId` if it matches. */
  onDeleted: (packetId: string) => void
}

export function DeletePacketDialog({
  target,
  onTargetChange,
  onDeleted,
}: DeletePacketDialogProps) {
  const deleteMutation = useDeleteCmfPacket()
  const { toast } = useToast()

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(next) => {
        // Block close while the network call is in flight so the user
        // can't double-fire (the spinner wouldn't even have time to
        // show otherwise).
        if (!next && !deleteMutation.isPending) onTargetChange(null)
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
                {target?.name ?? ''}
              </span>{' '}
              — {target?.skuCount ?? 0}{' '}
              {target?.skuCount === 1 ? 'SKU' : 'SKUs'} and every attempt,
              approval, and exported PDF tied to this packet.
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
              if (!target) return
              try {
                await deleteMutation.mutateAsync({ packetId: target.id })
                toast({
                  title: 'Packet deleted',
                  description: `${target.name} removed from the library.`,
                })
                onDeleted(target.id)
                onTargetChange(null)
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
  )
}
