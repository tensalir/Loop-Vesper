'use client'

/**
 * Small pill primitives that decorate the gallery row header.
 *
 * `ApprovalBadge` summarises the per-render approval state (approved
 * vs N attempts pending review vs no attempts yet); `ReadOnlyPill` is
 * the viewer-mode lock badge rendered in place of write affordances
 * when the caller doesn't have CMF write access.
 *
 * Both are stateless and small enough to live in one file. Bigger
 * components import them by name.
 */

import { CheckCircle2, Lock } from 'lucide-react'
import type { CmfRenderAttempt } from '@/hooks/useCmf'

export function ApprovalBadge({
  approved,
  pendingCount,
}: {
  approved: CmfRenderAttempt | null
  pendingCount: number
}) {
  if (approved) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Approved · {approved.attemptNumber}
      </span>
    )
  }
  if (pendingCount === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
        No attempts yet
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-200">
      {pendingCount} {pendingCount === 1 ? 'attempt' : 'attempts'} pending review
    </span>
  )
}

/**
 * Inline pill rendered in place of write affordances when the caller
 * doesn't have CMF write access. Concise enough to sit next to the
 * approval badge without crowding the row.
 */
export function ReadOnlyPill({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
      title="CMF write access is required to mutate the library. Ask an admin to grant it from User Management."
    >
      <Lock className="h-2.5 w-2.5" />
      {label}
    </span>
  )
}
