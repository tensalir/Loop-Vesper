'use client'

/**
 * HTML preview of the CMF packet PDF.
 *
 * The preview renders the same 16:9 page model the PDF generator uses
 * (see `src/lib/cmf/document.ts`), so what designers see here is what
 * Operations gets in the final export. Editable fields are kept tight:
 *
 *   - Banner CMF code / packet name / notes
 *   - Per-SKU colourway label, subtitle, page notes
 *   - SKU ordering
 *   - Choose-an-attempt override (approve in this view, or pick a draft
 *     attempt to preview without committing approval).
 *
 * Component spec, materials, finishes, Pantone — read-only. Edit upstream
 * in the workbook. The skill's document-template reference carries the
 * rationale for what is and is not editable here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CmfDocumentDraft,
  CmfPacket,
  CmfRender,
  CmfRenderAttempt,
  useCmfAttemptAction,
  useUpdateCmfDocumentDraft,
} from '@/hooks/useCmf'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Cloud,
  CloudOff,
  Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const AUTOSAVE_DEBOUNCE_MS = 1500

type AutosaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }

interface CmfDocumentPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  packet: CmfPacket | null
  onExport: (allowDraft: boolean) => void
  exporting?: boolean
}

interface DraftState extends CmfDocumentDraft {
  // Mirror of CmfDocumentDraft for local edits; saved through the
  // update-document-draft mutation.
}

export function CmfDocumentPreviewDialog({
  open,
  onOpenChange,
  packet,
  onExport,
  exporting,
}: CmfDocumentPreviewDialogProps) {
  const updateDraft = useUpdateCmfDocumentDraft()
  const attemptAction = useCmfAttemptAction()
  const { toast } = useToast()

  const [draft, setDraft] = useState<DraftState>(() => packet?.documentDraft ?? {})
  const [autosave, setAutosave] = useState<AutosaveState>({ kind: 'idle' })
  /**
   * Last snapshot we've persisted to the server (or that the server gave us
   * on open). Used to compute "is this dirty?" and to skip noop saves. Kept
   * as a JSON string for cheap equality.
   */
  const persistedSnapshotRef = useRef<string>(
    JSON.stringify(packet?.documentDraft ?? {})
  )
  /** Track the packet identity so we don't trigger autosave on dialog open. */
  const lastPacketIdRef = useRef<string | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset local state whenever the dialog opens or the underlying packet
  // changes. Edits autosave; the snapshot starts from whatever the server
  // currently holds.
  useEffect(() => {
    if (!open) return
    const fresh = packet?.documentDraft ?? {}
    setDraft(fresh)
    persistedSnapshotRef.current = JSON.stringify(fresh)
    lastPacketIdRef.current = packet?.id ?? null
    setAutosave({ kind: 'idle' })
  }, [open, packet?.id, packet?.documentDraft])

  const pages = useMemo(() => resolvePages(packet, draft), [packet, draft])

  const skuApproved = pages.filter((p) => p.imageSource === 'approved' && p.imageUrl).length
  const skuTotal = pages.length

  /**
   * Persist the current draft right now (skip debounce). Returns the promise
   * so callers (e.g. the close handler) can await before tearing down the
   * dialog. Never throws; failures land in the autosave state.
   */
  const flushDraft = useCallback(async () => {
    if (!packet) return
    const snapshot = JSON.stringify(draft)
    if (snapshot === persistedSnapshotRef.current) return
    setAutosave({ kind: 'saving' })
    try {
      await updateDraft.mutateAsync({ packetId: packet.id, documentDraft: draft })
      persistedSnapshotRef.current = snapshot
      setAutosave({ kind: 'saved', at: Date.now() })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Autosave failed'
      setAutosave({ kind: 'error', message })
    }
  }, [packet, draft, updateDraft])

  // Debounced autosave: any change to `draft` schedules a save 1.5s later;
  // typing rapidly only fires one save at the end. We intentionally skip the
  // very first render after the dialog opens so we don't autosave the
  // freshly-loaded server state right back at it.
  useEffect(() => {
    if (!packet) return
    if (lastPacketIdRef.current !== packet.id) {
      // Dialog just opened or switched packets — let the open-effect prime
      // the snapshot before we start watching for diffs.
      lastPacketIdRef.current = packet.id
      return
    }
    const snapshot = JSON.stringify(draft)
    if (snapshot === persistedSnapshotRef.current) {
      if (autosave.kind === 'dirty') setAutosave({ kind: 'idle' })
      return
    }
    setAutosave({ kind: 'dirty' })
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      void flushDraft()
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, packet?.id])

  // Flush before the dialog closes so a quick edit + close cycle never loses
  // work. Awaits the in-flight save so the dialog only tears down once the
  // server has acknowledged.
  const handleOpenChange = useCallback(
    async (next: boolean) => {
      if (!next) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current)
          debounceTimerRef.current = null
        }
        await flushDraft()
      }
      onOpenChange(next)
    },
    [flushDraft, onOpenChange]
  )

  function patchDraft(patch: Partial<DraftState>) {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  function patchSkuOverride(renderId: string, patch: Partial<NonNullable<CmfDocumentDraft['skuOverrides']>[number]>) {
    setDraft((prev) => {
      const list = [...(prev.skuOverrides ?? [])]
      const idx = list.findIndex((o) => o.renderId === renderId)
      if (idx === -1) {
        list.push({ renderId, ...patch })
      } else {
        list[idx] = { ...list[idx], ...patch }
      }
      return { ...prev, skuOverrides: list }
    })
  }

  function moveSku(renderId: string, dir: -1 | 1) {
    setDraft((prev) => {
      const order = prev.order && prev.order.length
        ? [...prev.order]
        : pages.map((p) => p.renderId)
      const idx = order.indexOf(renderId)
      if (idx === -1) return prev
      const swapWith = idx + dir
      if (swapWith < 0 || swapWith >= order.length) return prev
      const next = [...order]
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      return { ...prev, order: next }
    })
  }

  async function handleManualSave() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    await flushDraft()
  }

  async function approveAttempt(packetId: string, attemptId: string) {
    try {
      await attemptAction.mutateAsync({ attemptId, packetId, action: 'approve' })
      toast({ title: 'Attempt approved' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Approve failed'
      toast({ title: 'Approve failed', description: message })
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-6xl w-[95vw] max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="p-5 border-b border-border/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>HTML preview · CMF packet</DialogTitle>
              <DialogDescription>
                Preview the final 16:9 pages, tweak labels and ordering, approve
                the best attempt per SKU, then export. Edits autosave; the
                workbook is still the source of truth for component spec.
              </DialogDescription>
            </div>
            <AutosaveBadge state={autosave} />
          </div>
        </DialogHeader>

        {!packet ? (
          <div className="p-10 text-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_320px] gap-0 max-h-[80vh]">
            <div className="overflow-y-auto bg-muted/40 p-5 space-y-5">
              {pages.map((page, idx) => (
                <CmfPageCard
                  key={page.renderId}
                  page={page}
                  index={idx + 1}
                  total={pages.length}
                  packet={packet}
                  cmfCode={draft.cmfCode ?? packet.cmfCode ?? 'CMF-DRAFT'}
                  packetName={draft.packetName ?? packet.name}
                  onMoveUp={() => moveSku(page.renderId, -1)}
                  onMoveDown={() => moveSku(page.renderId, 1)}
                  onColorwayChange={(v) =>
                    patchSkuOverride(page.renderId, { colorwayLabel: v })
                  }
                  onSubtitleChange={(v) =>
                    patchSkuOverride(page.renderId, { subtitle: v })
                  }
                  onNotesChange={(v) =>
                    patchSkuOverride(page.renderId, { notes: v })
                  }
                  onApproveAttempt={(attemptId) =>
                    approveAttempt(packet.id, attemptId)
                  }
                  onSelectDraftAttempt={(attemptId) =>
                    patchSkuOverride(page.renderId, {
                      imageSource: attemptId ? 'draft' : 'approved',
                      draftAttemptId: attemptId,
                    })
                  }
                />
              ))}
            </div>

            <aside className="border-t lg:border-t-0 lg:border-l border-border/40 p-5 space-y-4 overflow-y-auto">
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Status
                </p>
                <p className="text-sm font-medium">
                  {skuApproved}/{skuTotal} SKUs approved
                </p>
                {skuApproved < skuTotal && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-200">
                    Unapproved pages show with a DRAFT ribbon and export with
                    a DRAFT filename.
                  </p>
                )}
              </div>

              <Field label="Packet name">
                <Input
                  value={draft.packetName ?? packet.name}
                  onChange={(e) => patchDraft({ packetName: e.target.value })}
                  className="h-8 text-xs"
                />
              </Field>
              <Field label="CMF code">
                <Input
                  value={draft.cmfCode ?? packet.cmfCode ?? ''}
                  onChange={(e) => patchDraft({ cmfCode: e.target.value })}
                  className="h-8 text-xs font-mono"
                  placeholder="CMF-001234revA"
                />
              </Field>
              <Field label="Packet notes (footer)">
                <textarea
                  value={draft.notes ?? packet.notes ?? ''}
                  onChange={(e) => patchDraft({ notes: e.target.value })}
                  rows={4}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                />
              </Field>

              <div className="pt-2 border-t border-border/40 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/80">
                  <span>Edits autosave</span>
                  {autosave.kind === 'error' && (
                    <button
                      type="button"
                      onClick={handleManualSave}
                      className="text-destructive hover:underline"
                    >
                      Retry save
                    </button>
                  )}
                  {autosave.kind === 'dirty' && (
                    <button
                      type="button"
                      onClick={handleManualSave}
                      className="hover:text-foreground hover:underline"
                    >
                      Save now
                    </button>
                  )}
                </div>
                <Button
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => onExport(skuApproved < skuTotal)}
                  disabled={exporting || skuApproved === 0}
                >
                  {exporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {skuApproved < skuTotal ? 'Export DRAFT PDF' : 'Export final PDF'}
                </Button>
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ── Page renderer ─────────────────────────────────────────────────────── */

interface PageViewModel {
  renderId: string
  render: CmfRender
  colorwayLabel: string
  subtitle: string | null
  notes: string | null
  imageUrl: string | null
  imageSource: 'approved' | 'draft'
  attempts: CmfRenderAttempt[]
  selectedAttemptId: string | null
  draftAttemptId: string | null
}

function resolvePages(
  packet: CmfPacket | null,
  draft: CmfDocumentDraft
): PageViewModel[] {
  if (!packet) return []
  const overrides = new Map<string, NonNullable<CmfDocumentDraft['skuOverrides']>[number]>()
  for (const o of draft.skuOverrides ?? []) overrides.set(o.renderId, o)

  const orderIndex = new Map<string, number>()
  ;(draft.order ?? []).forEach((id, i) => orderIndex.set(id, i))

  const sorted = [...packet.renders].sort((a, b) => {
    const ai = orderIndex.has(a.id) ? orderIndex.get(a.id)! : 1000 + a.sortOrder
    const bi = orderIndex.has(b.id) ? orderIndex.get(b.id)! : 1000 + b.sortOrder
    return ai - bi
  })

  return sorted.map((render) => {
    const override = overrides.get(render.id)
    const attempts = (render.renderAttempts ?? []).filter(
      (a) => a.approvalStatus !== 'archived'
    )
    const approved = attempts.find((a) => a.approvalStatus === 'approved') ?? null

    let imageUrl: string | null = render.renderUrl ?? null
    let imageSource: 'approved' | 'draft' = approved ? 'approved' : 'draft'
    let draftAttemptId: string | null = null
    if (override?.imageSource === 'draft' && override.draftAttemptId) {
      const candidate = attempts.find((a) => a.id === override.draftAttemptId)
      if (candidate) {
        imageUrl = candidate.imageUrl ?? imageUrl
        imageSource = 'draft'
        draftAttemptId = candidate.id
      }
    } else if (approved) {
      imageUrl = approved.imageUrl ?? imageUrl
      imageSource = 'approved'
    } else {
      const fallback = attempts
        .filter((a) => a.status === 'ready')
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
      if (fallback) {
        imageUrl = fallback.imageUrl ?? imageUrl
        imageSource = 'draft'
      }
    }

    return {
      renderId: render.id,
      render,
      colorwayLabel:
        override?.colorwayLabel ?? render.colorwayName ?? render.label,
      subtitle: override?.subtitle ?? null,
      notes: override?.notes ?? null,
      imageUrl,
      imageSource,
      attempts,
      selectedAttemptId: render.selectedAttemptId,
      draftAttemptId,
    }
  })
}

interface CmfPageCardProps {
  page: PageViewModel
  index: number
  total: number
  packet: CmfPacket
  packetName: string
  cmfCode: string
  onMoveUp: () => void
  onMoveDown: () => void
  onColorwayChange: (v: string) => void
  onSubtitleChange: (v: string) => void
  onNotesChange: (v: string) => void
  onApproveAttempt: (attemptId: string) => void
  onSelectDraftAttempt: (attemptId: string | null) => void
}

function CmfPageCard({
  page,
  index,
  total,
  packet,
  packetName,
  cmfCode,
  onMoveUp,
  onMoveDown,
  onColorwayChange,
  onSubtitleChange,
  onNotesChange,
  onApproveAttempt,
  onSelectDraftAttempt,
}: CmfPageCardProps) {
  const isDraft = page.imageSource === 'draft'
  return (
    <article className="rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* 16:9 page */}
      <div className="relative aspect-[16/9] bg-white text-zinc-900">
        {isDraft && (
          <span className="absolute top-3 right-3 z-10 rounded-md bg-amber-500 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow-lg">
            Draft
          </span>
        )}

        {/* Banner */}
        <div className="absolute top-0 inset-x-0 h-[11%] bg-[hsl(40,45%,96%)] border-b border-zinc-200 flex items-center justify-between px-[3.75%]">
          <div className="text-left">
            <p className="text-[clamp(8px,1.1vw,12px)] font-semibold uppercase tracking-widest font-mono text-zinc-800">
              {cmfCode}
            </p>
            <p className="text-[clamp(7px,0.9vw,10px)] text-zinc-500">
              {packetName}
            </p>
          </div>
          <h3 className="text-[clamp(11px,1.5vw,16px)] font-bold uppercase tracking-widest text-purple-700">
            {page.colorwayLabel}
          </h3>
          <div className="text-right">
            <p className="text-[clamp(7px,0.9vw,10px)] font-mono text-zinc-500">
              {packet.generatedAt
                ? new Date(packet.generatedAt).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10)}
            </p>
            <p className="text-[clamp(8px,1vw,11px)] font-semibold text-zinc-800">
              Loop · CMF
            </p>
          </div>
        </div>

        {/* Hero region (left half) */}
        <div className="absolute top-[12%] left-[3.75%] bottom-[16%] w-[44%] rounded-md bg-zinc-50 border border-zinc-200 flex items-center justify-center overflow-hidden">
          {page.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={page.imageUrl}
              alt={page.colorwayLabel}
              className="max-h-full max-w-full object-contain p-3"
            />
          ) : (
            <span className="text-[10px] text-zinc-400">Render not generated</span>
          )}
        </div>

        {/* Spec table (right half) */}
        <div className="absolute top-[12%] right-[3.75%] bottom-[16%] w-[44%] flex flex-col">
          <p className="text-[clamp(8px,1vw,11px)] font-bold uppercase tracking-widest text-purple-700 mb-1">
            CMF Spec
          </p>
          <div className="flex items-center text-[clamp(6px,0.7vw,8px)] uppercase tracking-widest text-zinc-500 border-b border-zinc-200 pb-1">
            <span className="basis-[22%]">Component</span>
            <span className="basis-[22%]">Pantone</span>
            <span className="basis-[18%]">Material</span>
            <span className="basis-[18%]">Finish</span>
            <span className="basis-[20%]">Technique</span>
          </div>
          <div className="flex-1 overflow-hidden">
            {page.render.componentSpecs.slice(0, 9).map((spec) => (
              <div
                key={spec.region}
                className="flex items-center text-[clamp(7px,0.85vw,10px)] py-[3%] border-b border-zinc-100"
              >
                <span className="basis-[22%] flex items-center gap-1.5 truncate">
                  <span
                    className="h-2 w-2 rounded-sm border border-zinc-300 flex-shrink-0"
                    style={{ backgroundColor: spec.colorHex || '#e5e7eb' }}
                  />
                  <span className="font-semibold truncate">{spec.label}</span>
                </span>
                <span className="basis-[22%] font-mono truncate text-zinc-700">
                  {spec.pantone ?? spec.colorHex ?? '—'}
                </span>
                <span className="basis-[18%] truncate text-zinc-700">
                  {spec.material ?? '—'}
                </span>
                <span className="basis-[18%] truncate text-zinc-700">
                  {spec.finish ?? '—'}
                </span>
                <span className="basis-[20%] truncate text-zinc-500">
                  {spec.technique ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 inset-x-0 h-[15%] px-[3.75%] py-[1.5%] border-t border-zinc-200 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            {page.render.componentSpecs.slice(0, 5).map((spec) => (
              <div key={spec.region} className="flex items-center gap-1.5">
                <span
                  className="h-4 w-4 rounded-sm border border-zinc-300"
                  style={{ backgroundColor: spec.colorHex || '#e5e7eb' }}
                />
                <span className="text-[clamp(6px,0.7vw,9px)] font-mono text-zinc-600">
                  {spec.pantone ?? spec.colorHex ?? '—'}
                </span>
              </div>
            ))}
          </div>
          <div className="text-right">
            <p className="text-[clamp(6px,0.7vw,9px)] uppercase tracking-widest text-zinc-400">
              Identity
            </p>
            {page.render.productCode && (
              <p className="text-[clamp(7px,0.85vw,10px)] font-mono text-zinc-700">
                {page.render.productCode}
              </p>
            )}
            {page.render.ean && (
              <p className="text-[clamp(7px,0.85vw,10px)] font-mono text-zinc-700">
                EAN {page.render.ean}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Editor row */}
      <div className="grid md:grid-cols-[1fr_280px] gap-4 px-4 py-3 border-t border-border/40 bg-card/30">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
              Page {index} of {total}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-[10px] font-mono">{page.render.productSlug}</span>
            {page.imageSource === 'approved' ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-200">
                <Check className="h-2.5 w-2.5" />
                Approved
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-200">
                Draft
              </span>
            )}
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <Field label="Colourway label">
              <Input
                value={page.colorwayLabel}
                onChange={(e) => onColorwayChange(e.target.value)}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Subtitle (optional)">
              <Input
                value={page.subtitle ?? ''}
                onChange={(e) => onSubtitleChange(e.target.value)}
                className="h-8 text-xs"
              />
            </Field>
          </div>
          <Field label="Page notes (optional)">
            <textarea
              value={page.notes ?? ''}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
            />
          </Field>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/50 disabled:opacity-40"
              aria-label="Move up"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/50 disabled:opacity-40"
              aria-label="Move down"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
              Attempt
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {page.attempts.map((attempt) => {
                const isApproved = attempt.approvalStatus === 'approved'
                const isPicked =
                  page.draftAttemptId === attempt.id ||
                  (!page.draftAttemptId && isApproved)
                return (
                  <button
                    key={attempt.id}
                    type="button"
                    onClick={() => {
                      if (!isApproved) onSelectDraftAttempt(attempt.id)
                      else onSelectDraftAttempt(null)
                    }}
                    onDoubleClick={() => onApproveAttempt(attempt.id)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px]',
                      isPicked
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/50 hover:border-border'
                    )}
                    title={
                      isApproved
                        ? 'Approved — used by export'
                        : 'Click to preview as draft · double-click to approve'
                    }
                  >
                    #{attempt.attemptNumber}
                    {isApproved && <Check className="h-3 w-3" />}
                  </button>
                )
              })}
              {page.attempts.length === 0 && (
                <span className="text-[10px] text-muted-foreground">
                  No attempts yet — generate from the gallery.
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Double-click an attempt to approve it.
            </p>
          </div>
        </div>
      </div>
    </article>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
        {label}
      </Label>
      {children}
    </div>
  )
}

function AutosaveBadge({ state }: { state: AutosaveState }) {
  const [tick, setTick] = useState(0)
  // Re-render the "Saved 14s ago" timestamp every 15s so it stays accurate
  // without forcing the parent to subscribe to a clock.
  useEffect(() => {
    if (state.kind !== 'saved') return
    const id = setInterval(() => setTick((v) => v + 1), 15_000)
    return () => clearInterval(id)
  }, [state.kind])
  void tick

  if (state.kind === 'idle') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/60 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 flex-shrink-0">
        <Cloud className="h-3 w-3" />
        Up to date
      </span>
    )
  }
  if (state.kind === 'dirty') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-amber-700 dark:text-amber-200 flex-shrink-0">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Unsaved edits
      </span>
    )
  }
  if (state.kind === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-primary flex-shrink-0">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    )
  }
  if (state.kind === 'saved') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-200 flex-shrink-0"
        title={new Date(state.at).toLocaleString()}
      >
        <Check className="h-3 w-3" />
        Saved {formatAgo(state.at)}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-destructive flex-shrink-0"
      title={state.message}
    >
      <CloudOff className="h-3 w-3" />
      Autosave failed
    </span>
  )
}

function formatAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
