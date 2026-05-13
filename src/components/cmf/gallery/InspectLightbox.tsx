'use client'

/**
 * Full-screen inspect view for a single attempt.
 *
 * Two-pane: image on the left, metadata + components + (optional)
 * refinement context + prompt on the right. Approve / archive
 * controls live at the bottom of the right pane so designers can
 * action straight from the lightbox without bouncing back to the
 * card.
 *
 * Read-only callers see the same data plus a `ReadOnlyPill` in place
 * of the action buttons. Refinement-reference thumbnails resolve
 * through `publicUrlForCmfStoragePathOrEmpty` so callers without the
 * Supabase env still get a clean placeholder instead of a broken
 * image.
 */

import { Archive, Check, CheckCircle2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { selectPromptVariant } from '@/lib/cmf/prompt'
import { publicUrlForCmfStoragePathOrEmpty } from '@/lib/cmf/storage'
import type { CmfRender, CmfRenderAttempt } from '@/hooks/useCmf'
import { ReadOnlyPill } from './Pills'
import { formatDuration } from './format'

interface InspectLightboxProps {
  attempt: CmfRenderAttempt
  render: CmfRender
  onClose: () => void
  onApprove: () => void
  onArchive: () => void
  canWrite: boolean
}

export function InspectLightbox({
  attempt,
  render,
  onClose,
  onApprove,
  onArchive,
  canWrite,
}: InspectLightboxProps) {
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
                  ? `${attempt.imageWidth}x${attempt.imageHeight}`
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
