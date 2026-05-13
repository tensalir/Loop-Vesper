'use client'

import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useImportCmfWorkbook,
  type CmfImportDroppedSkuColumn,
  type CmfImportUnrecognisedSheet,
  type CmfMergeSummary,
} from '@/hooks/useCmf'
import { useToast } from '@/components/ui/use-toast'
import { listExpectedSheetNames } from '@/lib/cmf/products'
import {
  Upload,
  Download,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Package,
  ArrowUpRight,
  XCircle,
  FileQuestion,
} from 'lucide-react'

interface CmfImportPanelProps {
  /**
   * Fires whenever the workspace should adopt a new packet id.
   *
   * `source` distinguishes the two distinct hand-off moments:
   *   - `'auto'` is fired right after a successful import — the
   *     workspace switches in the background so the underlying
   *     gallery is already on the new packet when the designer
   *     closes the dialog.
   *   - `'explicit'` is fired when the designer clicks a packet
   *     in the success summary or the prominent "Open packet"
   *     CTA — a deliberate handoff, so the dialog should close.
   */
  onPacketCreated?: (packetId: string, source: 'auto' | 'explicit') => void
  /** Called when the user clicks a changed SKU in the merge summary so
   *  the workspace can scroll to that row. */
  onRenderFocus?: (packetId: string, renderId: string) => void
}

interface CreatedPacketSummary {
  id: string
  name: string
  productSlug: string | null
  productName: string | null
  renderCount: number
  mergeSummary?: CmfMergeSummary
}

/**
 * Everything the parser told us about WHY a sheet/column was skipped.
 * Surfaced together so a designer can correlate "unmapped Switch 3 tab"
 * with "all my SKU columns came back as placeholder" in one glance.
 *
 * Empty arrays are normal on a clean import; we still hold the shape
 * here so the rendering paths can branch on `hasAnyWarnings` without
 * juggling separate optional fields.
 */
interface ImportDiagnostics {
  unmappedSheets: string[]
  unrecognisedSheets: CmfImportUnrecognisedSheet[]
  droppedSkuColumns: CmfImportDroppedSkuColumn[]
  rowErrors: Array<{ rowIndex: number; field?: string; message: string }>
}

function emptyDiagnostics(): ImportDiagnostics {
  return {
    unmappedSheets: [],
    unrecognisedSheets: [],
    droppedSkuColumns: [],
    rowErrors: [],
  }
}

function hasAnyWarnings(d: ImportDiagnostics): boolean {
  return (
    d.unmappedSheets.length > 0 ||
    d.unrecognisedSheets.length > 0 ||
    d.droppedSkuColumns.length > 0 ||
    d.rowErrors.length > 0
  )
}

