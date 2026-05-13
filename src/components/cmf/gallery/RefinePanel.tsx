'use client'

/**
 * Inline refinement composer.
 *
 * Sits below the attempt strip when a designer clicks "Refine" on an
 * attempt card. Full-width so the textarea is comfortable; the parent
 * attempt + variant context surfaces in a tiny eyebrow so it's
 * obvious what we're refining.
 *
 * Submitting fires the same render mutation as a regular attempt but
 * with `refinementPrompt` + `parentAttemptId` populated. The new
 * attempt appears in the strip via the existing query polling.
 *
 * Reference uploads happen on-drop (not at submit time) so the
 * designer sees thumbnails populate immediately and can correct
 * mistakes before committing. The state for the in-flight refs lives
 * in the parent gallery so toggling the panel doesn't blow away
 * uploads-in-progress.
 */

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { selectPromptVariant } from '@/lib/cmf/prompt'
import { cn } from '@/lib/utils'
import type { CmfRefinementReference, CmfRenderAttempt } from '@/hooks/useCmf'

/** Phase 2 cap mirrored from the upload route. Drives both the drop-
 *  zone "X / 4" counter and the disabled state when the limit is hit.
 *  Exported so the parent gallery can use the same number when it
 *  soft-caps uploads before they hit the network. */
export const MAX_REFINEMENT_REFERENCES = 4

interface RefinePanelProps {
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
}

export function RefinePanel({
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
}: RefinePanelProps) {
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
            Optional: drop reference images (max {MAX_REFINEMENT_REFERENCES}, &le;8MB
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
            &#8984; Enter
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
