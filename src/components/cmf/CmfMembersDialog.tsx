'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useCmfMembership,
  useInviteCmfMember,
  useUpdateCmfMemberRole,
  useRemoveCmfMember,
} from '@/hooks/useCmfCollab'
import { CmfPersonAvatar } from './CmfPersonAvatar'
import { useToast } from '@/components/ui/use-toast'
import { Crown, Loader2, UserPlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CmfMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  packetId: string | null
}

/**
 * Manage a packet's members. Owner sees everyone + role/remove controls;
 * non-owners see the read-only roster (so they know who else is on the
 * packet and what role they have).
 */
export function CmfMembersDialog({ open, onOpenChange, packetId }: CmfMembersDialogProps) {
  const { data: membership, isLoading } = useCmfMembership(packetId)
  const invite = useInviteCmfMember()
  const updateRole = useUpdateCmfMemberRole()
  const remove = useRemoveCmfMember()
  const { toast } = useToast()

  const [username, setUsername] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor' | 'approver'>('editor')

  const isOwner = membership?.role === 'owner'

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!packetId) return
    if (!username.trim()) {
      toast({ title: 'Enter a username' })
      return
    }
    try {
      await invite.mutateAsync({
        packetId,
        username: username.trim(),
        role,
      })
      setUsername('')
      toast({ title: 'Member added' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invite failed'
      toast({ title: 'Could not invite', description: message })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Members</DialogTitle>
          <DialogDescription>
            Owner controls roles; everyone in the list can read the packet
            and leave comments. Editors can render and export PDFs.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading members…
          </div>
        ) : (
          <ul className="space-y-1.5">
            {membership?.owner && (
              <li className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2">
                <CmfPersonAvatar person={membership.owner} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {membership.owner.displayName ?? membership.owner.username ?? 'Owner'}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    {membership.owner.username ? `@${membership.owner.username}` : ''}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  <Crown className="h-3 w-3" />
                  Owner
                </span>
              </li>
            )}

            {(membership?.members ?? []).map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2"
              >
                <CmfPersonAvatar person={member.user} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {member.user.displayName ?? member.user.username ?? 'Member'}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    {member.user.username ? `@${member.user.username}` : ''}
                  </p>
                </div>
                {isOwner ? (
                  <div className="flex items-center gap-1.5">
                    <select
                      value={member.role}
                      disabled={updateRole.isPending}
                      onChange={async (e) => {
                        if (!packetId) return
                        try {
                          await updateRole.mutateAsync({
                            packetId,
                            userId: member.user.id,
                            role: e.target.value as 'viewer' | 'editor' | 'approver',
                          })
                          toast({ title: 'Role updated' })
                        } catch (err) {
                          const message = err instanceof Error ? err.message : 'Update failed'
                          toast({ title: 'Could not change role', description: message })
                        }
                      }}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="approver">Approver</option>
                    </select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={async () => {
                        if (!packetId) return
                        try {
                          await remove.mutateAsync({ packetId, userId: member.user.id })
                          toast({ title: 'Removed' })
                        } catch (err) {
                          const message = err instanceof Error ? err.message : 'Remove failed'
                          toast({ title: 'Could not remove', description: message })
                        }
                      }}
                      title="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-wider',
                      member.role === 'approver'
                        ? 'text-primary'
                        : member.role === 'editor'
                        ? 'text-foreground'
                        : 'text-muted-foreground'
                    )}
                  >
                    {member.role}
                  </span>
                )}
              </li>
            ))}

            {membership?.members?.length === 0 && (
              <li className="text-xs text-muted-foreground px-1">
                {isOwner
                  ? "You haven't shared this packet yet."
                  : 'No additional members yet.'}
              </li>
            )}
          </ul>
        )}

        {isOwner && (
          <form onSubmit={handleInvite} className="border-t border-border/40 pt-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                Invite by username
              </Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="damien"
                className="h-9"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <select
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'viewer' | 'editor' | 'approver')
                }
                className="h-9 rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="approver">Approver</option>
              </select>
              <Button
                type="submit"
                disabled={invite.isPending || !username.trim()}
                className="gap-1.5"
              >
                {invite.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Invite
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