export function CmfImportPanel({ onPacketCreated, onRenderFocus }: CmfImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [packetName, setPacketName] = useState('')
  const [cmfCode, setCmfCode] = useState('')
  // Combined diagnostics. Replaced the old standalone `errors` array
  // because we now also surface unmapped sheets, unrecognised sheets,
  // and placeholder/empty SKU columns from the parser. Keeping them in
  // one bag keeps the render branches honest about the four panel
  // states (clean / partial / empty / error).
  const [diagnostics, setDiagnostics] = useState<ImportDiagnostics>(emptyDiagnostics)
  const [lastSuccess, setLastSuccess] = useState<{
    rows: number
    packets: CreatedPacketSummary[]
  } | null>(null)
  /** True when the most recent import returned `rowCount === 0` —
   *  used to flip the success block off and the empty-result panel on
   *  even when the API technically returned 200. */
  const [emptyResult, setEmptyResult] = useState<{ shown: boolean } | null>(null)
  const importMutation = useImportCmfWorkbook()
  const { toast } = useToast()
  const expectedSheets = useMemo(() => listExpectedSheetNames(), [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      toast({ title: 'No file', description: 'Pick an .xlsx workbook to import.' })
      return
    }
    setDiagnostics(emptyDiagnostics())
    setLastSuccess(null)
    setEmptyResult(null)
    try {
      const result = await importMutation.mutateAsync({
        file,
        packetName: packetName || undefined,
        cmfCode: cmfCode || undefined,
        createPacket: true,
      })

      // Capture every parser warning in one bag so the rendering branches
      // can show them together regardless of whether the import as a
      // whole succeeded.
      const captured: ImportDiagnostics = {
        unmappedSheets: result.import.unmappedSheets ?? [],
        unrecognisedSheets: result.import.unrecognisedSheets ?? [],
        droppedSkuColumns: result.import.droppedSkuColumns ?? [],
        rowErrors: result.import.errors,
      }
      setDiagnostics(captured)

      const createdPackets: CreatedPacketSummary[] = (result.packets ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        productSlug: p.productSlug,
        productName: p.productName,
        renderCount: p.renderCount,
        mergeSummary: p.mergeSummary,
      }))
      const packetCount = createdPackets.length || (result.packet ? 1 : 0)
      // Aggregate diff stats across every packet so the toast can lead
      // with the human-meaningful summary instead of "X rows imported".
      const aggregate = createdPackets.reduce(
        (acc, p) => {
          const m = p.mergeSummary
          if (!m) return acc
          acc.added += m.added
          acc.updated += m.updated
          acc.unchanged += m.unchanged
          if (m.kind === 'merged') acc.mergedPackets++
          else acc.createdPackets++
          return acc
        },
        { added: 0, updated: 0, unchanged: 0, mergedPackets: 0, createdPackets: 0 }
      )
      // Compact "Switch 2, Cocoon" summary; falls back to packet name when
      // the catalog doesn't know the slug (so we never silently lose info).
      const productListLabel = createdPackets
        .map((p) => p.productName ?? p.name)
        .join(', ')

      // Branch on the four panel states:
      //
      //   - Empty: the parser produced 0 rows. The old code paired this
      //     with a cheery "Workbook imported" toast which left designers
      //     thinking the import succeeded; now we show the empty-result
      //     panel and a destructive toast so it reads as the failure it
      //     actually is.
      //
      //   - Partial / Clean: rows landed AND packets were created. The
      //     warnings panel renders alongside the success block when
      //     diagnostics exist; otherwise the success block stands alone.
      //
      //   - Row errors with rows > 0: surfaced inside the warnings panel
      //     (no longer a separate code path).
      const importedZeroRows = result.import.rowCount === 0
      if (importedZeroRows) {
        setEmptyResult({ shown: true })
        setLastSuccess(null)
        toast({
          title: 'No SKUs imported',
          description:
            'We couldn’t read any SKUs from this workbook. See the details panel for what went wrong.',
        })
      } else {
        setLastSuccess({ rows: result.import.rowCount, packets: createdPackets })
        const verbBits: string[] = []
        if (aggregate.added > 0) verbBits.push(`${aggregate.added} added`)
        if (aggregate.updated > 0) verbBits.push(`${aggregate.updated} changed`)
        if (aggregate.unchanged > 0) verbBits.push(`${aggregate.unchanged} unchanged`)
        const verb = verbBits.join(' · ') || `${result.import.rowCount} rows`
        toast({
          title:
            aggregate.mergedPackets > 0 && aggregate.createdPackets === 0
              ? 'Merged into existing packets'
              : aggregate.mergedPackets > 0
              ? 'Mixed import: created + merged'
              : 'Workbook imported',
          description:
            packetCount > 1 && productListLabel
              ? `${verb} across ${packetCount} packets (${productListLabel})`
              : `${verb}${productListLabel ? ` — ${productListLabel}` : ''}`,
        })
      }

      if (result.packet?.id) {
        // Auto-switch the workspace in the background so the gallery
        // underneath the dialog is already on the new packet. The
        // dialog itself stays open so the designer can see the
        // success summary and click "Open packet" — that's where the
        // explicit handoff happens. Skipped on empty imports because
        // there's no packet to switch to.
        onPacketCreated?.(result.packet.id, 'auto')
      }
      // reset selection so the same file can be re-imported after edits
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      toast({ title: 'Import failed', description: message })
    }
  }

  async function handleDownloadTemplate() {
    const res = await fetch('/api/cmf/template?productSlug=switch2')
    if (!res.ok) {
      toast({ title: 'Failed to download template' })
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'cmf-template-switch2.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Workbook (.xlsx)
        </Label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        {file && (
          <p className="text-xs text-muted-foreground truncate">{file.name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Packet name (optional)
        </Label>
        <Input
          value={packetName}
          onChange={(e) => setPacketName(e.target.value)}
          placeholder="Switch 2 Spring 2026"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          CMF code (optional)
        </Label>
        <Input
          value={cmfCode}
          onChange={(e) => setCmfCode(e.target.value)}
          placeholder="CMF-001234revA"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={importMutation.isPending} className="gap-2">
          {importMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          Import
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDownloadTemplate}
          className="gap-1.5 text-xs"
        >
          <Download className="h-3.5 w-3.5" />
          Template
        </Button>
      </div>

      {/* Persistent expected-tabs hint. Always visible (regardless of
          import state) so a designer who's about to drop a freshly-
          renamed workbook sees ahead of time which tab names will be
          recognised. The list is derived from the catalog so it stays
          in sync if we add a product. */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
        <p className="font-semibold uppercase tracking-[0.18em] text-[10px] text-muted-foreground/70">
          Recognised tabs
        </p>
        <p className="leading-relaxed">
          {expectedSheets.map((entry, idx) => (
            <span key={entry.productSlug}>
              {idx > 0 && <span className="text-muted-foreground/40"> · </span>}
              <span className="font-mono text-foreground/80">{entry.primary}</span>
              {entry.case && (
                <>
                  {' '}
                  <span className="text-muted-foreground/60">
                    + <span className="font-mono">{entry.case}</span>
                  </span>
                </>
              )}
            </span>
          ))}
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          Tab names are matched loosely (case + spacing + dashes
          ignored). Anything else lands in the warnings panel.
        </p>
      </div>

      {lastSuccess && (
        <div className="space-y-3 rounded-lg border border-emerald-500/40 bg-emerald-500/[0.04] p-3.5 text-xs text-emerald-800 dark:text-emerald-100">
          {/* Header — names what just happened in plain English. The
              "where did it go?" answer lives in the cards below; this
              line just confirms the import landed cleanly. */}
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight">
                {lastSuccess.packets.length === 0
                  ? 'Workbook validated'
                  : lastSuccess.packets.length === 1
                  ? 'Imported into 1 packet'
                  : `Imported into ${lastSuccess.packets.length} packets`}
              </p>
              <p className="text-[11px] text-emerald-700/80 dark:text-emerald-200/70 mt-0.5">
                {lastSuccess.rows} {lastSuccess.rows === 1 ? 'row' : 'rows'} parsed
                {lastSuccess.packets.length > 0 &&
                  ' — open a packet below to see the result.'}
              </p>
            </div>
          </div>

          {/* Per-packet cards — each one is the explicit "this is where
              your workbook went" handoff. The big "Open packet" CTA on
              the right makes the destination unmissable; clicking it
              closes the dialog and lands on the gallery. The whole
              card is also clickable so casual taps work. */}
          {lastSuccess.packets.length > 0 && (
            <ul className="space-y-2">
              {lastSuccess.packets.map((p) => {
                const m = p.mergeSummary
                const merged = m?.kind === 'merged'
                return (
                  <li key={p.id}>
                    <div className="rounded-md border border-emerald-500/30 bg-background/40 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => onPacketCreated?.(p.id, 'explicit')}
                        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-emerald-500/[0.06] transition-colors"
                      >
                        <Package className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-foreground truncate">
                              {p.productName ?? p.name}
                            </span>
                            <span
                              className={
                                merged
                                  ? 'rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-400/20 dark:text-amber-200'
                                  : 'rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200'
                              }
                            >
                              {merged ? 'Merged' : 'Created'}
                            </span>
                            {p.mergeSummary?.cmfCode && (
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                {p.mergeSummary.cmfCode}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {p.renderCount} {p.renderCount === 1 ? 'SKU' : 'SKUs'}
                            {m && (
                              <>
                                {m.added > 0 && (
                                  <>
                                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                                    <span className="text-emerald-700 dark:text-emerald-300">
                                      {m.added} added
                                    </span>
                                  </>
                                )}
                                {m.updated > 0 && (
                                  <>
                                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                                    <span className="text-amber-700 dark:text-amber-300">
                                      {m.updated} changed
                                    </span>
                                  </>
                                )}
                                {m.unchanged > 0 && (
                                  <>
                                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                                    <span>{m.unchanged} unchanged</span>
                                  </>
                                )}
                              </>
                            )}
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-200 group-hover:bg-emerald-500/25 transition-colors flex-shrink-0">
                          Open packet
                          <ArrowUpRight className="h-3 w-3" />
                        </span>
                      </button>
                      {/* Per-SKU diff — only when there's something
                          worth pointing at. The chips are clickable so
                          a designer can jump straight to the changed
                          row in the gallery. */}
                      {m && m.changes.length > 0 && (
                        <div className="border-t border-emerald-500/20 bg-emerald-500/[0.03] px-3 py-2 space-y-1">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-700/70 dark:text-emerald-200/70">
                            Changed SKUs
                          </p>
                          <ul className="space-y-0.5 text-[11px]">
                            {m.changes.slice(0, 6).map((change) => (
                              <li key={change.renderId}>
                                <button
                                  type="button"
                                  onClick={() => onRenderFocus?.(p.id, change.renderId)}
                                  className="text-left underline-offset-2 hover:underline text-foreground/90"
                                >
                                  <span className="font-medium">{change.label}</span>
                                  {change.changedRegions.length > 0 && (
                                    <span className="text-amber-700/80 dark:text-amber-300/80">
                                      {' '}
                                      · {change.changedRegions.join(', ')}
                                    </span>
                                  )}
                                  {change.paletteChanged && (
                                    <span className="text-amber-700/80 dark:text-amber-300/80">
                                      {change.changedRegions.length > 0
                                        ? ' + palette'
                                        : ' · palette'}
                                    </span>
                                  )}
                                </button>
                              </li>
                            ))}
                            {m.changes.length > 6 && (
                              <li className="italic opacity-70">
                                …and {m.changes.length - 6} more
                              </li>
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Footer hint — only relevant when multiple packets were
              created (multi-product workbook). For the common case
              of a single product we skip it since the single Open
              CTA above is already obvious. */}
          {lastSuccess.packets.length > 1 && (
            <p className="text-[11px] italic text-emerald-700/70 dark:text-emerald-200/70 pl-6">
              Each product became its own packet — open any one to
              start the recolour pass.
            </p>
          )}

        </div>
      )}

      {/* Empty-result panel — fires when the API returned `rowCount: 0`.
          The most common cause is the parser silently dropping every
          tab (renamed "Common specs" header, all-placeholder columns,
          unknown product names). We name every gate that fired so
          designers can see which one to fix. Destructive styling
          because this is a hard failure, not a warning. */}
      {emptyResult && (
        <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3.5 text-xs text-foreground">
          <div className="flex items-start gap-2">
            <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-destructive" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight text-destructive">
                We couldn’t read any SKUs from this workbook
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Nothing landed in the library. Check the details below
                — usually it’s a renamed tab or a layout drift the
                parser doesn’t recognise.
              </p>
            </div>
          </div>
          <DiagnosticsBody diagnostics={diagnostics} tone="destructive" />
        </div>
      )}

      {/* Partial-import warnings panel — fires when rows DID land but
          the parser also dropped something. Sits BELOW the success
          block so a designer reads "X imported successfully" first,
          then "but here's what we couldn't import". Amber styling
          because the import partially succeeded. */}
      {!emptyResult && hasAnyWarnings(diagnostics) && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3.5 text-xs text-amber-900 dark:text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0">
              <p className="font-semibold leading-tight">
                Some content didn’t import
              </p>
              <p className="text-[11px] text-amber-700/80 dark:text-amber-200/80 mt-0.5">
                The rows below landed, but these tabs / columns were
                skipped. Fix the workbook and re-upload to merge them
                in — existing rows aren’t duplicated.
              </p>
            </div>
          </div>
          <DiagnosticsBody diagnostics={diagnostics} tone="warning" />
        </div>
      )}
    </form>
  )
}

/* ── Diagnostics body ──────────────────────────────────────────────────────
 *
 * One renderer used by both the empty-result panel and the partial-warning
 * panel. The four sub-sections render only when their bucket has entries
 * so a fully-clean diagnostics object renders nothing — but neither
 * caller invokes this body on a clean result anyway.
 *
 * `tone` lets the caller pick between destructive (empty-result) and
 * warning (partial-import) coloring without duplicating the markup. The
 * sub-section labels stay neutral so the body can be embedded in either
 * panel without rephrasing.
 */
function DiagnosticsBody({
  diagnostics,
  tone,
}: {
  diagnostics: ImportDiagnostics
  tone: 'destructive' | 'warning'
}) {
  const subtleText =
    tone === 'destructive'
      ? 'text-muted-foreground'
      : 'text-amber-800/80 dark:text-amber-200/80'
  const labelText =
    tone === 'destructive'
      ? 'text-foreground/80'
      : 'text-amber-900 dark:text-amber-100'
  const ruleColor =
    tone === 'destructive' ? 'border-destructive/20' : 'border-amber-500/20'

  const dropByLabel = new Map<
    string,
    { sheet: string; productSlug: string; reasons: Set<'placeholder' | 'empty'> }
  >()
  for (const d of diagnostics.droppedSkuColumns) {
    const key = `${d.sheetName}::${d.skuLabel}`
    const existing = dropByLabel.get(key)
    if (existing) existing.reasons.add(d.reason)
    else
      dropByLabel.set(key, {
        sheet: d.sheetName,
        productSlug: d.productSlug,
        reasons: new Set([d.reason]),
      })
  }

  return (
    <div className="space-y-3 pl-6">
      {diagnostics.unrecognisedSheets.length > 0 && (
        <DiagnosticSection
          icon={FileQuestion}
          label={`${diagnostics.unrecognisedSheets.length} unrecognised ${
            diagnostics.unrecognisedSheets.length === 1 ? 'tab' : 'tabs'
          }`}
          labelClassName={labelText}
          ruleColor={ruleColor}
        >
          <ul className="space-y-1">
            {diagnostics.unrecognisedSheets.map((s) => (
              <li key={s.name} className="text-[11px] leading-snug">
                <span className="font-mono font-semibold text-foreground">
                  {s.name}
                </span>
                <span className={subtleText}> — {s.reason}</span>
              </li>
            ))}
          </ul>
        </DiagnosticSection>
      )}

      {diagnostics.unmappedSheets.length > 0 && (
        <DiagnosticSection
          icon={AlertTriangle}
          label={`${diagnostics.unmappedSheets.length} unmapped ${
            diagnostics.unmappedSheets.length === 1 ? 'tab' : 'tabs'
          }`}
          labelClassName={labelText}
          ruleColor={ruleColor}
        >
          <p className="text-[11px] leading-snug">
            <span className={subtleText}>
              These tabs look like the right shape but don&apos;t match any
              product in the catalog —{' '}
            </span>
            {diagnostics.unmappedSheets.map((s, idx) => (
              <span key={s}>
                {idx > 0 && (
                  <span className="text-muted-foreground/40"> · </span>
                )}
                <span className="font-mono font-semibold text-foreground">
                  {s}
                </span>
              </span>
            ))}
            <span className={subtleText}>
              . Rename the tab to a recognised product name (see the hint
              above) or ask an admin to add the product.
            </span>
          </p>
        </DiagnosticSection>
      )}

      {dropByLabel.size > 0 && (
        <DiagnosticSection
          icon={AlertTriangle}
          label={`${dropByLabel.size} skipped ${
            dropByLabel.size === 1 ? 'SKU column' : 'SKU columns'
          }`}
          labelClassName={labelText}
          ruleColor={ruleColor}
        >
          <ul className="space-y-1">
            {Array.from(dropByLabel.values())
              .slice(0, 12)
              .map((entry) => {
                const reasonLabel =
                  entry.reasons.has('placeholder') && entry.reasons.has('empty')
                    ? 'placeholder + empty cells'
                    : entry.reasons.has('placeholder')
                    ? 'all values look like placeholders (xxxxxxx)'
                    : 'no real values found'
                return (
                  <li
                    key={`${entry.sheet}::${entry.productSlug}`}
                    className="text-[11px] leading-snug"
                  >
                    <span className="font-mono font-semibold text-foreground">
                      {entry.sheet}
                    </span>
                    <span className={subtleText}>
                      {' '}
                      · {entry.productSlug} — {reasonLabel}
                    </span>
                  </li>
                )
              })}
            {dropByLabel.size > 12 && (
              <li className={`text-[11px] italic ${subtleText}`}>
                …and {dropByLabel.size - 12} more
              </li>
            )}
          </ul>
        </DiagnosticSection>
      )}

      {diagnostics.rowErrors.length > 0 && (
        <DiagnosticSection
          icon={AlertTriangle}
          label={`${diagnostics.rowErrors.length} row ${
            diagnostics.rowErrors.length === 1 ? 'issue' : 'issues'
          }`}
          labelClassName={labelText}
          ruleColor={ruleColor}
        >
          <ul className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {diagnostics.rowErrors.slice(0, 12).map((err, idx) => (
              <li
                key={idx}
                className="font-mono text-[11px] leading-snug text-foreground/90"
              >
                row {err.rowIndex + 1}
                {err.field ? ` · ${err.field}` : ''}:{' '}
                <span className={subtleText}>{err.message}</span>
              </li>
            ))}
            {diagnostics.rowErrors.length > 12 && (
              <li className={`text-[11px] italic ${subtleText}`}>
                …and {diagnostics.rowErrors.length - 12} more
              </li>
            )}
          </ul>
        </DiagnosticSection>
      )}
    </div>
  )
}

function DiagnosticSection({
  icon: Icon,
  label,
  labelClassName,
  ruleColor,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  labelClassName: string
  ruleColor: string
  children: React.ReactNode
}) {
  return (
    <section className={`border-t pt-2 ${ruleColor} first:border-0 first:pt-0`}>
      <p
        className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] mb-1.5 ${labelClassName}`}
      >
        <Icon className="h-3 w-3 opacity-70" />
        {label}
      </p>
      {children}
    </section>
  )
}
