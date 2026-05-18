'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Sparkles, ArrowRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLatestUnseenUpdate, useMarkUpdateSeen } from '@/hooks/useProductUpdates'
import type { UpdateSnippetTag } from '@/lib/updates/types'

const TAG_LABEL: Record<UpdateSnippetTag, string> = {
  new: 'New',
  improved: 'Improved',
  fix: 'Fix',
  note: 'Note',
}

const TAG_VARIANT: Record<UpdateSnippetTag, 'default' | 'secondary' | 'outline'> = {
  new: 'default',
  improved: 'secondary',
  fix: 'outline',
  note: 'outline',
}

/**
 * Dashboard-mounted gate that shows the next unseen product update once per
 * user per release. Mounts inside `<RequireAuth>` so it never queries before
 * we know there's a real Supabase session.
 *
 * Strategy:
 *   1. Pull the latest unseen update from the server.
 *   2. Open the modal exactly once when one is returned.
 *   3. On dismiss, optimistically mark seen — the server is the source of
 *      truth so the same update never reappears, even on another device.
 */
export function UpdatesAnnouncementGate() {
  const { data: update } = useLatestUnseenUpdate()
  const markSeen = useMarkUpdateSeen()
  const [open, setOpen] = useState(false)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  useEffect(() => {
    if (update && update.id !== dismissedId) {
      setOpen(true)
    }
  }, [update, dismissedId])

  const handleClose = () => {
    if (!update) {
      setOpen(false)
      return
    }
    setDismissedId(update.id)
    setOpen(false)
    markSeen.mutate(update.id)
  }

  if (!update) return null

  const publishedDate = new Date(update.publishedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
        else setOpen(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              What&apos;s new · {publishedDate}
            </span>
          </div>
          <DialogTitle className="text-xl leading-tight">{update.title}</DialogTitle>
          {update.summary ? (
            <DialogDescription className="leading-relaxed pt-1">
              {update.summary}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {update.snippets.length > 0 && (
          <ul className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {update.snippets.map((snippet, idx) => (
              <li
                key={`${snippet.label}-${idx}`}
                className="rounded-lg border border-border/60 bg-muted/30 p-3"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground text-sm">
                    {snippet.label}
                  </span>
                  {snippet.tag ? (
                    <Badge
                      variant={TAG_VARIANT[snippet.tag]}
                      className="text-[10px] uppercase tracking-wide"
                    >
                      {TAG_LABEL[snippet.tag]}
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mt-1">
                  {snippet.body}
                </p>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button asChild variant="ghost" onClick={handleClose}>
            <Link href="/updates" className="inline-flex items-center gap-1">
              See all updates
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button onClick={handleClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
