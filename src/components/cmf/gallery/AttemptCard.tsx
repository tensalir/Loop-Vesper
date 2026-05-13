'use client'

/**
 * Single attempt card.
 *
 * Three distinct visual states share this component:
 *
 *   - `loading` — `status === 'rendering' | 'queued'`. Shimmer with
 *     a "Nano Banana" caption.
 *   - `failed` — `status === 'failed'`. Error chip + the attempt's
 *     short error message at the bottom.
 *   - `ready` — `status === 'ready'`. Image + approve/archive/refine
 *     controls. Approval state surfaces as a green border + corner
 *     badge.
 *
 * Refinement lineage (parent attempt + correction prompt + reference
 * count) renders as a tiny eyebrow under the image so the chain is
 * legible without opening the lightbox.
 *
 * Pure presentation — every action goes back to the parent through
 * named callbacks so the refine state can stay at the gallery root.
 */

import { Button } from '@/components/ui/button'
import { selectPromptVariant } from '@/lib/cmf/prompt'
import { cn } from '@/lib/utils'
import {
  AlertCircle,
  Archive,
  Check,
  ImageIcon,
  Loader2,
  Sparkles,
  Upload,
} from 'lucide-react'
import type { CmfRenderAttempt } from '@/hooks/useCmf'
import { formatDuration } from './format'

export interface AttemptCardProps {
  attempt: CmfRenderAttempt
  /** Number of the parent attempt this card was refined from. Null
   *  when this attempt isn't a refinement (top of the chain) OR
   *  when the parent attempt was deleted. */
  parentAttemptNumber: number | null
  onApprove: () => void
  onArchive: () => void
  onInspect: () => void
  /** Toggle the inline refine panel below the gallery strip. Same
   *  click flips it closed. */
  onRefine: () => void
  isRefining: boolean
  busy: boolean
  canWrite: boolean
}

export function AttemptCard({
  attempt,
  parentAttemptNumber,
  onApprove,
  onArchive,
  onInspect,
  onRefine,
  isRefining,
  busy,
  canWrite,
}: AttemptCardProps) {
  const isApproved = attempt.approvalStatus === 'approved'
  const isLoading = attempt.status === 'rendering' || attempt.status === 'queued'
  const isFailed = attempt.status === 'failed'
  const isRefinement = Boolean(attempt.refinementPrompt)

  return (
    <div
      className={cn(
        'group relative w-[200px] flex-shrink-0 rounded-xl border bg-background/60 transition-colors',
        isApproved
          ? 'border-emerald-500/50'
          : isFailed
          ? 'border-destructive/40'
          : 'border-border/50 hover:border-border'
      )}
    >
      <button
        type="button"
        onClick={onInspect}
        disabled={isLoading || isFailed}
        className="block w-full aspect-square rounded-t-xl overflow-hidden bg-background/40 relative"
      >
        {attempt.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={attempt.imageUrl}
            alt={`Attempt ${attempt.attemptNumber}`}
            className="w-full h-full object-contain p-3"
          />
        ) : isLoading ? (
          <div className="absolute inset-0 cmf-rendering-shimmer flex flex-col items-center justify-center text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="mt-1 text-[10px] uppercase tracking-wider">
              Nano Banana
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[10px] text-muted-foreground/70 gap-1">
            {isFailed ? (
              <>
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span>Failed</span>
              </>
            ) : (
              <>
                <ImageIcon className="h-4 w-4" />
                <span>No image</span>
              </>
            )}
          </div>
        )}
        {isApproved && (
          <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white">
            <Check className="h-2.5 w-2.5" />
            Approved
          </span>
        )}
      </button>

      <div className="px-2.5 py-2 border-t border-border/40 space-y-0.5">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">Attempt {attempt.attemptNumber}</span>
          {attempt.completedAt ? (
            <span>{formatDuration(attempt.startedAt, attempt.completedAt)}</span>
          ) : (
            <span className="text-amber-600 dark:text-amber-300">…</span>
          )}
        </div>
        <p
          className="text-[9px] uppercase tracking-widest text-muted-foreground/70 truncate"
          title="Lighting variant used for this attempt"
        >
          {/* Refinements reuse the parent's variant; the displayed
              variant index always derives from attemptNumber so this
              still reads correctly. */}
          {selectPromptVariant(
            (parentAttemptNumber ?? attempt.attemptNumber) - 1
          ).name}
        </p>
        {/* Lineage subtitle: when this attempt is a refinement of
            another, show the parent + the (truncated) correction
            text inline so the chain reads on the card without
            opening the lightbox. The `+N refs` chip surfaces the
            refinement-reference count so designers know at a glance
            which refinements were grounded in extra imagery. */}
        {isRefinement && parentAttemptNumber && (
          <p
            className="flex items-start gap-1 text-[9px] text-primary/80 leading-snug"
            title={attempt.refinementPrompt ?? undefined}
          >
            <Sparkles className="h-2.5 w-2.5 mt-px flex-shrink-0 opacity-80" />
            <span className="truncate flex-1">
              refines #{parentAttemptNumber}
              {attempt.refinementPrompt && ` — ${attempt.refinementPrompt}`}
            </span>
            {attempt.referenceImagePaths.length > 0 && (
              <span
                className="flex-shrink-0 inline-flex items-center gap-0.5 rounded-sm bg-primary/15 px-1 py-px text-[8px] font-medium text-primary"
                title={`${attempt.referenceImagePaths.length} reference image${
                  attempt.referenceImagePaths.length === 1 ? '' : 's'
                } sent alongside`}
              >
                +{attempt.referenceImagePaths.length} ref
                {attempt.referenceImagePaths.length === 1 ? '' : 's'}
              </span>
            )}
          </p>
        )}
        {/* Bare-references case: an attempt with NO textual
            refinement but with images is still a refinement (the
            references *are* the correction). Surface the chip so
            it's not invisible. */}
        {!isRefinement && attempt.referenceImagePaths.length > 0 && (
          <p className="flex items-start gap-1 text-[9px] text-primary/80 leading-snug">
            <Sparkles className="h-2.5 w-2.5 mt-px flex-shrink-0 opacity-80" />
            <span className="truncate">
              guided by {attempt.referenceImagePaths.length} reference
              {attempt.referenceImagePaths.length === 1 ? '' : 's'}
            </span>
          </p>
        )}
      </div>

      {!isLoading && !isFailed && canWrite && (
        <div className="flex items-center justify-between gap-1 px-2.5 pb-2.5">
          <div className="flex items-center gap-1">
            {!isApproved ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onApprove}
                disabled={busy}
                className="h-6 px-2 text-[10px] gap-1"
              >
                <Check className="h-3 w-3" />
                Approve
              </Button>
            ) : (
              <span className="text-[10px] text-emerald-700 dark:text-emerald-200 font-medium">
                Used by document
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={onArchive}
              disabled={busy}
              className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
            >
              <Archive className="h-3 w-3" />
              Archive
            </Button>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefine}
            disabled={busy}
            className={cn(
              'h-6 px-2 text-[10px] gap-1',
              isRefining
                ? 'text-primary'
                : 'text-muted-foreground hover:text-primary'
            )}
            title="Generate a corrected attempt from this one"
          >
            <Sparkles className="h-3 w-3" />
            Refine
          </Button>
        </div>
      )}
      {!isLoading && !isFailed && !canWrite && isApproved && (
        <div className="px-2.5 pb-2.5">
          <span className="text-[10px] text-emerald-700 dark:text-emerald-200 font-medium">
            Used by document
          </span>
        </div>
      )}

      {isFailed && attempt.error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[10px] text-destructive line-clamp-2">
          {attempt.error}
        </div>
      )}
    </div>
  )
}

