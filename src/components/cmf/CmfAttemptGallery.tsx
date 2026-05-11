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

import { useMemo, useState } from 'react'
import {
  CmfRender,
  CmfRenderAttempt,
  useCmfAttemptAction,
  useGenerateCmfRender,
} from '@/hooks/useCmf'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertCircle,
  Archive,
  Check,
  CheckCircle2,
  ImageIcon,
  Loader2,
  Plus,
  RotateCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const generateMutation = useGenerateCmfRender()
  const attemptAction = useCmfAttemptAction()
  const { toast } = useToast()

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
          {blockedReason ? (
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
              onApprove={() => runAction(attempt.id, 'approve')}
              onArchive={() => runAction(attempt.id, 'archive')}
              onInspect={() => setInspectId(attempt.id)}
              busy={attemptAction.isPending}
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
                className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-[10px] hover:bg-background"
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
  onApprove: () => void
  onArchive: () => void
  onInspect: () => void
  busy: boolean
}

function AttemptCard({
  attempt,
  onApprove,
  onArchive,
  onInspect,
  busy,
}: AttemptCardProps) {
  const isApproved = attempt.approvalStatus === 'approved'
  const isLoading = attempt.status === 'rendering' || attempt.status === 'queued'
  const isFailed = attempt.status === 'failed'

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

      <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-border/40 text-[10px] text-muted-foreground">
        <span className="font-mono">Attempt {attempt.attemptNumber}</span>
        {attempt.completedAt ? (
          <span>{formatDuration(attempt.startedAt, attempt.completedAt)}</span>
        ) : (
          <span className="text-amber-600 dark:text-amber-300">…</span>
        )}
      </div>

      {!isLoading && !isFailed && (
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
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
}: {
  attempt: CmfRenderAttempt
  render: CmfRender
  onClose: () => void
  onApprove: () => void
  onArchive: () => void
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

          {attempt.basePrompt && (
            <Section title="Prompt">
              <pre className="whitespace-pre-wrap text-[10px] text-muted-foreground/90 leading-relaxed font-mono max-h-44 overflow-y-auto">
                {attempt.basePrompt}
              </pre>
            </Section>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            {!isApproved ? (
              <Button onClick={onApprove} size="sm" className="gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Approve attempt
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                This attempt is currently approved.
              </span>
            )}
            <Button onClick={onArchive} size="sm" variant="ghost" className="gap-1.5">
              <Archive className="h-3.5 w-3.5" />
              Archive
            </Button>
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
