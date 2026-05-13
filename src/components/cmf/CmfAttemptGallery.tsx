'use client'

/**
 * CMF attempt gallery.
 *
 * Per-SKU production board:
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ SKU header (label · slug · status · approve summary)   │
 *   ├──────────────┬───────────────┬───────────────┬─────────┤
 *   │ Attempt 03   │ Attempt 02    │ Attempt 01    │ + add   │
 *   │ approved     │ pending       │ archived      │         │
 *   ├──────────────┴───────────────┴───────────────┴─────────┤
 *   │ Component chips (read-only spec preview)              │
 *   └────────────────────────────────────────────────────────┘
 *
 * Approval lives next to the image. Archive is reversible. Clicking an
 * attempt opens an inline lightbox with the prompt + render metadata so
 * designers can debug Nano Banana drift without leaving the workspace.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CmfRender,
  CmfRenderAttempt,
  useCmfAttemptAction,
  useGenerateCmfRender,
  useUploadRefinementReferences,
  type CmfRefinementReference,
} from '@/hooks/useCmf'
import { useCmfPermissions } from '@/hooks/useCmfPermissions'
import { selectPromptVariant } from '@/lib/cmf/prompt'
import { publicUrlForCmfStoragePathOrEmpty } from '@/lib/cmf/storage'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  ImageIcon,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  RotateCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/** Phase 2 cap mirrored from the upload route. Drives both the drop
 *  zone "X / 4" counter and the disabled state when the limit is hit. */
const MAX_REFINEMENT_REFERENCES = 4

interface CmfAttemptGalleryProps {
  render: CmfRender
  packetId: string
  /** When set, the SKU has no resolvable clown reference. The gallery
   * surfaces an "Upload clown" CTA instead of "Generate first attempt" so
   * the designer can't kick off a job that will fail with category
   * `reference` upstream. */
  blockedReason?: {
    missingSlug: string
    onUploadClown: () => void
  } | null
}