/**
 * Placeholder card rendered when a SKU has no attempts yet. Click
 * triggers the same generate mutation the row's "Generate first
 * attempt" button uses.
 */
export function EmptyAttemptCard({ onGenerate }: { onGenerate: () => void }) {
  return (
    <button
      type="button"
      onClick={onGenerate}
      className="w-[200px] aspect-square flex-shrink-0 rounded-xl border border-dashed border-border/60 bg-background/40 flex flex-col items-center justify-center gap-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
    >
      <Sparkles className="h-4 w-4" />
      <span>Generate first attempt</span>
    </button>
  )
}

/**
 * Placeholder card rendered when the SKU's product has no clown
 * reference uploaded. Clicking opens the clown library upload form
 * pre-pointed at this product slug.
 */
export function BlockedAttemptCard({
  productSlug,
  onUpload,
}: {
  productSlug: string
  onUpload: () => void
}) {
  return (
    <button
      type="button"
      onClick={onUpload}
      className="w-[200px] aspect-square flex-shrink-0 rounded-xl border border-dashed border-amber-400/50 bg-amber-500/5 flex flex-col items-center justify-center gap-2 px-4 text-center text-xs text-amber-700 dark:text-amber-200 hover:border-amber-400 transition-colors"
    >
      <Upload className="h-4 w-4" />
      <span className="font-medium">No clown for this product</span>
      <span className="text-[10px] font-mono opacity-80">{productSlug}</span>
      <span className="text-[10px] underline underline-offset-2">Upload one →</span>
    </button>
  )
}

/**
 * Tiny shimmer-only card rendered to the LEFT of any in-flight
 * attempt so the strip always shows "something is happening" while
 * the new attempt rows in. Once the attempt's row arrives via
 * polling, the shimmer disappears.
 */
export function ShimmerAttemptCard() {
  return (
    <div className="w-[200px] aspect-square flex-shrink-0 rounded-xl border border-amber-400/40 bg-background/40 cmf-rendering-shimmer flex flex-col items-center justify-center gap-2 text-xs text-primary">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>New attempt</span>
    </div>
  )
}
