'use client'

/**
 * CMF attempt gallery — per-SKU production board.
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │ SKU header (label · slug · status · approve summary)   │
 *   ├──────────────┬───────────────┬───────────────┬─────────┤
 *   │ Attempt 03   │ Attempt 02    │ Attempt 01    │ + add   │
 *   │ approved     │ pending       │ archived      │         │
 *   ├──────────────┴───────────────┴───────────────┴─────────┤
 *   │ Refine panel (only when "Refine" is toggled on)        │
 *   ├────────────────────────────────────────────────────────┤
 *   │ Archived attempts (collapsible)                        │
 *   └────────────────────────────────────────────────────────┘
 *
 * Approval lives next to the image. Archive is reversible. Clicking
 * an attempt opens an inline lightbox with the prompt + render
 * metadata so designers can debug Nano Banana drift without leaving
 * the workspace.
 *
 * After Phase 5b the per-card / per-panel pieces live in
 * `src/components/cmf/gallery/`:
 *
 *   - `AttemptCard.tsx` — single attempt + Empty/Blocked/Shimmer cards
 *   - `Pills.tsx` — approval badge + read-only pill
 *   - `RefinePanel.tsx` — inline refinement composer + drop zone
 *   - `InspectLightbox.tsx` — full-screen inspect view
 *   - `format.ts` — `formatDuration` shared between card and lightbox
 *
 * This file is the row orchestrator: state for the active inspect /
 * refine target, the network mutations, and the action handlers that
 * wire them together.
 */

import { useMemo, useState } from 'react'
import {
  CmfRender,
  useCmfAttemptAction,
  useGenerateCmfRender,
  useUploadRefinementReferences,
  type CmfRefinementReference,
} from '@/hooks/useCmf'
import { useCmfPermissions } from '@/hooks/useCmfPermissions'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { AlertCircle, Loader2, Plus, RotateCw, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  AttemptCard,
  BlockedAttemptCard,
  EmptyAttemptCard,
  ShimmerAttemptCard,
} from './gallery/AttemptCard'
import { ApprovalBadge, ReadOnlyPill } from './gallery/Pills'
import {
  MAX_REFINEMENT_REFERENCES,
  RefinePanel,
} from './gallery/RefinePanel'
import { InspectLightbox } from './gallery/InspectLightbox'

interface CmfAttemptGalleryProps {
  render: CmfRender
  packetId: string
  /** When set, the SKU has no resolvable clown reference. The gallery
   * surfaces an "Upload clown" CTA instead of "Generate first attempt"
   * so the designer can't kick off a job that will fail with
   * category `reference` upstream. */
  blockedReason?: {
    missingSlug: string
    onUploadClown: () => void
  } | null
}

export function CmfAttemptGallery({
  render,
  packetId,
  blockedReason,
}: CmfAttemptGalleryProps) {
  const attempts = useMemo(
    () => render.renderAttempts ?? [],
    [render.renderAttempts]
  )
  const [inspectId, setInspectId] = useState<string | null>(null)
  // Iterative refinement: when set, the panel below the strip opens
  // for that attempt. We track the prompt text in a separate state so
  // it persists if the designer toggles between attempts (e.g.
  // discovers a different attempt is closer to what they want).
  const [refiningId, setRefiningId] = useState<string | null>(null)
  const [refineText, setRefineText] = useState('')
  // Phase 2: uploaded refinement references for the active panel.
  // Each entry has the storage `path` (passed to /generate) and the
  // `url` (used for the inline thumbnail). State lives at the gallery
  // level, not inside `RefinePanel`, so opening / closing the panel
  // doesn't blow away the in-flight uploads.
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
   * (not in the parent's prompt) so chains don't drift after multiple
   * hops; the parent pointer is stored for lineage display.
   */
  async function refineAttempt(
    parentAttemptId: string,
    prompt: string,
    refs: CmfRefinementReference[]
  ) {
    const trimmed = prompt.trim()
    // A refinement needs *something* to act on: either a text
    // correction OR at least one reference image. Submitting empty is
    // a no-op (the server would reject it anyway, but we want a
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
   * submit time) so they see thumbnails populate immediately and can
   * correct mistakes before committing.
   */
  async function uploadRefs(files: File[]) {
    if (files.length === 0) return
    // Soft-cap on the client to avoid uploading files that the server
    // will reject anyway. Anything past the cap gets dropped with a
    // friendly toast.
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