export function CmfAttemptGallery({ render, packetId, blockedReason }: CmfAttemptGalleryProps) {
  const attempts = useMemo(() => render.renderAttempts ?? [], [render.renderAttempts])
  const [inspectId, setInspectId] = useState<string | null>(null)
  // Iterative refinement: when set, the panel below the strip opens
  // for that attempt. We track the prompt text in a separate state so
  // it persists if the designer toggles between attempts (e.g.
  // discovers a different attempt is closer to what they want).
  const [refiningId, setRefiningId] = useState<string | null>(null)
  const [refineText, setRefineText] = useState('')
  // Phase 2: uploaded refinement references for the active panel.
  // Each entry has the storage `path` (passed to /generate) and the
  // `url` (used for the inline thumbnail). State lives at the
  // workspace level, not inside `RefinePanel`, so opening / closing
  // the panel doesn't blow away the in-flight uploads.
  const [refineRefs, setRefineRefs] = useState<CmfRefinementReference[]>([])
  const generateMutation = useGenerateCmfRender()
  const uploadRefsMutation = useUploadRefinementReferences()
  const attemptAction = useCmfAttemptAction()
  const { toast } = useToast()
  const { canWrite } = useCmfPermissions()

  // Quick lookup: attemptNumber by attempt id, used by the "refines
  // #N" subtitle on cards whose `parentAttemptId` is set.
  const attemptNumberById = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of attempts) m.set(a.id, a.attemptNumber)
    return m
  }, [attempts])

  const grouped = useMemo(() => {
    const visible = attempts.filter((a) => a.approvalStatus !== 'archived')
    const archived = attempts.filter((a) => a.approvalStatus === 'archived')
    const approved = attempts.find((a) => a.approvalStatus === 'approved') ?? null
    return { visible, archived, approved }
  }, [attempts])

  const isRendering =
    generateMutation.isPending ||
    render.status === 'rendering' ||
    render.status === 'queued' ||
    attempts.some((a) => a.status === 'rendering' || a.status === 'queued')

  async function addAttempt() {
    try {
      await generateMutation.mutateAsync({ renderId: render.id, packetId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Render failed'
      toast({ title: `Render failed: ${render.label}`, description: message })
    }
  }

  /**
   * Iterative refinement: kick off a new attempt anchored on
   * `parentAttemptId` with the refinement prompt the designer typed.
   * The render service grounds the new attempt in the workbook spec
   * (not in the parent's prompt) so chains don't drift after
   * multiple hops; the parent pointer is stored for lineage display.
   */
  async function refineAttempt(
    parentAttemptId: string,
    prompt: string,
    refs: CmfRefinementReference[]
  ) {
    const trimmed = prompt.trim()
    // A refinement needs *something* to act on: either a text
    // correction OR at least one reference image. Submitting empty
    // is a no-op (the server would reject it anyway, but we want a
    // friendly toast instead of a 400).
    if (!trimmed && refs.length === 0) {
      toast({ title: 'Add a correction or a reference first' })
      return
    }
    try {
      await generateMutation.mutateAsync({
        renderId: render.id,
        packetId,
        refinementPrompt: trimmed || undefined,
        parentAttemptId,
        referenceImagePaths: refs.map((r) => r.path),
      })
      setRefiningId(null)
      setRefineText('')
      setRefineRefs([])
      toast({
        title: 'Refined attempt queued',
        ...(refs.length > 0
          ? {
              description: `${refs.length} reference image${
                refs.length === 1 ? '' : 's'
              } sent alongside.`,
            }
          : {}),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refinement failed'
      toast({ title: `Refinement failed: ${render.label}`, description: message })
    }
  }

  /**
   * Drop-zone hook: upload the chosen files via the refinement-
   * references endpoint, append the returned descriptors to local
   * state. We upload as the user drops (rather than batching at
   * submit time) so they see thumbnails populate immediately and
   * can correct mistakes before committing.
   */
  async function uploadRefs(files: File[]) {
    if (files.length === 0) return
    // Soft-cap on the client to avoid uploading files that the
    // server will reject anyway. Anything past the cap gets dropped
    // with a friendly toast.
    const slotsLeft = MAX_REFINEMENT_REFERENCES - refineRefs.length
    if (slotsLeft <= 0) {
      toast({
        title: 'Reference limit reached',
        description: `Max ${MAX_REFINEMENT_REFERENCES} reference images per refinement.`,
      })
      return
    }
    const accepted = files.slice(0, slotsLeft)
    const rejected = files.length - accepted.length
    try {
      const result = await uploadRefsMutation.mutateAsync({
        renderId: render.id,
        files: accepted,
      })
      setRefineRefs((prev) => [...prev, ...result.references])
      if (rejected > 0) {
        toast({
          title: `Skipped ${rejected} file${rejected === 1 ? '' : 's'}`,
          description: `Cap is ${MAX_REFINEMENT_REFERENCES} reference images per refinement.`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      toast({ title: 'Reference upload failed', description: message })
    }
  }

  function removeRef(path: string) {
    setRefineRefs((prev) => prev.filter((r) => r.path !== path))
  }

  async function runAction(
    attemptId: string,
    action: 'approve' | 'archive' | 'restore'
  ) {
    try {
      await attemptAction.mutateAsync({ attemptId, packetId, action })
      const verb =
        action === 'approve' ? 'Approved' : action === 'archive' ? 'Archived' : 'Restored'
      toast({ title: `${verb} attempt` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed'
      toast({ title: `Action failed`, description: message })
    }
  }

  const inspectAttempt = inspectId
    ? attempts.find((a) => a.id === inspectId) ?? null
    : null

  return (
    <article
      id={`cmf-render-${render.id}`}
      className={cn(
        'rounded-2xl border bg-card/30 transition-colors',
        grouped.approved
          ? 'border-emerald-500/40'
          : isRendering
          ? 'border-amber-400/40'
          : render.status === 'failed'
          ? 'border-destructive/40'
          : 'border-border/50'
      )}
    >
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground/70">
            <span className="font-mono">{render.productSlug}</span>
            {render.productCode && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="font-mono">{render.productCode}</span>
              </>
            )}
          </div>
          <h3 className="mt-0.5 text-sm font-semibold tracking-tight">
            {render.colorwayName ?? render.label}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {blockedReason ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-200">
              Needs clown
            </span>
          ) : (
            <ApprovalBadge
              approved={grouped.approved}
              pendingCount={grouped.visible.length}
            />
          )}
          {!canWrite ? (
            <ReadOnlyPill label="Read-only" />
          ) : blockedReason ? (
            <Button
              size="sm"
              variant="outline"
              onClick={blockedReason.onUploadClown}
              className="h-7 gap-1.5 text-xs"
            >
              <Upload className="h-3 w-3" />
              Upload clown
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={addAttempt}
              disabled={isRendering}
              className="h-7 gap-1.5 text-xs"
            >
              {isRendering ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              {grouped.visible.length === 0 ? 'Generate first attempt' : 'New attempt'}
            </Button>
          )}
        </div>
      </header>

      {/* Attempt strip */}
      <div className="overflow-x-auto px-4 pb-3">
        <div className="flex gap-3 min-w-0">
          {blockedReason && grouped.visible.length === 0 && (
            <BlockedAttemptCard
              productSlug={blockedReason.missingSlug}
              onUpload={blockedReason.onUploadClown}
            />
          )}
          {!blockedReason && grouped.visible.length === 0 && !isRendering && (
            <EmptyAttemptCard onGenerate={addAttempt} />
          )}
          {isRendering && grouped.visible.every((a) => a.status === 'ready') && (
            <ShimmerAttemptCard />
          )}
          {grouped.visible.map((attempt) => (
            <AttemptCard
              key={attempt.id}
              attempt={attempt}
              parentAttemptNumber={
                attempt.parentAttemptId
                  ? attemptNumberById.get(attempt.parentAttemptId) ?? null
                  : null
              }
              onApprove={() => runAction(attempt.id, 'approve')}
              onArchive={() => runAction(attempt.id, 'archive')}
              onInspect={() => setInspectId(attempt.id)}
              onRefine={() => {
                setRefiningId((prev) => (prev === attempt.id ? null : attempt.id))
                // Switching panels: blank the composer state so the
                // designer doesn't accidentally apply a previous
                // attempt's correction (or carry over its uploaded
                // refs) to a different parent.
                if (refiningId !== attempt.id) {
                  setRefineText('')
                  setRefineRefs([])
                }
              }}
              isRefining={refiningId === attempt.id}
              busy={attemptAction.isPending}
              canWrite={canWrite}
            />
          ))}
        </div>
      </div>

      {render.error && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 flex items-start gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span className="leading-snug">{render.error}</span>
        </div>
      )}

      {/* Iterative refinement panel — opens below the attempt strip
          when the designer clicks "Refine" on an attempt card. Runs
          full-width here so the textarea has room to breathe (the
          200px attempt cards are too cramped for a usable input). */}
      {refiningId && canWrite && (
        <RefinePanel
          parentAttempt={attempts.find((a) => a.id === refiningId) ?? null}
          value={refineText}
          onChange={setRefineText}
          refs={refineRefs}
          onAddRefs={uploadRefs}
          onRemoveRef={removeRef}
          uploadingRefs={uploadRefsMutation.isPending}
          onCancel={() => {
            setRefiningId(null)
            setRefineText('')
            setRefineRefs([])
          }}
          onSubmit={() => refineAttempt(refiningId, refineText, refineRefs)}
          submitting={generateMutation.isPending}
        />
      )}

      {grouped.archived.length > 0 && (
        <details className="border-t border-border/40 px-4 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">
            {grouped.archived.length} archived{' '}
            {grouped.archived.length === 1 ? 'attempt' : 'attempts'}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {grouped.archived.map((attempt) => (
              <button
                key={attempt.id}
                type="button"
                onClick={() => runAction(attempt.id, 'restore')}
                disabled={!canWrite}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-[10px]',
                  canWrite
                    ? 'hover:bg-background'
                    : 'opacity-60 cursor-not-allowed'
                )}
                title={canWrite ? undefined : 'CMF write access required'}
              >
                <RotateCw className="h-3 w-3" />
                Restore attempt {attempt.attemptNumber}
              </button>
            ))}
          </div>
        </details>
      )}

      {inspectAttempt && (
        <InspectLightbox
          attempt={inspectAttempt}
          render={render}
          onClose={() => setInspectId(null)}
          onApprove={() => runAction(inspectAttempt.id, 'approve')}
          onArchive={() => runAction(inspectAttempt.id, 'archive')}
          canWrite={canWrite}
        />
      )}
    </article>
  )
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function ApprovalBadge({
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

interface AttemptCardProps {
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

function AttemptCard({
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

function EmptyAttemptCard({ onGenerate }: { onGenerate: () => void }) {
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

function BlockedAttemptCard({
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
 * Inline pill rendered in place of write affordances when the caller
 * doesn't have CMF write access. Concise enough to sit next to the
 * approval badge without crowding the row.
 */
function ReadOnlyPill({ label }: { label: string }) {
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

/**
 * Inline refinement composer. Sits below the attempt strip when a
 * designer clicks "Refine" on an attempt. Full-width so the textarea
 * is comfortable; the parent attempt + variant context surfaces in a
 * tiny eyebrow so it's obvious what we're refining.
 *
 * Submitting fires the same render mutation with `refinementPrompt`
 * + `parentAttemptId` populated. The new attempt appears in the
 * strip via the existing query polling.
 */
function RefinePanel({
  parentAttempt,
  value,
  onChange,
  refs,
  onAddRefs,
  onRemoveRef,
  uploadingRefs,
  onCancel,
  onSubmit,
  submitting,
}: {
  parentAttempt: CmfRenderAttempt | null
  value: string
  onChange: (v: string) => void
  refs: CmfRefinementReference[]
  onAddRefs: (files: File[]) => void
  onRemoveRef: (path: string) => void
  uploadingRefs: boolean
  onCancel: () => void
  onSubmit: () => void
  submitting: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Visual feedback for drag-over without bouncing on every dragenter
  // / dragleave caused by child elements; ref-counted via local state.
  const [dragDepth, setDragDepth] = useState(0)
  const isDragging = dragDepth > 0

  // Reset the drag counter if the panel re-renders / changes parent
  // mid-drag; otherwise the highlighted state can stick.
  useEffect(() => {
    setDragDepth(0)
  }, [parentAttempt?.id])

  if (!parentAttempt) return null
  const variantName = selectPromptVariant(
    parentAttempt.attemptNumber - 1
  ).name

  const slotsLeft = MAX_REFINEMENT_REFERENCES - refs.length
  const canAddMore = slotsLeft > 0
  const hasContent = Boolean(value.trim()) || refs.length > 0
  const busy = submitting || uploadingRefs

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    onAddRefs(Array.from(files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="border-t border-primary/30 bg-primary/[0.04] px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-primary/80">
          <Sparkles className="h-3 w-3" />
          Refining attempt {parentAttempt.attemptNumber} · {variantName}
        </p>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground transition-colors disabled:opacity-50"
          aria-label="Close refinement panel"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What should change? e.g. 'make the black more holographic, less satin' or 'match the chrome accent on the attached reference'"
        rows={3}
        maxLength={2000}
        disabled={submitting}
        className="w-full rounded-md border border-border/50 bg-background/60 px-3 py-2 text-xs leading-relaxed placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none disabled:opacity-60"
        onKeyDown={(e) => {
          // Cmd/Ctrl + Enter submits — fast iteration loop.
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !busy && hasContent) {
            e.preventDefault()
            onSubmit()
          }
        }}
      />

      {/* Drop zone for refinement reference images. Click opens the
          system file picker; drag-drop accepts the same files. We
          upload-on-drop so the designer sees thumbnails populate
          before committing to "Generate refined attempt".  */}
      <div className="mt-2 flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => canAddMore && !busy && fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragDepth((d) => d + 1)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setDragDepth((d) => Math.max(0, d - 1))
          }}
          onDragOver={(e) => {
            // Required: without this the browser refuses the drop.
            e.preventDefault()
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragDepth(0)
            if (!canAddMore || busy) return
            handleFiles(e.dataTransfer?.files ?? null)
          }}
          disabled={!canAddMore || busy}
          aria-label="Add reference images for this refinement"
          className={cn(
            'group flex-shrink-0 flex flex-col items-center justify-center gap-1 w-[88px] h-[88px] rounded-md border border-dashed text-[10px] transition-colors',
            isDragging
              ? 'border-primary bg-primary/10 text-primary'
              : canAddMore && !busy
              ? 'border-border/60 bg-background/40 text-muted-foreground hover:border-primary/40 hover:text-primary'
              : 'border-border/40 bg-muted/20 text-muted-foreground/40 cursor-not-allowed'
          )}
        >
          {uploadingRefs ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          <span className="font-medium">
            {canAddMore ? 'Add refs' : 'Max reached'}
          </span>
          <span className="opacity-70">
            {refs.length}/{MAX_REFINEMENT_REFERENCES}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {refs.length === 0 ? (
          <div className="flex-1 flex items-center justify-start px-3 text-[10px] leading-snug text-muted-foreground/60">
            Optional: drop reference images (max {MAX_REFINEMENT_REFERENCES}, ≤8MB
            each) to guide the model alongside the canonical product reference.
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-2 overflow-x-auto py-0.5">
            {refs.map((ref) => (
              <div
                key={ref.path}
                className="relative flex-shrink-0 w-[72px] h-[88px] rounded-md border border-border/50 bg-background/60 overflow-hidden group"
                title={ref.filename}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.url}
                  alt={ref.filename}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemoveRef(ref.path)}
                  disabled={busy}
                  aria-label={`Remove ${ref.filename}`}
                  className="absolute top-0.5 right-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/85 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 mt-2.5">
        <p className="text-[10px] text-muted-foreground/60">
          Grounded in the spec — won&rsquo;t drift from the brief.{' '}
          <kbd className="rounded border border-border/40 bg-background/40 px-1 font-mono text-[9px]">
            ⌘ Enter
          </kbd>{' '}
          to submit.
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
            className="h-7 px-2 text-[11px]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSubmit}
            disabled={busy || !hasContent}
            className="h-7 px-3 text-[11px] gap-1.5"
          >
            {submitting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Generate refined attempt
          </Button>
        </div>
      </div>
    </div>
  )
}

function ShimmerAttemptCard() {
  return (
    <div className="w-[200px] aspect-square flex-shrink-0 rounded-xl border border-amber-400/40 bg-background/40 cmf-rendering-shimmer flex flex-col items-center justify-center gap-2 text-xs text-primary">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>New attempt</span>
    </div>
  )
}

function InspectLightbox({
  attempt,
  render,
  onClose,
  onApprove,
  onArchive,
  canWrite,
}: {
  attempt: CmfRenderAttempt
  render: CmfRender
  onClose: () => void
  onApprove: () => void
  onArchive: () => void
  canWrite: boolean
}) {
  const isApproved = attempt.approvalStatus === 'approved'
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-5xl max-h-[90vh] grid md:grid-cols-[1.5fr_1fr] gap-0 rounded-2xl border border-border bg-card overflow-hidden"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 hover:bg-background"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="bg-black/30 flex items-center justify-center min-h-[280px] md:min-h-0">
          {attempt.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attempt.imageUrl}
              alt={`Attempt ${attempt.attemptNumber}`}
              className="w-full max-h-[80vh] object-contain"
            />
          ) : (
            <div className="text-muted-foreground text-sm">No image</div>
          )}
        </div>

        <div className="p-5 overflow-y-auto max-h-[80vh] space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
              {render.productSlug} · Attempt {attempt.attemptNumber}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              {render.colorwayName ?? render.label}
            </h2>
            {isApproved && (
              <span className="inline-flex items-center gap-1 mt-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-200">
                <CheckCircle2 className="h-3 w-3" />
                Approved
              </span>
            )}
          </div>

          <Section title="Metadata">
            <KeyVal k="Model" v={attempt.modelId ?? '—'} />
            <KeyVal
              k="Variant"
              v={selectPromptVariant(attempt.attemptNumber - 1).name}
            />
            <KeyVal
              k="Resolution"
              v={
                attempt.imageWidth && attempt.imageHeight
                  ? `${attempt.imageWidth}×${attempt.imageHeight}`
                  : '—'
              }
            />
            <KeyVal
              k="Duration"
              v={formatDuration(attempt.startedAt, attempt.completedAt)}
            />
            <KeyVal
              k="Cost"
              v={attempt.costUsd != null ? `$${attempt.costUsd}` : '—'}
            />
          </Section>

          <Section title="Components">
            <ul className="space-y-1.5">
              {render.componentSpecs.map((spec) => (
                <li
                  key={spec.region}
                  className="flex items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-border/50 flex-shrink-0"
                    style={{ backgroundColor: spec.colorHex || 'hsl(var(--muted))' }}
                  />
                  <span className="font-medium text-foreground">{spec.label}</span>
                  <span className="font-mono">{spec.pantone ?? spec.colorHex ?? '—'}</span>
                </li>
              ))}
            </ul>
          </Section>

          {(attempt.refinementPrompt || attempt.referenceImagePaths.length > 0) && (
            <Section title="Refinement">
              {attempt.refinementPrompt && (
                <p
                  className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-[11px] leading-relaxed text-foreground/90 mb-2"
                  title="The correction the designer applied on top of the spec"
                >
                  <span className="inline-flex items-center gap-1 mr-1.5 text-[9px] uppercase tracking-widest text-primary/80">
                    <Sparkles className="h-2.5 w-2.5" />
                    Correction
                  </span>
                  {attempt.refinementPrompt}
                </p>
              )}
              {attempt.referenceImagePaths.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground/70">
                    {attempt.referenceImagePaths.length} reference image
                    {attempt.referenceImagePaths.length === 1 ? '' : 's'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {attempt.referenceImagePaths.map((path, i) => {
                      const url = publicUrlForCmfStoragePathOrEmpty(path)
                      return (
                        <a
                          key={path}
                          href={url || undefined}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-[64px] h-[64px] rounded-md border border-border/50 bg-background/60 overflow-hidden hover:border-primary/50 transition-colors"
                          title={`Reference ${i + 1} — open full size`}
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={url}
                              alt={`Reference ${i + 1}`}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full text-[9px] text-muted-foreground">
                              ref {i + 1}
                            </div>
                          )}
                        </a>
                      )
                    })}
                  </div>
                </div>
              )}
            </Section>
          )}

          {attempt.basePrompt && (
            <Section title="Prompt">
              <pre className="whitespace-pre-wrap text-[10px] text-muted-foreground/90 leading-relaxed font-mono max-h-44 overflow-y-auto">
                {attempt.basePrompt}
              </pre>
            </Section>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            {!canWrite ? (
              <ReadOnlyPill label="Read-only · request CMF write from admin" />
            ) : !isApproved ? (
              <>
                <Button onClick={onApprove} size="sm" className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Approve attempt
                </Button>
                <Button onClick={onArchive} size="sm" variant="ghost" className="gap-1.5">
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </Button>
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">
                  This attempt is currently approved.
                </span>
                <Button onClick={onArchive} size="sm" variant="ghost" className="gap-1.5">
                  <Archive className="h-3.5 w-3.5" />
                  Archive
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
        {title}
      </h3>
      <div>{children}</div>
    </div>
  )
}

function KeyVal({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-foreground">{v}</span>
    </div>
  )
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}
