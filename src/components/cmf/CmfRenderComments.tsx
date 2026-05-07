'use client'

import { useState } from 'react'
import {
  useCmfComments,
  useCreateCmfComment,
  useDeleteCmfComment,
  useResolveCmfComment,
  type CmfComment,
} from '@/hooks/useCmfCollab'
import { useProfile } from '@/hooks/useProfile'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CmfPersonAvatar } from './CmfPersonAvatar'
import { useToast } from '@/components/ui/use-toast'
import { Check, CheckCircle2, Loader2, MessageSquare, Send, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CmfRenderCommentsProps {
  packetId: string
  renderId: string
  /** Compact toggle initial state — hidden until designer clicks "Discuss". */
  initiallyOpen?: boolean
}

/**
 * Per-SKU comment thread. Designed to live inside a render row's spec
 * column: collapsed by default to a count badge, expandable to a thread
 * with composer. Anyone with packet access can read or comment; resolving
 * requires editor+.
 */
export function CmfRenderComments({ packetId, renderId, initiallyOpen = false }: CmfRenderCommentsProps) {
  const [open, setOpen] = useState(initiallyOpen)
  const [draft, setDraft] = useState('')
  const { data: profile } = useProfile()
  const { data: comments, isLoading } = useCmfComments(packetId, renderId)
  const create = useCreateCmfComment()
  const resolve = useResolveCmfComment()
  const remove = useDeleteCmfComment()
  const { toast } = useToast()

  const openCount = (comments ?? []).filter((c) => !c.resolvedAt).length
  const totalCount = comments?.length ?? 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    try {
      await create.mutateAsync({
        packetId,
        renderId,
        body: draft.trim(),
      })
      setDraft('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Comment failed'
      toast({ title: 'Could not comment', description: message })
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
        {totalCount === 0
          ? 'Discuss'
          : openCount > 0
          ? `${openCount} open · ${totalCount} total`
          : `All resolved (${totalCount})`}
      </button>

      {open && (
        <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          )}

          {!isLoading && (!comments || comments.length === 0) && (
            <p className="text-[11px] text-muted-foreground/80 italic">
              No comments yet. Drop a note for the team.
            </p>
          )}

          <ul className="space-y-2">
            {comments?.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                isAuthor={comment.userId === profile?.id}
                onResolve={async () => {
                  try {
                    await resolve.mutateAsync({
                      commentId: comment.id,
                      resolved: !comment.resolvedAt,
                      packetId,
                      renderId,
                    })
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Update failed'
                    toast({ title: 'Could not update', description: message })
                  }
                }}
                onDelete={async () => {
                  try {
                    await remove.mutateAsync({
                      commentId: comment.id,
                      packetId,
                      renderId,
                    })
                  } catch (err) {
                    const message = err instanceof Error ? err.message : 'Delete failed'
                    toast({ title: 'Could not delete', description: message })
                  }
                }}
              />
            ))}
          </ul>

          <form onSubmit={handleSubmit} className="space-y-1.5">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a note for the team…"
              rows={2}
              className="text-xs resize-none min-h-[56px]"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Pinned to this SKU
              </span>
              <Button
                type="submit"
                size="sm"
                disabled={create.isPending || !draft.trim()}
                className="h-7 gap-1.5 text-xs"
              >
                {create.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Post
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

interface CommentRowProps {
  comment: CmfComment
  isAuthor: boolean
  onResolve: () => void
  onDelete: () => void
}

function CommentRow({ comment, isAuthor, onResolve, onDelete }: CommentRowProps) {
  const resolved = !!comment.resolvedAt
  return (
    <li
      className={cn(
        'rounded-md border border-border/30 bg-card/40 p-2.5 transition-opacity',
        resolved && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2">
        <CmfPersonAvatar person={comment.user} size="xs" className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-[11px] font-medium leading-tight">
            {comment.user.displayName ?? comment.user.username ?? 'Someone'}
            <span className="ml-2 text-[10px] font-normal text-muted-foreground/70 uppercase tracking-wider">
              {new Date(comment.createdAt).toLocaleString()}
            </span>
          </p>
          <p className="text-xs whitespace-pre-wrap leading-snug">{comment.body}</p>
          {resolved && (
            <p className="inline-flex items-center gap-1 text-[10px] text-primary">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Resolved
            </p>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onResolve}
            className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors"
            title={resolved ? 'Reopen' : 'Resolve'}
          >
            <Check className="h-3 w-3" />
          </button>
          {isAuthor && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
